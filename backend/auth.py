import os
import sqlite3
import bcrypt
import jwt
import logging
from datetime import datetime, timedelta
from typing import Optional
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, field_validator
from dotenv import load_dotenv

load_dotenv()

# ── Configuration ──────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is not set!")

ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

DB_PATH = "users.db"
logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)  # auto_error=False so cookie fallback works

# ── Database Setup ─────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables if they don't exist and migrate from users.json if present."""
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            email       TEXT PRIMARY KEY,
            full_name   TEXT NOT NULL,
            password    TEXT NOT NULL,
            created_at  TEXT NOT NULL
        )
    """)
    conn.commit()

    # One-time migration from users.json → SQLite
    import json
    json_path = "users.json"
    if os.path.exists(json_path):
        try:
            with open(json_path, "r") as f:
                old_users = json.load(f)
            for email, u in old_users.items():
                existing = conn.execute(
                    "SELECT email FROM users WHERE email = ?", (email,)
                ).fetchone()
                if not existing:
                    # Old passwords were SHA-256 hex; we cannot re-hash without
                    # the plaintext, so we mark them as migrated (user must reset).
                    conn.execute(
                        "INSERT INTO users (email, full_name, password, created_at) VALUES (?,?,?,?)",
                        (email, u["full_name"], u["password"], u["created_at"])
                    )
            conn.commit()
            os.rename(json_path, json_path + ".migrated")
            logger.info("Migrated users.json → users.db")
        except Exception as e:
            logger.error(f"Migration error: {e}")
    conn.close()


# ── Pydantic Models ────────────────────────────────────────────────────────────

class UserSignUp(BaseModel):
    email: EmailStr
    password: str
    full_name: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        return v

    @field_validator("full_name")
    @classmethod
    def name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Full name cannot be empty")
        return v.strip()


class UserSignIn(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    token_type: str


class UserResponse(BaseModel):
    email: str
    full_name: str
    created_at: str


# ── Password Utilities ─────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """Hash password using bcrypt (slow by design, auto-salted)."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


# ── Token Utilities ────────────────────────────────────────────────────────────

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def _decode_token(token: str) -> dict:
    """Decode and return payload, raising HTTPException on invalid/expired token."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"}
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"}
        )


# ── Auth Dependency ────────────────────────────────────────────────────────────

def verify_token(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> str:
    """
    Extract and verify JWT from:
      1. httpOnly cookie 'access_token'  (preferred, secure)
      2. Authorization: Bearer <token>   (fallback for API clients)
    """
    token = None

    # 1 — cookie
    cookie_token = request.cookies.get("access_token")
    if cookie_token:
        token = cookie_token

    # 2 — Authorization header
    if not token and credentials:
        token = credentials.credentials

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"}
        )

    payload = _decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
            headers={"WWW-Authenticate": "Bearer"}
        )

    email: str = payload.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"}
        )
    return email


def get_current_user(email: str = Depends(verify_token)) -> dict:
    """Fetch the authenticated user record from the database."""
    conn = get_db()
    row = conn.execute(
        "SELECT email, full_name, created_at FROM users WHERE email = ?", (email,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return dict(row)


# ── Auth Functions ─────────────────────────────────────────────────────────────

def sign_up_user(user_data: UserSignUp) -> dict:
    """Register a new user, return access + refresh tokens."""
    conn = get_db()
    existing = conn.execute(
        "SELECT email FROM users WHERE email = ?", (user_data.email,)
    ).fetchone()
    if existing:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    hashed = hash_password(user_data.password)
    created_at = datetime.utcnow().isoformat()
    conn.execute(
        "INSERT INTO users (email, full_name, password, created_at) VALUES (?,?,?,?)",
        (user_data.email, user_data.full_name, hashed, created_at)
    )
    conn.commit()
    conn.close()

    access_token = create_access_token({"sub": user_data.email})
    refresh_token = create_refresh_token({"sub": user_data.email})

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": {"email": user_data.email, "full_name": user_data.full_name}
    }


def sign_in_user(user_data: UserSignIn) -> dict:
    """Authenticate user, return access + refresh tokens."""
    conn = get_db()
    row = conn.execute(
        "SELECT email, full_name, password FROM users WHERE email = ?", (user_data.email,)
    ).fetchone()
    conn.close()

    # Deliberate: same error for wrong email or wrong password (no enumeration)
    if not row or not verify_password(user_data.password, row["password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )

    access_token = create_access_token({"sub": row["email"]})
    refresh_token = create_refresh_token({"sub": row["email"]})

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": {"email": row["email"], "full_name": row["full_name"]}
    }


def refresh_access_token(refresh_token: str) -> str:
    """Validate a refresh token and issue a new access token."""
    payload = _decode_token(refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type"
        )
    email = payload.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )
    return create_access_token({"sub": email})
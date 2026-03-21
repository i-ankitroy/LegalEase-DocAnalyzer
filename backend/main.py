import os
import uuid
import sqlite3
import logging
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv

from document_processor import extract_text_from_file, store_document_in_chromadb, delete_document_from_chromadb
from ollama_handler import chat_with_document, analyze_document_for_flags, suggest_alternative
from legal_handler import LegalHandler
from auth import (
    UserSignUp, UserSignIn,
    sign_up_user, sign_in_user, refresh_access_token,
    get_current_user, verify_token, init_db,
    ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS
)

load_dotenv()

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

# ── Document metadata DB (persistent across restarts) ─────────────────────────
DOCS_DB_PATH = "documents.db"

def _init_docs_db():
    conn = sqlite3.connect(DOCS_DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            doc_id      TEXT PRIMARY KEY,
            filename    TEXT NOT NULL,
            file_path   TEXT NOT NULL,
            user_email  TEXT NOT NULL,
            num_chunks  INTEGER NOT NULL,
            created_at  TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chat_sessions (
            session_id    TEXT PRIMARY KEY,
            user_email    TEXT NOT NULL,
            document_id   TEXT NOT NULL,
            document_name TEXT NOT NULL,
            title         TEXT NOT NULL,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chat_messages (
            message_id  TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL,
            role        TEXT NOT NULL,
            content     TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES chat_sessions (session_id) ON DELETE CASCADE
        )
    """)
    conn.commit()
    conn.close()

# ── Initialise DBs ─────────────────────────────────────────────────────────────
init_db()
_init_docs_db()

def _save_doc(doc_id, filename, file_path, user_email, num_chunks):
    from datetime import datetime
    conn = sqlite3.connect(DOCS_DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO documents VALUES (?,?,?,?,?,?)",
        (doc_id, filename, file_path, user_email, num_chunks, datetime.utcnow().isoformat())
    )
    conn.commit()
    conn.close()

def _get_doc(doc_id) -> Optional[dict]:
    conn = sqlite3.connect(DOCS_DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

def _delete_doc(doc_id):
    conn = sqlite3.connect(DOCS_DB_PATH)
    conn.execute('PRAGMA foreign_keys = ON')
    conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))
    conn.commit()
    conn.close()

# ── Chat History DB Helpers ──────────────────────────────────────────────────

def _get_history(user_email: str) -> list:
    conn = sqlite3.connect(DOCS_DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM chat_sessions WHERE user_email = ? ORDER BY updated_at DESC", 
        (user_email,)
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]

def _get_session_messages(session_id: str) -> list:
    conn = sqlite3.connect(DOCS_DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC", 
        (session_id,)
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]

def _create_session(session_id, user_email, document_id, document_name, title):
    from datetime import datetime
    conn = sqlite3.connect(DOCS_DB_PATH)
    now = datetime.utcnow().isoformat()
    conn.execute(
        "INSERT INTO chat_sessions (session_id, user_email, document_id, document_name, title, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
        (session_id, user_email, document_id, document_name, title, now, now)
    )
    conn.commit()
    conn.close()

def _save_message(session_id, role, content):
    from datetime import datetime
    import uuid
    conn = sqlite3.connect(DOCS_DB_PATH)
    now = datetime.utcnow().isoformat()
    msg_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO chat_messages (message_id, session_id, role, content, created_at) VALUES (?,?,?,?,?)",
        (msg_id, session_id, role, content, now)
    )
    conn.execute(
        "UPDATE chat_sessions SET updated_at = ? WHERE session_id = ?",
        (now, session_id)
    )
    conn.commit()
    conn.close()

def _delete_session(session_id):
    conn = sqlite3.connect(DOCS_DB_PATH)
    conn.execute('PRAGMA foreign_keys = ON')
    conn.execute("DELETE FROM chat_sessions WHERE session_id = ?", (session_id,))
    conn.commit()
    conn.close()


# ── Rate Limiter ───────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

# ── FastAPI App ────────────────────────────────────────────────────────────────
app = FastAPI(title="DocChat API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Security Headers Middleware ────────────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        # NOTE: Omit Strict-Transport-Security on localhost (HTTP); enable in production
        # CSP: allow connect-src for the API and form-action for uploads
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "connect-src 'self' http://localhost:8000; "
            "form-action 'self' http://localhost:8000; "
            "img-src 'self' data:; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self' 'unsafe-inline'"
        )
        return response

app.add_middleware(SecurityHeadersMiddleware)

# ── CORS ───────────────────────────────────────────────────────────────────────
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],          # only our frontend, not wildcard
    allow_credentials=True,                # needed for cookies
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

# ── Upload Config ──────────────────────────────────────────────────────────────
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

MAX_FILE_SIZE_BYTES = int(os.getenv("MAX_FILE_SIZE_MB", "100")) * 1024 * 1024

# Allowed MIME types detected by magic bytes
ALLOWED_EXTENSIONS = {".pdf", ".txt", ".docx"}

# Magic byte signatures for actual file-type detection
MAGIC_BYTES = {
    b"%PDF":      ".pdf",
    b"PK\x03\x04": ".docx",  # DOCX is a zip archive
}

def _check_file_type(content: bytes, declared_extension: str) -> bool:
    """Verify file magic bytes match its declared extension."""
    # TXT files have no magic bytes – accept after extension check
    if declared_extension == ".txt":
        try:
            content[:512].decode("utf-8")  # must be decodable
            return True
        except UnicodeDecodeError:
            return False
    for magic, ext in MAGIC_BYTES.items():
        if content.startswith(magic) and ext == declared_extension:
            return True
    return False

# ── LegalHandler ──────────────────────────────────────────────────────────────
legal_handler = LegalHandler(model_name=os.getenv("LLM_MODEL", "llama3.2"))

# ── Pydantic Request Models ────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    document_id: str = Field(..., min_length=36, max_length=36, pattern=r"^[0-9a-f-]+$")
    question: str = Field(..., min_length=1, max_length=2000)
    model: str = Field(default="llama3.2", max_length=64, pattern=r"^[a-zA-Z0-9._:/-]+$")
    session_id: Optional[str] = None

    @field_validator("question")
    @classmethod
    def strip_question(cls, v):
        return v.strip()


class LegalChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)

    @field_validator("message")
    @classmethod
    def strip_message(cls, v):
        return v.strip()


class LegalChatHistoryRequest(BaseModel):
    messages: list = Field(..., min_length=1, max_length=50)


class AnalyzeRequest(BaseModel):
    document_id: str = Field(..., min_length=36, max_length=36, pattern=r"^[0-9a-f-]+$")
    model: str = Field(default="llama3.2", max_length=64, pattern=r"^[a-zA-Z0-9._:/-]+$")
    session_id: Optional[str] = None


class SuggestAlternativeRequest(BaseModel):
    document_id: str = Field(..., min_length=36, max_length=36, pattern=r"^[0-9a-f-]+$")
    red_flag_title: str = Field(..., min_length=1, max_length=300)
    red_flag_excerpt: str = Field(default="", max_length=2000)
    red_flag_issue: str = Field(default="", max_length=2000)
    model: str = Field(default="llama3.2", max_length=64, pattern=r"^[a-zA-Z0-9._:/-]+$")
    session_id: Optional[str] = None


# ── Cookie Helper ──────────────────────────────────────────────────────────────

def _set_auth_cookies(response: JSONResponse, access_token: str, refresh_token: str):
    """Attach both tokens as secure httpOnly cookies."""
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=False,          # set True in production (requires HTTPS)
        samesite="lax",        # lax allows normal navigation; strict breaks OAuth flows
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=False,          # set True in production
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path="/api/auth/refresh"   # only sent to the refresh endpoint
    )


# ══════════════════════════════════════════════════════════════════════════════
# AUTH ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/auth/signup")
@limiter.limit("10/minute")
async def signup(request: Request, user_data: UserSignUp):
    """Register a new user. Tokens returned as httpOnly cookies."""
    try:
        result = sign_up_user(user_data)
        resp = JSONResponse(content={"user": result["user"], "message": "Account created"})
        _set_auth_cookies(resp, result["access_token"], result["refresh_token"])
        return resp
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Signup error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Registration failed. Please try again.")


@app.post("/api/auth/signin")
@limiter.limit("5/minute")
async def signin(request: Request, user_data: UserSignIn):
    """Sign in an existing user. Tokens returned as httpOnly cookies."""
    try:
        result = sign_in_user(user_data)
        resp = JSONResponse(content={"user": result["user"], "message": "Signed in"})
        _set_auth_cookies(resp, result["access_token"], result["refresh_token"])
        return resp
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Signin error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Sign in failed. Please try again.")


@app.post("/api/auth/refresh")
@limiter.limit("20/minute")
async def refresh(request: Request):
    """Issue a new access token using the refresh token cookie."""
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No refresh token provided")
    try:
        new_access = refresh_access_token(refresh_token)
        resp = JSONResponse(content={"message": "Token refreshed"})
        resp.set_cookie(
            key="access_token",
            value=new_access,
            httponly=True,
            secure=False,
            samesite="lax",
            max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60
        )
        return resp
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Token refresh error: {e}", exc_info=True)
        raise HTTPException(status_code=401, detail="Token refresh failed.")


@app.post("/api/auth/signout")
async def signout():
    """Clear authentication cookies."""
    resp = JSONResponse(content={"message": "Signed out"})
    resp.delete_cookie("access_token")
    resp.delete_cookie("refresh_token", path="/api/auth/refresh")
    return resp


@app.get("/api/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """Get current user information."""
    return current_user


# ══════════════════════════════════════════════════════════════════════════════
# DOCUMENT ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/")
async def root():
    return {"message": "DocChat API is running"}


@app.post("/upload")
@limiter.limit("20/minute")
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    try:
        # Read file content once
        content = await file.read()

        # ── Size check ─────────────────────────────────────────────────────
        if len(content) > MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size is {MAX_FILE_SIZE_BYTES // (1024*1024)}MB."
            )

        # ── Extension check ────────────────────────────────────────────────
        safe_filename = Path(file.filename).name    # strips any ../ path traversal
        extension = Path(safe_filename).suffix.lower()
        if extension not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '{extension}'. Allowed: PDF, DOCX, TXT."
            )

        # ── Magic bytes check (true MIME verification) ─────────────────────
        if not _check_file_type(content, extension):
            raise HTTPException(
                status_code=400,
                detail="File content does not match its extension. Upload rejected."
            )

        # ── Save to disk ───────────────────────────────────────────────────
        doc_id = str(uuid.uuid4())
        file_path = os.path.join(UPLOAD_DIR, f"{doc_id}_{safe_filename}")
        with open(file_path, "wb") as f:
            f.write(content)

        # ── Extract text ───────────────────────────────────────────────────
        text = extract_text_from_file(file_path, safe_filename)
        if not text:
            os.remove(file_path)
            raise HTTPException(status_code=400, detail="Could not extract text from file.")

        # ── Store in ChromaDB ──────────────────────────────────────────────
        num_chunks = store_document_in_chromadb(doc_id, text, safe_filename)

        # ── Persist metadata to SQLite ─────────────────────────────────────
        _save_doc(doc_id, safe_filename, file_path, current_user["email"], num_chunks)

        return {
            "document_id": doc_id,
            "filename": safe_filename,
            "num_chunks": num_chunks,
            "message": "Document uploaded and processed with RAG"
        }

    except HTTPException:
        raise
    except Exception as e:
        _user_email = current_user.get('email') if isinstance(current_user, dict) else 'unknown'
        logger.error(f"Upload error for {_user_email}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An error occurred while uploading. Please try again.")


@app.post("/chat")
@limiter.limit("30/minute")
async def chat(
    request: Request,
    req: ChatRequest,
    current_user: dict = Depends(get_current_user)
):
    try:
        doc = _get_doc(req.document_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found.")

        if doc["user_email"] != current_user["email"]:
            raise HTTPException(status_code=403, detail="Access denied.")

        # ── Handle History Session ─────────────────────────────────────────
        session_id = req.session_id
        if not session_id:
            session_id = str(uuid.uuid4())
            title = req.question[:50] + "..." if len(req.question) > 50 else req.question
            _create_session(session_id, current_user["email"], req.document_id, doc["filename"], title)
        
        # Save user message
        _save_message(session_id, "user", req.question)

        response = chat_with_document(
            document_id=req.document_id,
            question=req.question,
            model=req.model
        )

        # Save assistant message
        _save_message(session_id, "assistant", response)

        return {
            "response": response, 
            "document_id": req.document_id,
            "session_id": session_id
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chat error for {current_user.get('email')}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An error occurred while processing your question.")


@app.post("/api/legal/chat")
@limiter.limit("30/minute")
async def legal_chat(
    request: Request,
    req: LegalChatRequest,
    current_user: dict = Depends(get_current_user)
):
    try:
        response = legal_handler.chat(req.message)
        return {
            "status": "success",
            "response": response,
            "disclaimer": "This is general legal information, not legal advice. Please consult with a licensed attorney for specific legal matters."
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Legal chat error for {current_user.get('email')}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An error occurred in the legal assistant.")


@app.post("/api/legal/chat-history")
@limiter.limit("30/minute")
async def legal_chat_with_history(
    request: Request,
    req: LegalChatHistoryRequest,
    current_user: dict = Depends(get_current_user)
):
    try:
        response = legal_handler.chat_with_history(req.messages)
        return {
            "status": "success",
            "response": response,
            "disclaimer": "This is general legal information, not legal advice. Please consult with a licensed attorney for specific legal matters."
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Legal chat-history error for {current_user.get('email')}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An error occurred in the legal assistant.")


# ══════════════════════════════════════════════════════════════════════════════
# DOCUMENT ANALYSIS ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/analyze")
@limiter.limit("10/minute")
async def analyze_document_endpoint(
    request: Request,
    req: AnalyzeRequest,
    current_user: dict = Depends(get_current_user)
):
    """Analyze a document for red flags and legal traps using RAG + specialized prompt."""
    doc = _get_doc(req.document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    if doc["user_email"] != current_user["email"]:
        raise HTTPException(status_code=403, detail="Access denied.")
    try:
        result = analyze_document_for_flags(req.document_id, req.model)

        # ── Handle History Session ─────────────────────────────────────────
        session_id = req.session_id
        if not session_id:
            session_id = str(uuid.uuid4())
            title = "Document Analysis"
            _create_session(session_id, current_user["email"], req.document_id, doc["filename"], title)
            
            # Save the analysis summary as the first assistant message
            # We don't save the red flags block itself as a message, just the summary, 
            # to seed the chat context properly if they look at history later.
            _save_message(session_id, "assistant", f"**Analysis Summary:**\n{result['summary']}")

        return {
            "document_id": req.document_id,
            "filename": doc["filename"],
            "summary": result["summary"],
            "red_flags": result["red_flags"],
            "flag_count": len(result["red_flags"]),
            "session_id": session_id
        }
    except HTTPException:
        raise
    except Exception as e:
        _email = current_user.get("email", "unknown") if isinstance(current_user, dict) else "unknown"
        logger.error(f"Analysis error for {_email}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Document analysis failed. Please try again.")


@app.post("/suggest-alternative")
@limiter.limit("20/minute")
async def suggest_alternative_endpoint(
    request: Request,
    req: SuggestAlternativeRequest,
    current_user: dict = Depends(get_current_user)
):
    """Return a fairer clause alternative and negotiation advice for a specific red flag."""
    # Verify document ownership first
    doc = _get_doc(req.document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    if doc["user_email"] != current_user["email"]:
        raise HTTPException(status_code=403, detail="Access denied.")
    try:
        alternative = suggest_alternative(
            req.red_flag_title,
            req.red_flag_excerpt,
            req.red_flag_issue,
            req.model
        )
        return {"alternative": alternative}
    except HTTPException:
        raise
    except Exception as e:
        _email = current_user.get("email", "unknown") if isinstance(current_user, dict) else "unknown"
        logger.error(f"Suggest alternative error for {_email}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate alternatives. Please try again.")




# ══════════════════════════════════════════════════════════════════════════════
# CHAT HISTORY ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/history")
async def get_history(current_user: dict = Depends(get_current_user)):
    """Get all chat sessions for the current user."""
    try:
        sessions = _get_history(current_user["email"])
        return {"sessions": sessions}
    except Exception as e:
        logger.error(f"Error fetching history for {current_user['email']}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch chat history.")


@app.get("/history/{session_id}")
async def get_session(session_id: str, current_user: dict = Depends(get_current_user)):
    """Get messages for a specific chat session."""
    try:
        sessions = _get_history(current_user["email"])
        session = next((s for s in sessions if s["session_id"] == session_id), None)
        if not session:
            raise HTTPException(status_code=403, detail="Access denied or session not found.")
        
        messages = _get_session_messages(session_id)
        return {"session_id": session_id, "session": session, "messages": messages}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching session {session_id} for {current_user['email']}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch session messages.")


@app.delete("/history/{session_id}")
async def delete_session(session_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a chat session."""
    try:
        sessions = _get_history(current_user["email"])
        if not any(s["session_id"] == session_id for s in sessions):
            raise HTTPException(status_code=403, detail="Access denied.")
        
        _delete_session(session_id)
        return {"message": "Session deleted."}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting session {session_id} for {current_user['email']}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete session.")


@app.get("/document/{document_id}")
async def get_document(
    document_id: str,
    current_user: dict = Depends(get_current_user)
):
    doc = _get_doc(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    if doc["user_email"] != current_user["email"]:
        raise HTTPException(status_code=403, detail="Access denied.")
    return {
        "id": doc["doc_id"],
        "filename": doc["filename"],
        "num_chunks": doc["num_chunks"]
    }


@app.delete("/document/{document_id}")
async def delete_document(
    document_id: str,
    current_user: dict = Depends(get_current_user)
):
    doc = _get_doc(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    if doc["user_email"] != current_user["email"]:
        raise HTTPException(status_code=403, detail="Access denied.")
    try:
        delete_document_from_chromadb(document_id)
        if os.path.exists(doc["file_path"]):
            os.remove(doc["file_path"])
        _delete_doc(document_id)
        return {"message": "Document deleted successfully."}
    except Exception as e:
        logger.error(f"Delete error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete document.")


@app.get("/models")
async def list_models(current_user: dict = Depends(get_current_user)):
    try:
        import ollama
        models = ollama.list()
        return {"models": [model["name"] for model in models["models"]]}
    except Exception as e:
        logger.error(f"List models error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Could not retrieve model list.")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("BACKEND_PORT", "8000")))
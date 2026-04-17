# LegalEase - Comprehensive Architecture & Workflow Map

> [!IMPORTANT]  
> **FOR FUTURE AI AGENTS:** This document is your foundational context map. Read this *first* to understand the application's entire frontend, backend, and data flow architecture. You do not need to spend tokens investigating individual project files unless you are directly modifying them.

---

## 1. Project Specifications

*   **App Name:** LegalEase
*   **Purpose:** Premium, AI-powered legal document analysis and attorney-simulation chat platform.
*   **Design Framework:** Neumorphic "Glass & Gold" UI (Pill-rounded borders, soft shadows, vibrant metallic accents in Dark Mode).
*   **Frontend Stack:** React.js (Vite), React Router v6, vanilla SCSS with custom CSS variables.
*   **Backend Stack:** Python FastApi, Uvicorn, SQLite, ChromaDB.
*   **AI Engine:** Groq Cloud API (Llama 3 / Mixtral for instant inference speed). Note: All Groq calls use `temperature=0` to ensure highly deterministic outputs limit erratic legal hallucinations.

---

## 2. Environment Variables Setup

Before running the backend, create a `.env` file in the `backend/` directory with the following structure:

```env
# Groq API Key for LLM Inference
GROQ_API_KEY="gsk_your_groq_api_key_here"

# JWT Authentication Secrets
SECRET_KEY="your_secure_randomly_generated_secret_string"
ALGORITHM="HS256"
ACCESS_TOKEN_EXPIRE_MINUTES="15"
REFRESH_TOKEN_EXPIRE_DAYS="7"
```

---

## 3. Directory Structure & Component Map

```text
d:\ProjectFiles\LegalEase\Dock_Chat\
├── backend/
│   ├── main.py                  # FastAPI router. Endpoints for Auth, Upload, Chat, Analyze. DB init.
│   ├── ai_handler.py            # Interfaces with Groq API. Prompts & deterministic constraint parsing.
│   ├── document_processor.py    # PyPDF extraction, text chunking, and ChromaDB vector ingestion.
│   ├── auth.py                  # JWT Auth logic and SQLite user connection.
│   ├── legal_handler.py         # Specific legal constraint parsing rules.
│   ├── documents.db             # SQLite (Tables: documents, chat_sessions, chat_messages, analysis_cache)
│   ├── users.db                 # SQLite (Table: users with hashed passwords)
│   └── chromadb_storage/        # Local persistent Vector Store holding document embeddings.
│
└── frontend/
    ├── public/
    │   └── logo.png             # Dynamically styling branding.
    └── src/
        ├── App.jsx              # React Router core. Wraps routes in Auth protection.
        ├── index.css            # GLOBAL SCSS variables: Colors, Neumorphism layout tokens, radii.
        ├── utils/
        │   └── api.js           # API fetch wrapper. Handles Auth headers & streaming decoders.
        └── components/
            ├── AppBranding/     # Shared LegalEase Logo and Theme typography component.
            ├── ProtectedRoute/  # React Router barrier handling unauthenticated redirects.
            ├── ThemeToggle/     # Dynamic Light/Dark mode switcher logic.
            ├── Sidebar/         # Collapsible Navigation & Chat History panel.
            ├── Layout/          # Flex-column shell. Mounts Sidebar + right-side Main Content.
            ├── Landing/         # Unprotected promotional Hero page.
            ├── SignIn/          # Authentication routing.
            ├── SignUp/          # Authentication routing.
            ├── Home/            # Dashboard landing view.
            ├── Upload/          # Drag-and-drop document ingestion interface.
            ├── LegalChat/       # Direct Legal LLM conversational agent interface.
            └── AnalyzeDocument/ # Core analysis view. Includes:
                ├── Streaming JSON logic
                ├── SQLite Caching mechanism
                ├── Red Flag Expansion & Rewrites
                └── PDF Generation logic (jsPDF)
```

---

## 4. Data & State Flow Graph

graph TD

    %% Frontend Entities
    Client[React Client]
    UploadUI[Upload Component]
    AnalyzeUI[AnalyzeDocument Component]
    APIUtil[frontend/utils/api.js]

    %% Backend Entitites
    FastAPI[FastAPI / main.py]
    DocEngine[document_processor.py]
    AIEngine[ai_handler.py - Groq]
    
    %% Storage
    Chroma[(ChromaDB Vector Store)]
    SQLiteDoc[(SQLite documents.db)]

    %% FLOW
    Client --> UploadUI
    UploadUI -->|1. File POST| FastAPI
    FastAPI -->|2. Extract & Chunk| DocEngine
    DocEngine -->|3. Store Vectors| Chroma
    FastAPI -->|4. Return doc_id| Client
    Client -->|5. Redirect| AnalyzeUI

    AnalyzeUI -->|6. POST /analyze {force: false}| APIUtil
    APIUtil -->|7. Check Cache| FastAPI
    
    FastAPI -->|8a. Cache Hit| SQLiteDoc
    SQLiteDoc -.->|8b. Return Cached JSON| AnalyzeUI
    
    FastAPI -->|9. Cache Miss or force=true| AIEngine
    AIEngine -->|10. Query relevant chunks| Chroma
    Chroma -.->|11. Return Excerpts| AIEngine
    AIEngine -->|12. Call Groq temp=0| GroqAPI((Groq API))
    GroqAPI -.->|13. Stream pure JSON| FastAPI
    
    FastAPI -.->|14. SSE Stream| AnalyzeUI
    FastAPI -->|15. Save Result| SQLiteDoc
    
    AnalyzeUI -->|16. User clicks Download| jsPDF[jsPDF Generator]
    jsPDF -->|17. Two-Pass Layout| LocalPDF[Local PDF File]
```

---

## 5. Key Engineering Implementations

### A. The Document Analysis Prompt Structure
The analysis engine (`ai_handler.py`) operates with a strict mandate: it forces Groq to output JSON without markdown wrappers by strictly using `response_format={"type": "json_object"}`. 
The expected JSON signature is:
```json
{
  "summary": "String...",
  "red_flags": [
    {
       "severity": "HIGH",
       "title": "...",
       "excerpt": "...",
       "issue": "..."
    }
  ]
}
```

### B. The Analysis Caching Mechanism
Due to LLM token costs and latency, the `/analyze` endpoint intercepts requests using a SQLite table `analysis_cache` located inside `documents.db`. 
*   **Normal Load:** If `force=false` and a cache exists, the backend instantly yields the static JSON wrapped in a simulated stream event, making the frontend render instantly.
*   **Force Re-evaluate:** A user clicking "Force Re-analyze" sends `force=true` via `api.js`, which bypasses SQLite, queries Groq freshly at `temperature=0`, and overwrites the SQLite cache row upon stream completion via `_save_cached_analysis()`.

### C. Client Side PDF Export (`jsPDF`)
The `AnalyzeDocument` component dynamically generates professional Legal Analysis Reports locally to prevent server strain. It utilizes a "Two-Pass Rendering Mode".
1.  **Measurement Pass:** It virtually calculates the Y-axis heights of the generated LLM text chunks using `doc.splitTextToSize()`.
2.  **Drawing Pass:** It draws the structural rectangles, pill backgrounds, and page breaks (`doc.addPage()`), inserting the text securely over the shapes to guarantee zero text overflow or CSS box clipping.

### D. Neumorphic Style Implementation Guidelines
If extending UI components, you **must use CSS Custom Properties** for all shadows, colors, and layout borders.
*   **Backgrounds:** Use `background: var(--bg-primary)` heavily to mask container boundaries.
*   **Shadows:** Apply `box-shadow: var(--shadow-md)` for standard pills, dropping to `var(--shadow-inset)` on `:active` states for physical "push" replication.
*   **Buttons:** Standard buttons are gray text. Important/CTA actions inherit `.btn-primary` or utilize `color: var(--accent-primary)`. Let the CSS variables dictate the exact gold values. Default button border radii must be `border-radius: var(--radius-full)`.

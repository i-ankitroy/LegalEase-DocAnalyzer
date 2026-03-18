# DocuChat - AI Document Analyzer

A Retrieval-Augmented Generation (RAG) system that allows users to upload documents and ask natural language questions about their content. DocuChat uses advanced semantic search and vector embeddings to provide accurate, context-aware answers while minimizing hallucinations.

## Features

- **Multi-Format Document Support**: Upload and analyze PDFs, Word documents (DOCX), text files, and more
- **Natural Language Q&A**: Ask questions in plain English and get accurate answers sourced directly from your documents
- **RAG Architecture**: Implements retrieval-augmented generation with document chunking, embeddings, and semantic search
- **User Authentication**: Secure login system with persistent user sessions
- **Chat History**: Access previous conversations and document queries
- **Source Attribution**: Answers include references to specific document sections, reducing hallucinations
- **Multi-Document Support**: Query across multiple uploaded documents simultaneously

## Tech Stack

**Frontend:**
- React
- SCSS
- Vite

**Backend:**
- FastAPI
- Python 3.8+
- LangChain

**Database & Vector Store:**
- MongoDB (user auth & metadata)
- Chroma (vector database for embeddings)

**AI/LLM:**
- Sentence Transformers (embeddings)
- LLM for natural language generation

## Prerequisites

- Python 3.8+
- Node.js 16+
- MongoDB (local or Atlas)

## Installation

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/docuchat.git
cd docuchat
```

### 2. Backend Setup
```bash
cd backend
pip install -r requirements.txt
```

Create a `.env` file in the `backend` directory:
```env
# Database Configuration
MONGODB_URI=mongodb://localhost:27017/docuchat
DATABASE_NAME=docuchat

# JWT Configuration
SECRET_KEY=your_secret_key_here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# LLM Configuration
LLM_API_URL=your_llm_api_url_here
LLM_MODEL=your_model_name_here

# Vector Store Configuration
CHROMA_PERSIST_DIRECTORY=./chroma_db
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2

# Server Configuration
BACKEND_PORT=8000
FRONTEND_URL=http://localhost:5173

# Document Processing
MAX_FILE_SIZE_MB=100
CHUNK_SIZE=500
CHUNK_OVERLAP=50
```

### 3. Frontend Setup
```bash
cd ../frontend
npm install
```

## Running the Application

### 1. Start MongoDB
Make sure MongoDB is running locally or your MongoDB Atlas connection is configured.

### 2. Start Backend
```bash
cd backend
uvicorn main:app --reload --port 8000
```

### 3. Start Frontend
```bash
cd frontend
npm run dev
```

The application will be available at `http://localhost:5173`

## Usage

### 1. User Registration & Login
- Create an account with email and password
- Login to access the document analyzer

### 2. Upload Documents
- Click the upload button
- Select one or more documents (PDF, DOCX, TXT supported)
- Wait for processing (chunking and embedding generation)

### 3. Ask Questions
- Type natural language questions about your uploaded documents
- Get accurate answers with source citations
- Ask follow-up questions for deeper understanding

### 4. View Chat History
- Access previous conversations from the history section
- Resume discussions about previously uploaded documents

## How It Works

### RAG Pipeline

1. **Document Upload**: Files are uploaded and validated
2. **Text Extraction**: Content is extracted from various file formats
3. **Chunking**: Documents are split into overlapping chunks (500 tokens with 50-token overlap)
4. **Embedding Generation**: Each chunk is converted to vector embeddings using sentence-transformers
5. **Vector Storage**: Embeddings are stored in Chroma vector database
6. **Query Processing**: User questions are embedded and semantically matched against document chunks
7. **Context Retrieval**: Most relevant chunks are retrieved based on vector similarity
8. **Answer Generation**: LLM generates answers using retrieved context, with source attribution

### Key Features

- **Semantic Search**: Goes beyond keyword matching to understand meaning and context
- **Source Attribution**: Every answer includes references to specific document sections
- **Multi-Document Query**: Ask questions that span multiple uploaded documents
- **Conversation Memory**: Maintains context across multiple questions in a session
- **Optimized Performance**: Sub-2-second response time for documents up to 100 pages

## Project Structure
```
## structure 

DocQChat/
├─ backend/
│  ├─ chromadb_storage/
│  │  ├─ 2
│  │  ├─ 5
│  │  └─ chroma.sqlite3
│  ├─ uploads/
│  │  ├─ 
│  ├─ auth.py
│  ├─ document_processor.py
│  ├─ legal_handler.py
│  ├─ main.py
│  ├─ ollama_handler.py
│  ├─ requirements.txt
│  └─ users.json
├─ frontend/
│  ├─ public/
│  │  └─ vite.svg
│  ├─ src/
│  │  ├─ assets/
│  │  │  └─ react.svg
│  │  ├─ components/
│  │  │  ├─ Chat/
│  │  │  │  
│  │  │  ├─ Home/
│  │  │  ├─ Landing/
│  │  │  ├─ Layout/
│  │  │  ├─ LegalChat/
│  │  │  ├─ Sidebar/
│  │  │  ├─ SignIn/
│  │  │  ├─ SignUp/
│  │  │  └─ Upload/
│  │  │     ├─ index.jsx
│  │  ├─ utils/
│  │  │  └─ api.js
│  │  ├─ App.jsx
│  │  ├─ App.scss
│  │  ├─ index.css
│  │  └─ main.jsx
│  ├─ 
├─ 
├─ package-lock.json
├─ package.json
└─ Readme.md




## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user

### Documents
- `POST /api/documents/upload` - Upload document(s)
- `GET /api/documents` - List user's documents
- `DELETE /api/documents/{id}` - Delete document

### Chat
- `POST /api/chat/query` - Ask question about documents
- `GET /api/chat/history` - Get chat history
- `DELETE /api/chat/history/{id}` - Delete conversation

## Security

- Passwords are hashed using bcrypt
- JWT tokens for session management
- User data isolation (users can only access their own documents)
- File type validation and size limits
- Secure file storage

## Performance Optimizations

- Async request handling with FastAPI
- Efficient vector similarity search with Chroma
- Document chunking with optimal overlap for context preservation
- Caching of embeddings to avoid recomputation
- Lazy loading of chat history

## Limitations

- Maximum file size: 100MB per document
- Supported formats: PDF, DOCX, TXT
- Processing time increases with document size
- Vector database grows with number of documents

## Future Enhancements

- [ ] Support for more file formats (PPTX, CSV, HTML)
- [ ] OCR for scanned PDFs
- [ ] Multi-language support
- [ ] Document summarization
- [ ] Collaborative document sharing
- [ ] Export conversations to PDF
- [ ] Advanced analytics on document usage
- [ ] Real-time collaborative Q&A sessions

## Troubleshooting

### Common Issues

**Documents not uploading:**
- Check file size limits (max 100MB)
- Verify file format is supported
- Check backend logs for processing errors

**Slow response times:**
- Large documents may take longer to process
- Check vector database size and consider cleanup
- Verify LLM API response times

**Login issues:**
- Verify MongoDB connection
- Check JWT secret key configuration
- Clear browser cookies and try again

## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## Support

For issues or questions, please open an issue on GitHub.

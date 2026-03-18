import os
from PyPDF2 import PdfReader
from docx import Document
import chromadb
import ollama

# Initialize ChromaDB client (persistent storage)
CHROMA_DB_DIR = "chromadb_storage"
os.makedirs(CHROMA_DB_DIR, exist_ok=True)

chroma_client = chromadb.PersistentClient(path=CHROMA_DB_DIR)

# ============= TEXT EXTRACTION FUNCTIONS =============

def extract_text_from_file(file_path: str, filename: str) -> str:
    """
    Extract text from various file formats
    """
    file_extension = os.path.splitext(filename)[1].lower()
    
    try:
        if file_extension == '.pdf':
            return extract_text_from_pdf(file_path)
        elif file_extension == '.txt':
            return extract_text_from_txt(file_path)
        elif file_extension == '.docx':
            return extract_text_from_docx(file_path)
        else:
            raise ValueError(f"Unsupported file format: {file_extension}")
    except Exception as e:
        raise Exception(f"Error extracting text: {str(e)}")

def extract_text_from_pdf(file_path: str) -> str:
    """Extract text from PDF file"""
    text = ""
    try:
        reader = PdfReader(file_path)
        for page in reader.pages:
            text += page.extract_text() + "\n"
        return text.strip()
    except Exception as e:
        raise Exception(f"Error reading PDF: {str(e)}")

def extract_text_from_txt(file_path: str) -> str:
    """Extract text from TXT file"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        raise Exception(f"Error reading TXT: {str(e)}")

def extract_text_from_docx(file_path: str) -> str:
    """Extract text from DOCX file"""
    try:
        doc = Document(file_path)
        text = "\n".join([paragraph.text for paragraph in doc.paragraphs])
        return text.strip()
    except Exception as e:
        raise Exception(f"Error reading DOCX: {str(e)}")


# ============= RAG FUNCTIONS =============

def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[dict]:
    """
    Split text into overlapping chunks
    
    Args:
        text: The full document text
        chunk_size: Size of each chunk in characters
        overlap: Number of characters to overlap between chunks
    
    Returns:
        List of dicts with chunk text and metadata
    """
    chunks = []
    start = 0
    chunk_id = 0
    
    while start < len(text):
        # Get chunk
        end = start + chunk_size
        chunk_text = text[start:end]
        
        # Only add non-empty chunks
        if chunk_text.strip():
            chunks.append({
                "text": chunk_text,
                "chunk_id": chunk_id,
                "start_char": start,
                "end_char": end
            })
            chunk_id += 1
        
        # Move start position (with overlap)
        start += chunk_size - overlap
    
    return chunks


def get_ollama_embeddings(texts: list[str]) -> list[list[float]]:
    """
    Generate embeddings using Ollama's nomic-embed-text model
    
    Args:
        texts: List of text strings to embed
    
    Returns:
        List of embedding vectors
    """
    embeddings = []
    
    for text in texts:
        try:
            response = ollama.embeddings(
                model="nomic-embed-text",
                prompt=text
            )
            embeddings.append(response['embedding'])
        except Exception as e:
            raise Exception(f"Error generating embedding: {str(e)}")
    
    return embeddings


def store_document_in_chromadb(document_id: str, text: str, filename: str) -> int:
    """
    Chunk document, generate embeddings, and store in ChromaDB
    
    Args:
        document_id: Unique document identifier
        text: Full document text
        filename: Original filename
    
    Returns:
        Number of chunks stored
    """
    try:
        # Create or get collection for this document
        collection = chroma_client.get_or_create_collection(
            name=f"doc_{document_id}",
            metadata={"filename": filename}
        )
        
        # Chunk the text
        chunks = chunk_text(text)
        
        if not chunks:
            raise Exception("No chunks created from document")
        
        # Prepare data for ChromaDB
        chunk_texts = [chunk["text"] for chunk in chunks]
        chunk_ids = [f"chunk_{chunk['chunk_id']}" for chunk in chunks]
        metadatas = [
            {
                "chunk_id": chunk["chunk_id"],
                "start_char": chunk["start_char"],
                "end_char": chunk["end_char"],
                "filename": filename
            }
            for chunk in chunks
        ]
        
        # Generate embeddings using Ollama
        embeddings = get_ollama_embeddings(chunk_texts)
        
        # Store in ChromaDB
        collection.add(
            ids=chunk_ids,
            embeddings=embeddings,
            documents=chunk_texts,
            metadatas=metadatas
        )
        
        return len(chunks)
    
    except Exception as e:
        raise Exception(f"Error storing document in ChromaDB: {str(e)}")


def query_document(document_id: str, question: str, n_results: int = 3) -> list[dict]:
    """
    Query ChromaDB for relevant chunks from a specific document
    
    Args:
        document_id: Document to search in
        question: User's question
        n_results: Number of relevant chunks to retrieve
    
    Returns:
        List of relevant chunks with metadata
    """
    try:
        # Get the document's collection
        collection = chroma_client.get_collection(name=f"doc_{document_id}")
        
        # Generate embedding for the question
        question_embedding = get_ollama_embeddings([question])[0]
        
        # Query ChromaDB
        results = collection.query(
            query_embeddings=[question_embedding],
            n_results=n_results
        )
        
        # Format results
        relevant_chunks = []
        for i in range(len(results['documents'][0])):
            relevant_chunks.append({
                "text": results['documents'][0][i],
                "metadata": results['metadatas'][0][i],
                "distance": results['distances'][0][i] if 'distances' in results else None
            })
        
        return relevant_chunks
    
    except Exception as e:
        raise Exception(f"Error querying document: {str(e)}")


def delete_document_from_chromadb(document_id: str):
    """
    Delete a document's collection from ChromaDB
    
    Args:
        document_id: Document to delete
    """
    try:
        chroma_client.delete_collection(name=f"doc_{document_id}")
    except Exception as e:
        # Collection might not exist, that's okay
        pass
import ollama
from document_processor import query_document

def chat_with_document(document_id: str, question: str, model: str = "llama3.2") -> str:
    """
    Answer question using RAG - retrieve relevant chunks then generate answer
    
    Args:
        document_id: ID of the document to query
        question: User's question
        model: Ollama model to use for generation
    
    Returns:
        Generated answer
    """
    try:
        # Step 1: Retrieve relevant chunks from ChromaDB
        relevant_chunks = query_document(document_id, question, n_results=3)
        
        # Step 2: Combine chunks into context
        context = "\n\n---\n\n".join([chunk["text"] for chunk in relevant_chunks])
        
        # Step 3: Create RAG prompt
        prompt = f"""You are a helpful assistant that answers questions about documents.

Based on the following relevant excerpts from the document, please answer the question.

Relevant excerpts:
{context}

Question: {question}

Please provide a clear and concise answer based on the excerpts above. If the excerpts don't contain enough information to answer the question, say so."""

        # Step 4: Call Ollama for generation
        response = ollama.chat(
            model=model,
            messages=[
                {
                    'role': 'user',
                    'content': prompt
                }
            ]
        )
        
        return response['message']['content']
    
    except Exception as e:
        raise Exception(f"Error communicating with Ollama: {str(e)}")


def get_available_models():
    """Get list of available Ollama models"""
    try:
        models = ollama.list()
        return [model['name'] for model in models['models']]
    except Exception as e:
        raise Exception(f"Error getting models: {str(e)}")
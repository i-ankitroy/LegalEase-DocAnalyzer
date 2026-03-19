import re
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


def analyze_document_for_flags(document_id: str, model: str = "llama3.2") -> dict:
    """
    Analyze a document for red flags, legal traps and unfavorable clauses.
    Uses 10 ChromaDB chunks for broad document coverage.
    Returns: { summary: str, red_flags: list[dict] }
    """
    try:
        # Broad legal-topic query to maximize document coverage
        relevant_chunks = query_document(
            document_id,
            "contract terms conditions obligations liability fees penalties renewal "
            "termination indemnification arbitration data privacy amendments rights waiver",
            n_results=10
        )

        if not relevant_chunks:
            raise Exception("No content found in document")

        context = "\n\n---\n\n".join([chunk["text"] for chunk in relevant_chunks])

        # Safety guard: cap context to avoid exceeding Ollama's context window
        # ~12 000 chars ≈ 3 000 tokens, safe for llama3.2's 4k default context
        MAX_CONTEXT_CHARS = 12_000
        if len(context) > MAX_CONTEXT_CHARS:
            context = context[:MAX_CONTEXT_CHARS] + "\n\n[... document truncated for analysis ...]"


        prompt = f"""You are an expert legal analyst specializing in identifying unfavorable clauses, traps, and red flags in contracts and terms & conditions.

Analyze the following document excerpts carefully.

DOCUMENT CONTENT:
{context}

You MUST respond with ONLY a valid JSON object. Do not include any markdown formatting, backticks, or conversational text. 
The JSON object must EXACTLY follow this structure:

{{
  "summary": "A 2-3 sentence overall risk summary of this document in easy understandable language.",
  "red_flags": [
    {{
      "severity": "HIGH", 
      "title": "Short descriptive title",
      "excerpt": "Copy the exact relevant text from the document - keep it under 200 chars",
      "issue": "Clear, human-readable explanation of why this is a red flag and what it means for the user"
    }}
  ]
}}

Severity must be exactly "HIGH", "MEDIUM", or "LOW".
If no red flags are found, return an empty array for "red_flags".

Focus on:
- Automatic renewal or subscription traps
- Unilateral right to change terms without notice
- Hidden fees, penalties, or charges
- Broad liability exclusions favoring the company
- Aggressive data collection or sharing with third parties
- Mandatory arbitration limiting legal rights

ONLY output valid JSON. No other text."""

        # Ask Ollama to output JSON
        response = ollama.chat(
            model=model,
            messages=[{'role': 'user', 'content': prompt}],
            format='json'
        )

        import json
        raw = response['message']['content']
        
        try:
            parsed = json.loads(raw)
            return {
                "summary": parsed.get("summary", "Analysis complete."),
                "red_flags": parsed.get("red_flags", [])
            }
        except json.JSONDecodeError:
            # Fallback if the model completely fails JSON generation
            return {
                "summary": "The analysis completed, but the model generated unparseable output. Please try re-analyzing.",
                "red_flags": []
            }

    except Exception as e:
        raise Exception(f"Error analyzing document: {str(e)}")


def suggest_alternative(
    red_flag_title: str,
    red_flag_excerpt: str,
    red_flag_issue: str,
    model: str = "llama3.2"
) -> str:
    """
    Given a specific red flag, return negotiation advice and fairer clause alternatives.
    """
    try:
        prompt = f"""You are a legal advisor helping a user understand their options regarding a concerning clause in a contract.

RED FLAG: {red_flag_title}
CLAUSE: "{red_flag_excerpt}"
CONCERN: {red_flag_issue}

Please provide a practical response with three clear sections:

1. FAIRER ALTERNATIVE
   Write a reworded version of this clause that better protects the user's rights.

2. HOW TO NEGOTIATE
   Practical steps the user can take to push back on or modify this clause before signing.

3. WHAT TO WATCH FOR
   Key things to verify or clarify before agreeing to this type of clause.

Use clear, plain language. Be specific and actionable."""

        response = ollama.chat(
            model=model,
            messages=[{'role': 'user', 'content': prompt}]
        )
        return response['message']['content']

    except Exception as e:
        raise Exception(f"Error generating alternative: {str(e)}")
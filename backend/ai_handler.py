import os
import json
from dotenv import load_dotenv
load_dotenv()
from groq import Groq
from document_processor import query_document

# Initialize Groq client
client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

def _get_groq_model(model_name: str) -> str:
    # Always default to groq's fast model if a local model name is passed
    return "llama-3.1-8b-instant"

def chat_with_document(document_id: str, question: str, model: str = "llama-3.1-8b-instant", stream: bool = False):
    try:
        relevant_chunks = query_document(document_id, question, n_results=3)
        context = "\n\n---\n\n".join([chunk["text"] for chunk in relevant_chunks])
        
        prompt = f"""You are a helpful assistant that answers questions about documents.

Based on the following relevant excerpts from the document, please answer the question.

Relevant excerpts:
{context}

Question: {question}

Please provide a clear and concise answer based on the excerpts above. If the excerpts don't contain enough information to answer the question, say so."""

        groq_model = _get_groq_model(model)

        if stream:
            def stream_generator():
                chat_completion = client.chat.completions.create(
                    messages=[{'role': 'user', 'content': prompt}],
                    model=groq_model,
                    stream=True
                )
                for chunk in chat_completion:
                    if chunk.choices[0].delta.content is not None:
                        yield chunk.choices[0].delta.content
            return stream_generator()

        response = client.chat.completions.create(
            messages=[{'role': 'user', 'content': prompt}],
            model=groq_model
        )
        return response.choices[0].message.content
        
    except Exception as e:
        raise Exception(f"Error communicating with Groq: {str(e)}")


def get_available_models():
    """Get list of available Groq models"""
    return ["llama-3.1-8b-instant", "llama3-70b-8192", "mixtral-8x7b-32768"]


def analyze_document_for_flags(document_id: str, model: str = "llama-3.1-8b-instant", stream: bool = False):
    try:
        relevant_chunks = query_document(
            document_id,
            "contract terms conditions obligations liability fees penalties renewal "
            "termination indemnification arbitration data privacy amendments rights waiver",
            n_results=15
        )

        if not relevant_chunks:
            raise Exception("No content found in document")

        context = "\n\n---\n\n".join([chunk["text"] for chunk in relevant_chunks])
        MAX_CONTEXT_CHARS = 25_000 # Groq can handle larger contexts extremely fast

        if len(context) > MAX_CONTEXT_CHARS:
            context = context[:MAX_CONTEXT_CHARS] + "\n\n[... document truncated for analysis ...]"

        prompt = f"""You are an expert legal analyst. Analyze the following document excerpts.

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

Severity must be exactly "HIGH", "MEDIUM", or "LOW". If no red flags are found, return an empty array for "red_flags".
Focus on: traps, changes without notice, hidden fees, broad liability, data sharing, mandatory arbitration.
ONLY output valid JSON. No other text."""

        groq_model = _get_groq_model(model)

        if stream:
            def stream_gen():
                chat_completion = client.chat.completions.create(
                    messages=[{'role': 'user', 'content': prompt}],
                    model=groq_model,
                    response_format={"type": "json_object"},
                    temperature=0,
                    stream=True
                )
                for chunk in chat_completion:
                    if chunk.choices[0].delta.content is not None:
                        yield chunk.choices[0].delta.content
            return stream_gen()

        response = client.chat.completions.create(
            messages=[{'role': 'user', 'content': prompt}],
            model=groq_model,
            response_format={"type": "json_object"},
            temperature=0
        )
        
        raw = response.choices[0].message.content
        try:
            parsed = json.loads(raw)
            return {
                "summary": parsed.get("summary", "Analysis complete."),
                "red_flags": parsed.get("red_flags", [])
            }
        except json.JSONDecodeError:
            return {
                "summary": "The analysis completed, but the model generated unparseable output.",
                "red_flags": []
            }

    except Exception as e:
        raise Exception(f"Error analyzing document with Groq: {str(e)}")


def suggest_alternative(
    red_flag_title: str,
    red_flag_excerpt: str,
    red_flag_issue: str,
    model: str = "llama-3.1-8b-instant"
) -> str:
    try:
        prompt = f"""You are a friendly legal advisor. A user found a concerning clause in their contract.

RED FLAG: {red_flag_title}
CLAUSE: "{red_flag_excerpt}"
CONCERN: {red_flag_issue}

Give exactly 4 to 5 short and simple suggestions as numbered points (1. 2. 3. etc).
Each point should be one or two sentences max, written in plain everyday language that anyone can understand.

STRICT RULES:
- Do NOT use any asterisks (*), dashes (-), bullet points, bold text, headers, or any markdown formatting.
- Do NOT use legal jargon. Write like you are explaining to a friend.
- Start each point directly with the number and a period (e.g. "1. Ask them to...")
- Keep the total response under 150 words."""

        groq_model = _get_groq_model(model)
        
        response = client.chat.completions.create(
            messages=[{'role': 'user', 'content': prompt}],
            model=groq_model
        )
        return response.choices[0].message.content

    except Exception as e:
        raise Exception(f"Error generating alternative: {str(e)}")

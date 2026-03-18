import ollama
from typing import Generator

class LegalHandler:
    def __init__(self, model_name: str = "llama2"):
        self.model_name = model_name
        self.system_prompt = """You are a helpful legal information assistant. You provide general legal information and guidance, but you are NOT a lawyer and do not provide official legal advice.

Important guidelines:
- Always remind users that this is general information, not legal advice
- Suggest consulting with a licensed attorney for specific legal matters
- Provide factual, balanced information about legal topics
- Cite general legal principles when relevant
- Be clear about jurisdictional differences when applicable
- Never guarantee legal outcomes

Always include a disclaimer in your responses when appropriate."""

    def chat(self, message: str) -> str:
        """Send a message and get a response"""
        try:
            response = ollama.chat(
                model=self.model_name,
                messages=[
                    {
                        'role': 'system',
                        'content': self.system_prompt
                    },
                    {
                        'role': 'user',
                        'content': message
                    }
                ]
            )
            return response['message']['content']
        except Exception as e:
            raise Exception(f"Error in legal chat: {str(e)}")

    def chat_stream(self, message: str) -> Generator[str, None, None]:
        """Stream chat responses"""
        try:
            stream = ollama.chat(
                model=self.model_name,
                messages=[
                    {
                        'role': 'system',
                        'content': self.system_prompt
                    },
                    {
                        'role': 'user',
                        'content': message
                    }
                ],
                stream=True
            )
            
            for chunk in stream:
                if 'message' in chunk and 'content' in chunk['message']:
                    yield chunk['message']['content']
        except Exception as e:
            raise Exception(f"Error in legal chat stream: {str(e)}")

    def chat_with_history(self, messages: list) -> str:
        """Chat with conversation history"""
        try:
            # Add system prompt at the beginning
            full_messages = [
                {
                    'role': 'system',
                    'content': self.system_prompt
                }
            ] + messages
            
            response = ollama.chat(
                model=self.model_name,
                messages=full_messages
            )
            return response['message']['content']
        except Exception as e:
            raise Exception(f"Error in legal chat with history: {str(e)}")
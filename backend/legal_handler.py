import os
from typing import Generator
from dotenv import load_dotenv
load_dotenv()
from groq import Groq

class LegalHandler:
    def __init__(self, model_name: str = "llama-3.1-8b-instant"):
        self.model_name = "llama-3.1-8b-instant" if "llama" in model_name.lower() else model_name
        self.client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
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
            response = self.client.chat.completions.create(
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
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"Error in legal chat: {str(e)}")

    def chat_stream(self, message: str) -> Generator[str, None, None]:
        """Stream chat responses"""
        try:
            stream = self.client.chat.completions.create(
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
                if chunk.choices[0].delta.content is not None:
                    yield chunk.choices[0].delta.content
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
            
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=full_messages
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"Error in legal chat with history: {str(e)}")
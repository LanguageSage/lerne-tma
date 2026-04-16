import aiohttp
import asyncio

class AIService:
    """Service to handle AI requests across providers (TMA version)."""
    
    def __init__(self, provider="ollama", api_key=None, ollama_url="http://localhost:11434"):
        self.provider = provider
        self.api_key = api_key
        self.ollama_url = ollama_url.rstrip("/")

    async def chat_completion(self, system_prompt, user_message, model):
        """Route to correct provider."""
        if self.provider == "ollama" or model.startswith("ollama/"):
            return await self._ollama_chat(system_prompt, user_message, model)
        else:
            return await self._openrouter_chat(system_prompt, user_message, model)

    async def _ollama_chat(self, system_prompt, user_message, model):
        # Remove 'ollama/' prefix if present
        model_name = model.split("/", 1)[1] if "/" in model else model
        url = f"{self.ollama_url}/api/chat"
        
        payload = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            "stream": False
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=120)) as resp:
                    data = await resp.json()
                    if resp.status != 200:
                        return f"❌ Ollama Error: {data.get('error', 'Unknown')}", False
                    return data["message"]["content"], True
        except Exception as e:
            return f"❌ Ollama connection error: {str(e)}", False

    async def _openrouter_chat(self, system_prompt, user_message, model):
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-Title": "Lerne TMA"
        }
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ]
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=payload, timeout=aiohttp.ClientTimeout(total=120)) as resp:
                    data = await resp.json()
                    if resp.status != 200:
                        error_msg = data.get("error", {}).get("message", "Unknown error")
                        return f"❌ OpenRouter Error: {error_msg}", False
                    return data["choices"][0]["message"]["content"], True
        except Exception as e:
            return f"❌ OpenRouter connection error: {str(e)}", False

import aiohttp
import asyncio
import re
import logging

logger = logging.getLogger(__name__)

class AIService:
    """Service to handle AI requests across providers (TMA version)."""
    
    def __init__(self, provider="ollama", api_key=None, ollama_url="http://localhost:11434"):
        self.provider = provider
        self.api_key = api_key
        self.ollama_url = ollama_url.rstrip("/")

    async def chat_completion(self, system_prompt, user_message, model):
        """Route to correct provider."""
        if self.provider == "google" or "gemini" in model.lower():
            return await self._google_chat(system_prompt, user_message, model)
        elif self.provider == "ollama" or model.startswith("ollama/"):
            return await self._ollama_chat(system_prompt, user_message, model)
        else:
            return await self._openrouter_chat(system_prompt, user_message, model)

    async def _google_chat(self, system_prompt, user_message, model):
        """Direct call to Google Gemini API."""
        model_name = model if "gemini" in model else "gemini-2.5-flash"
        logger.info(f"AI: Requesting Google Gemini ({model_name})...")
        
        if "/" in model_name:
            model_name = model_name.split("/")[-1]

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={self.api_key}"
        
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": f"System: {system_prompt}\n\nUser: {user_message}"}
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 2048,
            }
        }
        
        max_retries = 3
        for attempt in range(max_retries):
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=60)) as resp:
                        data = await resp.json()
                        if resp.status == 429:
                            wait_time = (attempt + 1) * 5
                            if "error" in data and "message" in data["error"]:
                                # Пробуем извлечь время ожидания из сообщения
                                match = re.search(r"retry in ([\d.]+)s", data["error"]["message"])
                                if match:
                                    wait_time = float(match.group(1)) + 1
                            
                            logger.warning(f"Google Quota Exceeded. Attempt {attempt+1}/{max_retries}. Waiting {wait_time}s...")
                            await asyncio.sleep(wait_time)
                            continue

                        if resp.status != 200:
                            error_msg = data.get("error", {}).get("message", "Unknown Google API error")
                            return f"❌ Google API Error: {error_msg}", False
                        
                        try:
                            content = data["candidates"][0]["content"]["parts"][0]["text"]
                            return content, True
                        except (KeyError, IndexError):
                            return "❌ Google API Error: Unexpected response format", False
            except Exception as e:
                if attempt == max_retries - 1:
                    return f"❌ Google connection error: {str(e)}", False
                await asyncio.sleep(2)
        
        return "❌ Google API Error: Max retries exceeded", False

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
        logger.info(f"AI: Requesting OpenRouter ({model})...")
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

    async def get_models(self):
        """Fetch available models from the provider."""
        if self.provider == "google":
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={self.api_key}"
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            return [m["name"].split("/")[-1] for m in data.get("models", []) 
                                    if "generateContent" in m.get("supportedGenerationMethods", [])]
            except: pass
            return ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-flash-latest"]

        if self.provider == "openrouter":
            url = "https://openrouter.ai/api/v1/models"
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            all_models = [m["id"] for m in data.get("data", [])]
                            # Приоритезируем Gemini и бесплатные модели
                            fav_models = [m for m in all_models if "gemini" in m.lower() or ":free" in m.lower()]
                            return fav_models if fav_models else all_models[:15]
            except: pass
            return [
                "google/gemini-2.5-flash", 
                "google/gemini-2.5-flash-8b",
                "google/gemini-2.0-flash-exp:free",
                "google/gemini-2.0-pro-exp-02-05:free"
            ]

        if self.provider == "ollama":
            url = f"{self.ollama_url}/api/tags"
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            return [m["name"] for m in data.get("models", [])]
            except: pass
            return ["llama3", "mistral"]
            
        return []

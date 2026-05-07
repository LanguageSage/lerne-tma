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
        self.groq_url = "https://api.groq.com/openai/v1"

    async def chat_completion(self, system_prompt, user_message, model):
        """Route to correct provider."""
        if self.provider == "google" or "gemini" in model.lower():
            return await self._google_chat(system_prompt, user_message, model)
        elif self.provider == "groq" or model.startswith("groq/"):
            return await self._groq_chat(system_prompt, user_message, model)
        elif self.provider == "ollama" or model.startswith("ollama/"):
            return await self._ollama_chat(system_prompt, user_message, model)
        else:
            return await self._openrouter_chat(system_prompt, user_message, model)

    async def _google_chat(self, system_prompt, user_message, model):
        """Direct call to Google Gemini API."""
        # gemini-2.5-flash is now a valid model in 2026
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
        timeout = aiohttp.ClientTimeout(total=45)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            for attempt in range(max_retries):
                try:
                    async with session.post(url, json=payload) as resp:
                        data = await resp.json()
                        if resp.status == 429:
                            wait_time = (attempt + 1) * 3
                            if "error" in data and "message" in data["error"]:
                                match = re.search(r"retry in ([\d.]+)s", data["error"]["message"])
                                if match: wait_time = float(match.group(1)) + 0.5
                            logger.warning(f"Google Quota Exceeded. Attempt {attempt+1}/{max_retries}. Waiting {wait_time}s...")
                            if attempt < max_retries - 1:
                                await asyncio.sleep(wait_time)
                                continue
                            return f"Quota Exceeded (Limit reached). Please try again in a few minutes.", False
                        
                        if resp.status != 200:
                            error_msg = data.get("error", {}).get("message", "Unknown Google API error")
                            logger.error(f"Google API Error ({resp.status}): {error_msg}")
                            if resp.status >= 500 and attempt < max_retries - 1:
                                await asyncio.sleep(1)
                                continue
                            return f"Server Error ({resp.status}): {error_msg}", False
                        
                        try:
                            content = data["candidates"][0]["content"]["parts"][0]["text"]
                            return content, True
                        except (KeyError, IndexError):
                            return "Parsing Error: Unexpected response format from Google", False
                except asyncio.TimeoutError:
                    logger.warning(f"Google Timeout (Attempt {attempt+1}/{max_retries})")
                    if attempt < max_retries - 1: continue
                    return "Timeout Error: Google API did not respond in time", False
                except Exception as e:
                    logger.error(f"Google connection error (Attempt {attempt+1}): {str(e)}")
                    if attempt == max_retries - 1:
                        return f"Connection Error: {str(e)}", False
                    await asyncio.sleep(1)
        return "Max Retries Error: All attempts failed", False
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

    async def _groq_chat(self, system_prompt, user_message, model):
        """Request to Groq Cloud API."""
        model_name = model.split("/", 1)[1] if "/" in model else model
        logger.info(f"AI: Requesting Groq ({model_name})...")
        
        url = f"{self.groq_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            "temperature": 0.7
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=payload, timeout=aiohttp.ClientTimeout(total=60)) as resp:
                    data = await resp.json()
                    if resp.status != 200:
                        error_msg = data.get("error", {}).get("message", "Unknown Groq error")
                        logger.error(f"Groq API Error ({resp.status}): {error_msg}")
                        return f"❌ Groq Error: {error_msg}", False
                    return data["choices"][0]["message"]["content"], True
        except Exception as e:
            logger.error(f"Groq connection error: {str(e)}")
            return f"❌ Groq connection error: {str(e)}", False

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
            return ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-flash-latest"]

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
                "google/gemini-2.5-flash-lite",
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

        if self.provider == "groq":
            url = f"{self.groq_url}/models"
            headers = {"Authorization": f"Bearer {self.api_key}"}
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            return [m["id"] for m in data.get("data", [])]
            except: pass
            return ["llama3-70b-8192", "llama3-8b-8192", "mixtral-8x7b-32768", "gemma-7b-it"]
            
        return []

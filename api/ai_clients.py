import aiohttp
import asyncio
import re
import logging
import random
import time

logger = logging.getLogger(__name__)

class AIService:
    """Service to handle AI requests across providers (TMA version)."""
    
    def __init__(self, provider="ollama", api_key=None, ollama_url="http://localhost:11434"):
        self.provider = provider
        self.api_key = api_key
        self.ollama_url = ollama_url.rstrip("/")
        self.groq_url = "https://api.groq.com/openai/v1"

    async def chat_completion(self, system_prompt, user_message, model):
        """Route to correct provider with unified retry logic."""
        # Priority 1: Explicit provider
        if self.provider == "google":
            return await self._google_chat(system_prompt, user_message, model)
        elif self.provider == "groq":
            return await self._groq_chat(system_prompt, user_message, model)
        elif self.provider == "ollama":
            return await self._ollama_chat(system_prompt, user_message, model)
        elif self.provider == "openrouter":
            return await self._openrouter_chat(system_prompt, user_message, model)
            
        # Priority 2: Fallback based on model name hints (only if provider is default/unknown)
        model_lower = model.lower()
        if model_lower.startswith("ollama/") or self.provider == "ollama":
            return await self._ollama_chat(system_prompt, user_message, model)
        elif model_lower.startswith("groq/"):
            return await self._groq_chat(system_prompt, user_message, model)
        elif "gemini" in model_lower and "/" not in model: # Direct google only if no slash (OpenRouter uses slash)
            return await self._google_chat(system_prompt, user_message, model)
        else:
            # Default to OpenRouter for everything else
            return await self._openrouter_chat(system_prompt, user_message, model)

    async def _make_request(self, url, method="POST", headers=None, json_data=None, timeout=30, provider_name="AI"):
        """Unified request handler with exponential backoff for 429 and 5xx errors."""
        max_retries = 2
        base_delay = 2  # Начальная задержка 2 секунды
        
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as session:
            for attempt in range(max_retries):
                try:
                    start_time = time.time()
                    async with session.request(method, url, headers=headers, json=json_data) as resp:
                        duration = time.time() - start_time
                        
                        if resp.status == 200:
                            data = await resp.json()
                            logger.info(f"{provider_name}: Success in {duration:.2f}s")
                            return data, True
                        
                        # Обработка ошибок
                        error_data = {}
                        try:
                            error_data = await resp.json()
                        except:
                            error_text = await resp.text()
                            error_data = {"error": {"message": error_text}}
                            
                        error_msg = error_data.get("error", {}).get("message", "Unknown error")
                        
                        # 429 (Rate Limit) или 5xx (Server Error / 503 Service Unavailable)
                        if resp.status == 429 or resp.status >= 500:
                            wait_time = base_delay * (2 ** attempt) + random.uniform(0, 1)
                            
                            # Специфичная логика для Google (они иногда пишут сколько ждать)
                            if resp.status == 429 and "retry in" in str(error_msg).lower():
                                match = re.search(r"retry in ([\d.]+)s", str(error_msg))
                                if match: wait_time = float(match.group(1)) + 1
                            
                            logger.warning(f"{provider_name} Error {resp.status} (Attempt {attempt+1}/{max_retries}). Requested wait: {wait_time:.1f}s. Msg: {error_msg}")
                            
                            # Если сервер просит ждать слишком долго (>5 секунд), не блокируем worker/соединение.
                            # Сразу возвращаем ошибку, чтобы включился механизм фолбэка на другие модели.
                            if wait_time > 5:
                                logger.warning(f"{provider_name}: Wait time {wait_time:.1f}s is too long. Skipping retry to allow immediate model fallback.")
                                return f"{provider_name} Error {resp.status}: {error_msg}", False

                            if attempt < max_retries - 1:
                                await asyncio.sleep(wait_time)
                                continue
                            return f"{provider_name} Error {resp.status}: {error_msg}", False
                        
                        # Другие ошибки (400, 401, 404 и т.д.) - не ретраим
                        logger.error(f"{provider_name} Fatal Error {resp.status}: {error_msg}")
                        return f"{provider_name} Error {resp.status}: {error_msg}", False
                        
                except asyncio.TimeoutError:
                    logger.warning(f"{provider_name} Timeout (Attempt {attempt+1}/{max_retries})")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(base_delay * (attempt + 1))
                        continue
                    return f"{provider_name} Timeout: Request took too long", False
                except Exception as e:
                    logger.error(f"{provider_name} Connection Error (Attempt {attempt+1}): {str(e)}")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(base_delay)
                        continue
                    return f"{provider_name} Connection Error: {str(e)}", False
                    
        return "Unknown error occurred", False

    async def _google_chat(self, system_prompt, user_message, model):
        """Direct call to Google Gemini API."""
        model_name = model if "gemini" in model.lower() else "gemini-2.0-flash"
        if "/" in model_name:
            model_name = model_name.split("/")[-1]
        
        # Strip OpenRouter suffixes like :free or :beta
        if ":" in model_name:
            model_name = model_name.split(":")[0]

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={self.api_key}"
        payload = {
            "contents": [{"role": "user", "parts": [{"text": f"System: {system_prompt}\n\nUser: {user_message}"}]}],
            "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2048}
        }
        
        data, success = await self._make_request(url, json_data=payload, provider_name="Google")
        if not success: return data, False
        
        try:
            content = data["candidates"][0]["content"]["parts"][0]["text"]
            return content, True
        except (KeyError, IndexError):
            return "Parsing Error: Unexpected response format from Google", False

    async def _ollama_chat(self, system_prompt, user_message, model):
        model_name = model.split("/", 1)[1] if "/" in model else model
        url = f"{self.ollama_url}/api/chat"
        payload = {
            "model": model_name,
            "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_message}],
            "stream": False
        }
        
        data, success = await self._make_request(url, json_data=payload, timeout=45, provider_name="Ollama")
        if not success: return data, False
        return data["message"]["content"], True

    async def _groq_chat(self, system_prompt, user_message, model):
        model_name = model.split("/", 1)[1] if "/" in model else model
        url = f"{self.groq_url}/chat/completions"
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = {
            "model": model_name,
            "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_message}],
            "temperature": 0.7
        }
        
        data, success = await self._make_request(url, headers=headers, json_data=payload, provider_name="Groq")
        if not success: return data, False
        return data["choices"][0]["message"]["content"], True

    async def _openrouter_chat(self, system_prompt, user_message, model):
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json", "X-Title": "Lerne TMA"}
        payload = {
            "model": model,
            "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_message}]
        }
        
        data, success = await self._make_request(url, headers=headers, json_data=payload, timeout=45, provider_name="OpenRouter")
        if not success: return data, False
        return data["choices"][0]["message"]["content"], True

    async def get_models(self):
        """Fetch available models from the provider."""
        if self.provider == "google":
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={self.api_key}"
            data, success = await self._make_request(url, method="GET", timeout=10, provider_name="Google_Models")
            if success:
                return [m["name"].split("/")[-1] for m in data.get("models", []) if "generateContent" in m.get("supportedGenerationMethods", [])]
            return ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-flash-latest"]

        if self.provider == "openrouter":
            url = "https://openrouter.ai/api/v1/models"
            data, success = await self._make_request(url, method="GET", timeout=10, provider_name="OpenRouter_Models")
            if success:
                all_models = [m["id"] for m in data.get("data", [])]
                fav_models = [m for m in all_models if "gemini" in m.lower() or ":free" in m.lower()]
                return fav_models if fav_models else all_models[:15]
            return [
                "google/gemini-2.5-flash-lite",
                "google/gemini-2.5-flash", 
                "google/gemini-2.5-flash-8b",
                "google/gemini-2.0-flash-exp:free",
                "google/gemini-2.0-pro-exp-02-05:free"
            ]

        if self.provider == "ollama":
            url = f"{self.ollama_url}/api/tags"
            data, success = await self._make_request(url, method="GET", timeout=5, provider_name="Ollama_Models")
            if success:
                return [m["name"] for m in data.get("models", [])]
            return ["llama3", "mistral"]

        if self.provider == "groq":
            url = f"{self.groq_url}/models"
            headers = {"Authorization": f"Bearer {self.api_key}"}
            data, success = await self._make_request(url, method="GET", headers=headers, timeout=10, provider_name="Groq_Models")
            if success:
                return [m["id"] for m in data.get("data", [])]
            return ["llama3-70b-8192", "llama3-8b-8192", "mixtral-8x7b-32768", "gemma-7b-it"]
            
        return []

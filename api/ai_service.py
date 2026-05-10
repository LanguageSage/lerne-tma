import re
import json
import logging
import time

logger = logging.getLogger(__name__)

# Универсальные импорты
try:
    import models
    from models import TMASetting, TMAUserPrompt, lerne_db
    import ai_clients
    from ai_clients import AIService
except ImportError:
    try:
        from api import models
        from api.models import TMASetting, TMAUserPrompt, lerne_db
        from api import ai_clients
        from api.ai_clients import AIService
    except ImportError as e:
        logger.error(f"Critical Import Error in ai_service: {e}")
        # Создаем заглушки, чтобы не падало с NameError, но работало с ошибкой
        class TMASetting:
            @staticmethod
            def get_or_none(*args, **kwargs): return None
        class AIService:
            def __init__(self, *args, **kwargs): pass
            async def chat_completion(self, *args, **kwargs): return "Import Error", False
            async def get_models(self): return []

DEFAULT_PROMPTS = {
    "de": """Проанализируй предложение "{phrase}". объясни слова с переводом на русский и грамматику, затем 3 примера. Очень коротко и ясно.
Return ONLY a JSON object in this format:
{
  "front": "{phrase}",
  "back": "перевод фразы",
  "context": "слово 1 - перевод\\nслово 2 - перевод\\n\\nПримеры:\\n1. нем. - рус.\\n2. нем. - рус.\\n3. нем. - рус."
}
END_JSON""",
    "ru": """Переведи "{phrase}" на немецкий. Проанализируй перевод: объясни слова с переводом на русский и грамматику, затем 3 примера. Очень коротко и ясно.
Return ONLY a JSON object in this format:
{
  "front": "German translation",
  "back": "{phrase}",
  "context": "слово 1 - перевод\\nслово 2 - перевод\\n\\nПримеры:\\n1. нем. - рус.\\n2. нем. - рус.\\n3. нем. - рус."
}
END_JSON"""
}

def detect_language(text: str) -> str:
    """Heuristic to detect if text is Russian or German/Other."""
    if any('\u0400' <= char <= '\u04FF' for char in text):
        return "ru"
    return "de"

async def generate_card_fields(user_id: int, phrase: str):
    """Generates Front, Back, and Context for a card using AI."""
    lang = detect_language(phrase)
    
    # Получаем настройки ИИ
    ai_provider = TMASetting.get_or_none(TMASetting.key == "AI_PROVIDER")
    provider = ai_provider.value if ai_provider else "google" 
    if provider == "default":
        provider = "google"
    
    if provider == "google":
        key_name = "GOOGLE_API_KEY"
    elif provider == "groq":
        key_name = "GROQ_API_KEY"
    else:
        key_name = "OPENROUTER_API_KEY"
    
    ai_key_record = TMASetting.get_or_none(TMASetting.key == key_name)
    
    # Сначала ищем в настройках БД, потом в переменных окружения
    ai_key = ai_key_record.value if ai_key_record else None
    if not ai_key:
        import os
        ai_key = os.environ.get(key_name)
    
    if not ai_key and provider != "ollama":
        return {"error": f"API ключ для {provider} не настроен. Обратитесь к администратору или введите свой в Настройках."}

    # Промпты пользователя (если есть)
    ai_model_record = TMASetting.get_or_none(TMASetting.key == "DEFAULT_MODEL")
    if not ai_model_record:
        ai_model_record = TMASetting.get_or_none(TMASetting.key == "AI_MODEL")
    ai_model = ai_model_record.value if ai_model_record else None
    
    # Промпты пользователя (если есть)
    user_prompts = TMAUserPrompt.get_or_none(TMAUserPrompt.user_id == user_id)
    
    base_prompt = DEFAULT_PROMPTS.get(lang, DEFAULT_PROMPTS["de"])
    if user_prompts:
        # Если у пользователя есть кастомный промпт, используем его, иначе дефолт
        system_prompt = user_prompts.translation_prompt or base_prompt
    else:
        system_prompt = base_prompt
        
    # Подставляем фразу в промпт (если там есть плейсхолдер)
    system_prompt = system_prompt.replace("{phrase}", phrase)
    
    # Добавляем инструкцию про JSON, если её нет (для кастомных промптов)
    if "JSON" not in system_prompt.upper():
        system_prompt += "\nReturn ONLY a JSON object with 'front', 'back', and 'context' keys."

    client = AIService(
        provider=provider, 
        api_key=ai_key
    )
    
    # По умолчанию используем gemini-2.0-flash как наиболее стабильный
    if provider == "openrouter":
        default_model = "google/gemini-2.0-flash-lite:free"
        if ai_model and "/" not in ai_model:
            model_name = f"google/{ai_model}"
        else:
            model_name = ai_model if ai_model else default_model
    elif provider == "groq":
        default_model = "llama3-70b-8192"
        model_name = ai_model if ai_model else default_model
    else:
        # Для Google используем 2.0 Flash как стандарт
        default_model = "gemini-2.0-flash"
        model_name = ai_model if ai_model else default_model
    
    logger.info(f"AI: Generating card fields using {provider}/{model_name}...")
    start_time = time.time()
    
    response, success = await client.chat_completion(
        system_prompt=system_prompt,
        user_message=phrase,
        model=model_name
    )
    
    # Fallback если основная модель (возможно, опечатка или нестабильна) упала
    if not success and model_name != default_model:
        logger.warning(f"AI: Primary model {model_name} failed. Falling back to {default_model}...")
        response, success = await client.chat_completion(
            system_prompt=system_prompt,
            user_message=phrase,
            model=default_model
        )
    
    if not success:
        duration = time.time() - start_time
        logger.error(f"AI: Generation failed after {duration:.2f}s: {response}")
        return {"error": response}
    
    duration = time.time() - start_time
    logger.info(f"AI: Generation successful in {duration:.2f}s")
    
    # Пытаемся извлечь JSON
    try:
        # Убираем маркер END_JSON если он есть
        clean_response = response.replace("END_JSON", "").strip()
        
        # Убираем markdown блоки
        if "```" in clean_response:
            # Ищем содержимое между ```json и ``` или просто ```
            match = re.search(r'```(?:json)?\s*(.*?)\s*```', clean_response, re.DOTALL | re.IGNORECASE)
            if match:
                clean_response = match.group(1).strip()
            else:
                # Если не нашли закрывающих, просто убираем начало
                clean_response = re.sub(r'^```(?:json)?\n?', '', clean_response, flags=re.IGNORECASE).strip()
        
        # Ищем JSON объект (первая { и последняя })
        first_brace = clean_response.find('{')
        last_brace = clean_response.rfind('}')
        
        if first_brace != -1:
            if last_brace != -1 and last_brace > first_brace:
                json_str = clean_response[first_brace:last_brace+1]
            else:
                json_str = clean_response[first_brace:]
            
            # Если JSON кажется оборванным, пробуем закрыть скобки
            open_count = json_str.count('{')
            close_count = json_str.count('}')
            if open_count > close_count:
                json_str += '}' * (open_count - close_count)
            
            try:
                data = json.loads(json_str)
            except json.JSONDecodeError:
                # Если всё еще не парсится, пробуем почистить от лишних запятых перед }
                json_str = re.sub(r',\s*\}', '}', json_str)
                try:
                    data = json.loads(json_str)
                except:
                    # Последний шанс: вырезаем только нужные поля регулярками
                    data = {
                        "front": (re.search(r'"front":\s*"(.*?)"', json_str) or re.search(r'"front":\s*"(.*)', json_str)).group(1) if '"front"' in json_str else phrase,
                        "back": (re.search(r'"back":\s*"(.*?)"', json_str) or re.search(r'"back":\s*"(.*)', json_str)).group(1) if '"back"' in json_str else "",
                        "context": (re.search(r'"context":\s*"(.*?)"', json_str) or re.search(r'"context":\s*"(.*)', json_str)).group(1) if '"context"' in json_str else ""
                    }
                    
            return {
                "front": data.get("front", phrase),
                "back": data.get("back", ""),
                "context": data.get("context", "")
            }
    except Exception as e:
        logger.error(f"Failed to parse AI JSON: {e}. Raw response: {response}")

    # Fallback если JSON не удался
    return {
        "front": phrase,
        "back": response,
        "context": ""
    }

async def get_provider_models(provider: str, ollama_url: str = None):
    """Fetches models from the specified provider dynamically."""
    if provider == "google":
        key_name = "GOOGLE_API_KEY"
    elif provider == "groq":
        key_name = "GROQ_API_KEY"
    else:
        key_name = "OPENROUTER_API_KEY"
        
    ai_key = TMASetting.get_or_none(TMASetting.key == key_name)
    
    client = AIService(
        provider=provider, 
        api_key=ai_key.value if ai_key else None,
        ollama_url=ollama_url or "http://localhost:11434"
    )
    
    return await client.get_models()

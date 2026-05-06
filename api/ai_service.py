import re
import json
import logging

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
    "de": """Проанализируй предложение "{phrase}", переведи каждое слово и объясни грамматику. не используй таблицы. пиши максимально кратко, ни слова лишнего. дай 3 примера используй теже глаголы что и в предложении. напиши перевод ключевых слов.
Return ONLY a JSON object in this format:
{
  "front": "the original phrase",
  "back": "the translation",
  "context": "context sentence and analysis"
}""",
    "ru": """Переведи фразу "{phrase}" на немецкий. Проанализируй только перевод на немецкий. изучается немецкий на уровне Б1, переведи каждое слово и объясни грамматику. не используй таблицы. пиши максимально кратко, ни слова лишнего. дай 3 примера на немецким с переводом на русскмй, используй теже глаголы что и в предложении.
Return ONLY a JSON object in this format:
{
  "front": "German translation",
  "back": "Russian phrase",
  "context": "context sentence and analysis"
}"""
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
    provider = ai_provider.value if ai_provider else "openrouter"
    
    key_name = "GOOGLE_API_KEY" if provider == "google" else "OPENROUTER_API_KEY"
    ai_key_record = TMASetting.get_or_none(TMASetting.key == key_name)
    ai_key = ai_key_record.value if ai_key_record else None
    
    if not ai_key and provider != "ollama":
        return {"error": f"API ключ для {provider} не настроен. Перейдите в Настройки -> AI."}

    ai_model_record = TMASetting.get_or_none(TMASetting.key == "AI_MODEL")
    ai_model = ai_model_record.value if ai_model_record else None
    
    # Промпты пользователя (если есть)
    user_prompts = TMAUserPrompt.get_or_none(TMAUserPrompt.user_id == user_id)
    
    base_prompt = DEFAULT_PROMPTS[lang]
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
    
    # Default models fallback (Gemini 2.5 is the new standard in 2026)
    default_model = "google/gemini-2.5-flash" if provider == "openrouter" else "gemini-2.5-flash"
    model_name = ai_model if ai_model else default_model
    
    response, success = await client.chat_completion(
        system_prompt=system_prompt,
        user_message=phrase,
        model=model_name
    )
    
    if not success:
        return {"error": response}
    
    # Пытаемся извлечь JSON
    try:
        # Ищем JSON в ответе (на случай если ИИ добавил лишний текст)
        json_match = re.search(r'\{.*\}', response, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group(0))
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
    key_name = "GOOGLE_API_KEY" if provider == "google" else "OPENROUTER_API_KEY"
    ai_key = TMASetting.get_or_none(TMASetting.key == key_name)
    
    client = AIService(
        provider=provider, 
        api_key=ai_key.value if ai_key else None,
        ollama_url=ollama_url or "http://localhost:11434"
    )
    
    return await client.get_models()

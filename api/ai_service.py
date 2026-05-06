import re
import json
import logging

logger = logging.getLogger(__name__)

# Универсальные импорты
try:
    from models import TMASetting, TMAUserPrompt, lerne_db
    from ai_clients import AIService
except ImportError:
    try:
        from api.models import TMASetting, TMAUserPrompt, lerne_db
        from api.ai_clients import AIService
    except ImportError:
        logger.error("Could not import models or ai_clients")

DEFAULT_TRANSLATION_PROMPT = """You are a professional language tutor. 
Translate the given phrase into the user's language (default: Russian).
Provide a clear context sentence.
Return ONLY a JSON object in this format:
{
  "front": "the original phrase",
  "back": "the translation",
  "context": "context sentence in the original language"
}"""

async def generate_card_fields(user_id: int, phrase: str):
    """Generates Front, Back, and Context for a card using AI."""
    # Получаем настройки ИИ
    ai_provider = TMASetting.get_or_none(TMASetting.key == "AI_PROVIDER")
    provider = ai_provider.value if ai_provider else "openrouter"
    
    key_name = "GOOGLE_API_KEY" if provider == "google" else "OPENROUTER_API_KEY"
    ai_key = TMASetting.get_or_none(TMASetting.key == key_name)
    
    ai_model = TMASetting.get_or_none(TMASetting.key == "AI_MODEL")
    
    # Промпты пользователя (если есть)
    user_prompts = TMAUserPrompt.get_or_none(TMAUserPrompt.user_id == user_id)
    
    system_prompt = user_prompts.translation_prompt if user_prompts and user_prompts.translation_prompt else DEFAULT_TRANSLATION_PROMPT
    
    # Добавляем инструкцию про JSON, если её нет
    if "JSON" not in system_prompt.upper():
        system_prompt += "\nReturn ONLY a JSON object with 'front', 'back', and 'context' keys."

    client = AIService(
        provider=provider, 
        api_key=ai_key.value if ai_key else None
    )
    
    default_model = "google/gemini-2.0-flash-lite-001" if provider == "openrouter" else "gemini-1.5-flash"
    model_name = ai_model.value if ai_model else default_model
    
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

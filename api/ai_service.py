import re
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

DEFAULT_TRANSLATION_PROMPT = "You are a professional language tutor. Translate the phrase to Russian and provide a clear context sentence."

async def generate_card_fields(user_id: int, phrase: str):
    """Generates Front, Back, and Context for a card using AI."""
    # Получаем настройки ИИ
    ai_key = TMASetting.get_or_none(TMASetting.key == "OPENROUTER_API_KEY")
    ai_model = TMASetting.get_or_none(TMASetting.key == "AI_MODEL")
    
    # Промпты пользователя (если есть)
    user_prompts = TMAUserPrompt.get_or_none(TMAUserPrompt.user_id == user_id)
    
    system_prompt = user_prompts.translation_prompt if user_prompts and user_prompts.translation_prompt else DEFAULT_TRANSLATION_PROMPT
    
    client = AIService(
        provider="openrouter", 
        api_key=ai_key.value if ai_key else None
    )
    
    model_name = ai_model.value if ai_model else "google/gemini-2.0-flash-lite-001"
    
    response, success = await client.chat_completion(
        system_prompt=system_prompt,
        user_message=phrase,
        model=model_name
    )
    
    if not success:
        return {"error": response}
        
    # Парсим ответ (ожидаем формат Front: ... Back: ... Context: ...)
    # Это упрощенная логика, в оригинале она может быть сложнее
    return {
        "front": phrase,
        "back": response,
        "context": ""
    }

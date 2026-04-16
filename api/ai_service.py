import re
from tma.api.models import TMASetting, TMAUserPrompt
from tma.api.ai_clients import AIService

# Пытаемся получить живые промпты из базы Lerne
def get_lerne_prompts():
    try:
        from tma.api.models import lerne_db
        with lerne_db.bind_ctx([TMASettingLerne]):
            tr = TMASettingLerne.get_or_none(TMASettingLerne.key == "TRANSLATE_PROMPT")
            ctx = TMASettingLerne.get_or_none(TMASettingLerne.key == "CONTEXT_PROMPT")
            return (tr.value if tr else DEFAULT_TRANSLATION_PROMPT), (ctx.value if ctx else "")
    except:
        return DEFAULT_TRANSLATION_PROMPT, ""

async def generate_card_fields(user_id: int, phrase: str):
    """Generates Front, Back, and Context for a card using Lerne's actual prompts."""
    # 1. Get Global Settings (TMA side)
    config = {s.key: s.value for s in TMASetting.select()}
    provider = config.get("AI_PROVIDER", "ollama")
    api_key = config.get("OPENROUTER_KEY") or config.get("ANY_API_KEY") 
    ollama_url = config.get("OLLAMA_URL", "http://localhost:11434")
    model = config.get("DEFAULT_MODEL", "google/gemini-2.0-flash-lite-preview-02-05:free")

    # 2. Get Instructions (Lerne side)
    lerne_tr, lerne_ctx = get_lerne_prompts()
    
    # 3. Get User Personal Overrides
    user_prompt = TMAUserPrompt.get_or_none(TMAUserPrompt.user_id == user_id)
    system_prompt_base = user_prompt.translation_prompt if user_prompt and user_prompt.translation_prompt else lerne_tr
    
    # Собираем финальный промпт как в Lerne
    final_system_prompt = f"{system_prompt_base}\n\nИНСТРУКЦИЯ ПО КОНТЕКСТУ:\n{lerne_ctx}"

    # 4. Call AI
    ai = AIService(provider=provider, api_key=api_key, ollama_url=ollama_url)
    response, success = await ai.chat_completion(final_system_prompt, phrase, model)

    if not success:
        return {"error": response}

    # 5. Parse response
    # Ищем блоки "Перевод" и "Грамматика/Контекст"
    translation = ""
    context_full = ""

    # Пытаемся парсить по меткам из настроек (или дефолтным)
    # В Лерне это кнопки "ПЕРЕВОД" и "КОНТЕКСТ"
    # Для TMA сделаем гибкий поиск
    
    # Поиск Перевода
    trans_match = re.search(r"(?:Перевод|Translation|ПЕРЕВОД)\*\*?:\s*(.*?)(?=\s*\n\d+\.|\s*\n\*\*|\s*\n(?:Грамматика|Контекст|КОНТЕКСТ|Analysis)|$)", response, re.DOTALL | re.IGNORECASE)
    # Поиск всего остального (Контекст/Грамматика)
    cont_match = re.search(r"(?:Грамматика|Контекст|КОНТЕКСТ|Analysis|Explanation)\*\*?:\s*(.*)", response, re.DOTALL | re.IGNORECASE)

    if trans_match: 
        translation = trans_match.group(1).strip()
    else:
        # Если не нашли метку, берем первую строку как перевод
        lines = response.split('\n')
        translation = lines[0].strip()

    if cont_match:
        context_full = cont_match.group(1).strip()
    else:
        # Если не нашли метку контекста, кладем всё кроме первой строки в контекст
        lines = response.split('\n')
        if len(lines) > 1:
            context_full = "\n".join(lines[1:]).strip()

    return {
        "front": phrase,
        "back": translation or response,
        "context": context_full or "Анализ сгенерирован в свободном формате."
    }

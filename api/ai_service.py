import re
import json
import logging
import time

logger = logging.getLogger(__name__)

from api.models import TMASetting, TMAUserPrompt, lerne_db
from api.ai_clients import AIService

DEFAULT_PROMPTS = {
    "de": """Проанализируй немецкое предложение или слово "{phrase}". объясни слова с переводом на русский и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык немецкий, родной русский. пиши немецкий текст сложностью не выше уровня Б1""",
    "ru": """Переведи "{phrase}" на немецкий. Проанализируй перевод: объясни слова с переводом на русский и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык немецкий, родной русский. пиши немецкий текст сложностью не выше уровня Б1"""
}

def get_clean_instruction(text: str) -> str:
    if not text:
        return ""
    
    clean = text.strip()
    
    # Remove JSON instructions
    json_index = clean.upper().find("RETURN ONLY A JSON")
    if json_index != -1:
        clean = clean[:json_index].strip()
        
    # Remove prefix possibilities
    prefixes = [
        'Переведи "{phrase}" на немецкий. Проанализируй перевод:',
        'Переведи "{phrase}" на немецкий. Проанализируй перевод',
        'Переведи на немецкий. Проанализируй перевод:',
        'Проанализируй немецкое предложение или слово "{phrase}".',
        'Проанализируй немецкое предложение или слово "{phrase}"',
        'Проанализируй немецкое предложение или слово.',
        'Переведи {phrase} на немецкий. Проанализируй перевод:',
        'Проанализируй немецкое предложение или слово {phrase}.'
    ]
    
    for prefix in prefixes:
        if clean.lower().startswith(prefix.lower()):
            clean = clean[len(prefix):].strip()
            break
            
    return clean

def detect_language(text: str) -> str:
    """Heuristic to detect if text is Russian or German/Other."""
    if any('\u0400' <= char <= '\u04FF' for char in text):
        return "ru"
    return "de"


def get_ai_config():
    import os
    provider_rec = TMASetting.get_or_none(TMASetting.key == "AI_PROVIDER")
    provider = provider_rec.value if provider_rec and provider_rec.value != "default" else "google"
    
    key_map = {"google": "GOOGLE_API_KEY", "groq": "GROQ_API_KEY", "openrouter": "OPENROUTER_API_KEY"}
    key_name = key_map.get(provider, "")
    
    ai_key = None
    if key_name:
        key_rec = TMASetting.get_or_none(TMASetting.key == key_name)
        ai_key = key_rec.value if key_rec else os.environ.get(key_name)
        
    model_rec = TMASetting.get_or_none(TMASetting.key == "DEFAULT_MODEL")
    if not model_rec:
        model_rec = TMASetting.get_or_none(TMASetting.key == "AI_MODEL")
    model = model_rec.value if model_rec else None
    
    return provider, ai_key, model

def extract_json_from_text(text: str, default_front: str) -> dict:
    clean_text = text.replace("END_JSON", "").strip()
    
    if "```" in clean_text:
        match = re.search(r'```(?:json)?\s*(.*?)\s*```', clean_text, re.DOTALL | re.IGNORECASE)
        clean_text = match.group(1).strip() if match else re.sub(r'^```(?:json)?\n?', '', clean_text, flags=re.IGNORECASE).strip()
            
    first_brace = clean_text.find('{')
    last_brace = clean_text.rfind('}')
    
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        json_str = clean_text[first_brace:last_brace+1]
    elif first_brace != -1:
        json_str = clean_text[first_brace:]
    else:
        json_str = clean_text
        
    try:
        data = json.loads(json_str)
        return {
            "front": data.get("front", default_front),
            "back": data.get("back", ""),
            "context": data.get("context", "")
        }
    except json.JSONDecodeError:
        pass
        
    # Fallback to regex
    front = default_front
    back = context = ""
    m_front = re.search(r'"front"\s*:\s*"(.*?)"', text, re.DOTALL)
    if m_front: front = m_front.group(1).replace('\\"', '"')
    m_back = re.search(r'"back"\s*:\s*"(.*?)"', text, re.DOTALL)
    if m_back: back = m_back.group(1).replace('\\"', '"').replace('\\n', '\n')
    m_context = re.search(r'"context"\s*:\s*"(.*?)"', text, re.DOTALL)
    if m_context: context = m_context.group(1).replace('\\"', '"').replace('\\n', '\n')
    
    if not back and not context:
        return {"front": default_front, "back": text, "context": ""}
        
    return {"front": front, "back": back, "context": context}

async def generate_card_fields(user_id: int, phrase: str, target_language: str = "de", native_language: str = None):
    """Generates Front, Back, and Context for a card using AI."""
    start_time = time.time()
    try:
        from api.services.language_service import get_prompt_for_phrase, get_language_config, get_native_config
        from api.models import TMACustomPrompt, TMASetting

        if not native_language:
            native_rec = TMASetting.get_or_none(TMASetting.key == "NATIVE_LANGUAGE")
            native_language = native_rec.value if native_rec else "uk"
            
        target_lang = (target_language or "de").lower()
        native_lang = (native_language or "uk").lower()
        
        lang_config = get_language_config(target_lang, native_lang)
        native_config = get_native_config(native_lang)
        lang_name = lang_config["name"]
        
        provider, ai_key, ai_model = get_ai_config()
        
        if not ai_key and provider != "ollama":
            return {"error": f"API ключ для {provider} не настроен. Обратитесь к администратору или введите свой в Настройках."}

        custom_prompt = TMACustomPrompt.get_or_none(
            (TMACustomPrompt.user_id == user_id) & 
            (TMACustomPrompt.is_active == True) &
            ((TMACustomPrompt.target_language == target_lang) | (TMACustomPrompt.target_language.is_null()))
        )
        
        is_cyrillic = any('\u0400' <= char <= '\u04FF' for char in phrase)
        is_system_preset = custom_prompt and any(icon in (custom_prompt.name or "") for icon in ["🎯", "⚡", "🔥", "Уровень", "Рівень", "Level", "preset"])
        
        if custom_prompt and not is_system_preset:
            raw_prompt = custom_prompt.translation_prompt if is_cyrillic else custom_prompt.context_prompt
            system_prompt = (raw_prompt or get_prompt_for_phrase(phrase, target_lang, native_lang)).replace("{phrase}", phrase)
        else:
            system_prompt = get_prompt_for_phrase(phrase, target_lang, native_lang)

        if "JSON" not in system_prompt.upper():
            native_name = native_config["name"].lower()
            if is_cyrillic:
                system_prompt += f"\nReturn ONLY a JSON object in this format:\n{{\n  \"front\": \"перевод на {lang_name.lower()}\",\n  \"back\": \"{phrase}\",\n  \"context\": \"слово 1 - перевод\\nслово 2 - перевод\\n\\nПримеры:\\n1. текст - перевод\\n2. текст - перевод\\n3. текст - перевод\"\n}}\nEND_JSON"
            else:
                system_prompt += f"\nReturn ONLY a JSON object in this format:\n{{\n  \"front\": \"{phrase}\",\n  \"back\": \"перевод на {native_name}\",\n  \"context\": \"слово 1 - перевод\\nслово 2 - перевод\\n\\nПримеры:\\n1. текст - перевод\\n2. текст - перевод\\n3. текст - перевод\"\n}}\nEND_JSON"

        client = AIService(provider=provider, api_key=ai_key)
        
        if provider == "openrouter":
            default_model = "google/gemini-2.0-flash-lite:free"
            model_name = f"google/{ai_model}" if ai_model and "/" not in ai_model else (ai_model or default_model)
        elif provider == "groq":
            default_model = "llama3-70b-8192"
            model_name = ai_model or default_model
        else:
            default_model = "gemini-2.0-flash"
            model_name = ai_model or default_model
        
        logger.info(f"AI: Generating card fields using {provider}/{model_name}...")
        
        response, success = await client.chat_completion(
            system_prompt=system_prompt,
            user_message=phrase,
            model=model_name
        )
        
        duration = time.time() - start_time
        if not success:
            logger.error(f"AI: Generation failed after {duration:.2f}s: {response}")
            return {"error": response}
        
        logger.info(f"AI: Generation successful in {duration:.2f}s")
        return extract_json_from_text(response, phrase)
        
    except Exception as e:
        duration = time.time() - start_time
        logger.error(f"CRITICAL AI ERROR after {duration:.2f}s: {e}", exc_info=True)
        return {"error": f"Внутренняя ошибка сервера (БД/ИИ): {str(e)}"}

async def get_provider_models(provider: str, ollama_url: str = None):
    """Fetches models from the specified provider dynamically."""
    _, ai_key, _ = get_ai_config()
    
    client = AIService(
        provider=provider, 
        api_key=ai_key,
        ollama_url=ollama_url or "http://localhost:11434"
    )
    
    return await client.get_models()

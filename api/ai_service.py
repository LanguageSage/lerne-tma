import re
import json
import logging
import time

logger = logging.getLogger(__name__)

# Универсальные импорты
try:
    from api.models import TMASetting, TMAUserPrompt, lerne_db
    from api.ai_clients import AIService
except ImportError:
    try:
        from models import TMASetting, TMAUserPrompt, lerne_db
        from ai_clients import AIService
    except ImportError as e:
        logger.error(f"Critical Import Error in ai_service: {e}")
        class TMASetting:
            @staticmethod
            def get_or_none(*args, **kwargs): return None
        class TMAUserPrompt:
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

async def generate_card_fields(user_id: int, phrase: str):
    """Generates Front, Back, and Context for a card using AI."""
    lang = detect_language(phrase)
    
    provider, ai_key, ai_model = get_ai_config()
    
    if not ai_key and provider != "ollama":
        return {"error": f"API ключ для {provider} не настроен. Обратитесь к администратору или введите свой в Настройках."}

    user_prompts = TMAUserPrompt.get_or_none(TMAUserPrompt.user_id == user_id)
    base_prompt = DEFAULT_PROMPTS.get(lang, DEFAULT_PROMPTS["de"])
    system_prompt = user_prompts.translation_prompt or base_prompt if user_prompts else base_prompt
        
    system_prompt = system_prompt.replace("{phrase}", phrase)
    if "JSON" not in system_prompt.upper():
        system_prompt += "\nReturn ONLY a JSON object with 'front', 'back', and 'context' keys."

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
    start_time = time.time()
    
    try:
        response, success = await client.chat_completion(
            system_prompt=system_prompt,
            user_message=phrase,
            model=model_name
        )
        
        if not success and model_name != default_model:
            logger.warning(f"AI: Primary model {model_name} failed. Falling back to {default_model}...")
            response, success = await client.chat_completion(
                system_prompt=system_prompt,
                user_message=phrase,
                model=default_model
            )
        
        duration = time.time() - start_time
        if not success:
            logger.error(f"AI: Generation failed after {duration:.2f}s: {response}")
            return {"error": response}
        
        logger.info(f"AI: Generation successful in {duration:.2f}s")
        return extract_json_from_text(response, phrase)
        
    except Exception as e:
        logger.error(f"CRITICAL AI ERROR: {e}", exc_info=True)
        return {"error": f"Internal Server Error: {str(e)}"}

async def get_provider_models(provider: str, ollama_url: str = None):
    """Fetches models from the specified provider dynamically."""
    _, ai_key, _ = get_ai_config()
    
    client = AIService(
        provider=provider, 
        api_key=ai_key,
        ollama_url=ollama_url or "http://localhost:11434"
    )
    
    return await client.get_models()

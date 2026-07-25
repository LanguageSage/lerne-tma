import logging

logger = logging.getLogger(__name__)

LANGUAGE_CONFIG = {
    "de": {
        "name": "Немецкий",
        "code": "de",
        "flag": "🇩🇪",
        "tts_voice_front": "de-DE-KillianNeural",
        "tts_voice_back": "ru-RU-SvetlanaNeural",
        "tts_locale": "de-DE",
        "default_prompts": {
            "analysis": """Проанализируй немецкое предложение или слово "{phrase}". объясни слова с переводом на русский и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык немецкий, родной русский. пиши немецкий текст сложностью не выше уровня Б1""",
            "translation": """Переведи "{phrase}" на немецкий. Проанализируй перевод: объясни слова с переводом на русский и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык немецкий, родной русский. пиши немецкий текст сложностью не выше уровня Б1"""
        }
    },
    "en": {
        "name": "Английский",
        "code": "en",
        "flag": "🇬🇧",
        "tts_voice_front": "en-US-JennyNeural",
        "tts_voice_back": "ru-RU-SvetlanaNeural",
        "tts_locale": "en-US",
        "default_prompts": {
            "analysis": """Проанализируй английское предложение или слово "{phrase}". объясни слова с переводом на русский и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык английский, родной русский. пиши английский текст сложностью не выше уровня Б1""",
            "translation": """Переведи "{phrase}" на английский. Проанализируй перевод: объясни слова с переводом на русский и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык английский, родной русский. пиши английский текст сложностью не выше уровня Б1"""
        }
    },
    "no": {
        "name": "Норвежский",
        "code": "no",
        "flag": "🇳🇴",
        "tts_voice_front": "nb-NO-FinnNeural",
        "tts_voice_back": "ru-RU-SvetlanaNeural",
        "tts_locale": "nb-NO",
        "default_prompts": {
            "analysis": """Проанализируй норвежское предложение или слово "{phrase}". объясни слова с переводом на русский и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык норвежский, родной русский. пиши норвежский текст сложностью не выше уровня Б1""",
            "translation": """Переведи "{phrase}" на норвежский. Проанализируй перевод: объясни слова с переводом на русский и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык норвежский, родной русский. пиши норвежский текст сложностью не выше уровня Б1"""
        }
    }
}

def get_language_config(lang_code: str = "de") -> dict:
    code = (lang_code or "de").lower().strip()
    return LANGUAGE_CONFIG.get(code, LANGUAGE_CONFIG["de"])

def get_prompt_for_phrase(phrase: str, target_lang: str = "de") -> str:
    cfg = get_language_config(target_lang)
    # Detect if phrase is Russian (Cyrillic) -> needs translation to target lang
    is_cyrillic = any('\u0400' <= char <= '\u04FF' for char in phrase)
    
    prompt_key = "translation" if is_cyrillic else "analysis"
    raw_prompt = cfg["default_prompts"][prompt_key]
    return raw_prompt.format(phrase=phrase)

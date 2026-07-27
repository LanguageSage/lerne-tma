import logging

logger = logging.getLogger(__name__)

NATIVE_LANGUAGES = {
    "uk": {
        "code": "uk",
        "name": "Українська",
        "flag": "🇺🇦",
        "default_tts_voice": "uk-UA-PolinaNeural",
        "target_names": {
            "de": ("німецьке", "німецьку", "Німецька"),
            "en": ("англійське", "англійську", "Англійська"),
            "no": ("норвезьке", "норвезьку", "Норвезька"),
            "uk": ("українське", "українську", "Українська")
        },
        "prompts": {
            "analysis": 'Проаналізуй {adj} речення або слово "{phrase}". Поясни слова з перекладом на українську та детально граматику, потім 3 приклади з іншими варіантами того ж змісту. Ізучаемый язык {name}, рідна мова українська. Пиши {adj} текст складністю не вище рівня Б1',
            "translation": 'Переклади "{phrase}" на {acc_name}. Проаналізуй переклад: поясни слова з перекладом на українську та детально граматику, потім 3 приклади з іншими варіантами того ж змісту. Ізучаемый язык {name}, рідна мова українська. Пиши {adj} текст складністю не вище рівня Б1',
            "preset_instruction": 'поясни слова з перекладом на українську та детально граматику, потім 3 приклади з іншими варіантами того ж змісту. Ізучаемый язык {adj} рівня {level}, рідна мова українська. Пиши {adj} текст складністю не вище рівня {level}'
        },
        "preset_titles": {
            "A2": "🎯 Рівень A2 — Базовий ({lang_name})",
            "B1": "⚡ Рівень B1 — Впевнений ({lang_name})",
            "B2": "🔥 Рівень B2 — Просунутий ({lang_name})"
        },
        "preset_descriptions": {
            "A2": "Простий розбір слів та базової граматики {adj} мови рівня А2 з 3 прикладами.",
            "B1": "Оптимальний баланс: розбір слів, пояснення граматики {adj} мови та 3 приклади.",
            "B2": "Просунутий розбір складних мовних конструкцій рівня B2 з 3 прикладами."
        }
    },
    "ru": {
        "code": "ru",
        "name": "Русский",
        "flag": "🇷🇺",
        "default_tts_voice": "ru-RU-SvetlanaNeural",
        "target_names": {
            "de": ("немецкий", "немецкий"),
            "en": ("английский", "английский"),
            "no": ("норвежский", "норвежский"),
            "uk": ("украинский", "украинский")
        },
        "prompts": {
            "analysis": 'Проанализируй {adj} предложение или слово "{phrase}". объясни слова с переводом на русский и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык {name}, родной русский. пиши {adj} текст сложностью не выше уровня Б1',
            "translation": 'Переведи "{phrase}" на {acc_name}. Проанализируй перевод: объясни слова с переводом на русский и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык {name}, родной русский. пиши {adj} текст сложностью не выше уровня Б1',
            "preset_instruction": 'объясни слова с переводом на русский и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык {adj} уровня {level}, родной русский. пиши {adj} текст сложностью не выше уровня {level}'
        },
        "preset_titles": {
            "A2": "🎯 Уровень A2 — Базовый ({lang_name})",
            "B1": "⚡ Уровень B1 — Уверенный ({lang_name})",
            "B2": "🔥 Уровень B2 — Продвинутый ({lang_name})"
        },
        "preset_descriptions": {
            "A2": "Простой разбор слов и базовой грамматики {adj} языка уровня А2 с 3 примерами.",
            "B1": "Оптимальный баланс: разбор слов, объяснение грамматики {adj} языка и 3 примера.",
            "B2": "Продвинутый разбор сложных языковых конструкций уровня B2 с 3 примерами."
        }
    },
    "en": {
        "code": "en",
        "name": "English",
        "flag": "🇬🇧",
        "default_tts_voice": "en-US-JennyNeural",
        "target_names": {
            "de": ("German", "German"),
            "en": ("English", "English"),
            "no": ("Norwegian", "Norwegian"),
            "uk": ("Ukrainian", "Ukrainian")
        },
        "prompts": {
            "analysis": 'Analyze the {adj} sentence or word "{phrase}". Explain words with translation to English and detailed grammar, then 3 examples with other options of the same meaning. Target language is {name}, native language is English. Write {adj} text with complexity no higher than B1 level',
            "translation": 'Translate "{phrase}" into {acc_name}. Analyze the translation: explain words with translation to English and detailed grammar, then 3 examples with other options of the same meaning. Target language is {name}, native language is English. Write {adj} text with complexity no higher than B1 level',
            "preset_instruction": 'Explain words with translation to English and detailed grammar, then 3 examples with other options of the same meaning. Target language is {adj} level {level}, native language is English. Write {adj} text with complexity no higher than level {level}'
        },
        "preset_titles": {
            "A2": "🎯 Level A2 — Basic ({lang_name})",
            "B1": "⚡ Level B1 — Confident ({lang_name})",
            "B2": "🔥 Level B2 — Advanced ({lang_name})"
        },
        "preset_descriptions": {
            "A2": "Simple word breakdown and basic grammar of {adj} language at A2 level with 3 examples.",
            "B1": "Optimal balance: word breakdown, grammar explanation of {adj} language and 3 examples.",
            "B2": "Advanced breakdown of complex language structures at B2 level with 3 examples."
        }
    }
}

TARGET_LANGUAGES = {
    "de": {"code": "de", "name": "Немецкий", "flag": "🇩🇪", "tts_voice_front": "de-DE-KillianNeural", "tts_locale": "de-DE"},
    "en": {"code": "en", "name": "Английский", "flag": "🇬🇧", "tts_voice_front": "en-US-JennyNeural", "tts_locale": "en-US"},
    "no": {"code": "no", "name": "Норвежский", "flag": "🇳🇴", "tts_voice_front": "nb-NO-FinnNeural", "tts_locale": "nb-NO"},
    "uk": {"code": "uk", "name": "Украинский", "flag": "🇺🇦", "tts_voice_front": "uk-UA-PolinaNeural", "tts_locale": "uk-UA"}
}

def get_native_config(native_code: str = "uk") -> dict:
    code = (native_code or "uk").lower().strip()
    return NATIVE_LANGUAGES.get(code, NATIVE_LANGUAGES["uk"])

def get_language_config(lang_code: str = "de", native_lang: str = "uk") -> dict:
    code = (lang_code or "de").lower().strip()
    target = TARGET_LANGUAGES.get(code, TARGET_LANGUAGES["de"]).copy()
    native_cfg = get_native_config(native_lang)
    target["tts_voice_back"] = native_cfg["default_tts_voice"]
    return target

def get_prompt_for_phrase(phrase: str, target_lang: str = "de", native_lang: str = "uk") -> str:
    native_cfg = get_native_config(native_lang)
    target_code = (target_lang or "de").lower().strip()
    tinfo = native_cfg["target_names"].get(target_code, (target_code, target_code, target_code))
    adj = tinfo[0]
    acc_name = tinfo[1]
    name = tinfo[2] if len(tinfo) > 2 else adj.capitalize()
    
    is_cyrillic = any('\u0400' <= char <= '\u04FF' for char in phrase)
    prompt_template = native_cfg["prompts"]["translation"] if is_cyrillic else native_cfg["prompts"]["analysis"]
    
    return prompt_template.format(
        phrase=phrase,
        adj=adj,
        acc_name=acc_name,
        name=name
    )

def get_system_presets(target_lang: str = "de", native_lang: str = "uk") -> list:
    native_cfg = get_native_config(native_lang)
    target_code = (target_lang or "de").lower().strip()
    target_info = native_cfg["target_names"].get(target_code, (target_code, target_code, target_code))
    adj = target_info[0]
    lang_name = adj.capitalize()

    levels = [
        ("preset_a2", "A2", "Базовый"),
        ("preset_b1", "B1", "Рекомендуемый"),
        ("preset_b2", "B2", "Продвинутый")
    ]
    
    presets = []
    for pid, lvl, badge in levels:
        instruction = native_cfg["prompts"]["preset_instruction"].format(adj=adj, level=lvl)
        title = native_cfg["preset_titles"][lvl].format(lang_name=lang_name)
        desc = native_cfg["preset_descriptions"][lvl].format(adj=adj)
        presets.append({
            "id": pid,
            "name": title,
            "level": lvl,
            "badge": badge,
            "description": desc,
            "instruction": instruction,
            "prompt_type": "standard"
        })

    presets.append({
        "id": "preset_trainer",
        "name": f"🎯 Грамматический Тренажёр ({lang_name})",
        "level": "Trainer",
        "badge": "Тренажёр",
        "description": f"Генерирует предложения с проверяемым словом в скобках {{слово}} и с подробнейшим разбором правил на обороте.",
        "instruction": f"Генерируй карточки для изучения грамматики языка {lang_name}. Оборачивай проверяемую грамматическую форму или артикль в фигурные скобки {{слово}} в предложении на лицевой стороне (например: Ich sehe {{den}} Hund). На обратной стороне напиши подробный и развернутый грамматический разбор правила: падеж, род, склонение/спряжение и понятные примеры.",
        "prompt_type": "trainer"
    })

    return presets


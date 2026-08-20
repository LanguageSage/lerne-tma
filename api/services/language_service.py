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

def build_card_prompt(phrase: str, target_lang: str = "de", native_lang: str = "uk", directive: str = None) -> str:
    lang_config = get_language_config(target_lang, native_lang)
    native_config = get_native_config(native_lang)
    lang_name = lang_config["name"]
    native_name = native_config["name"]

    directive_block = ""
    qa_instruction = ""
    if directive:
        directive_block = f"\n\nДополнительное указание или вопрос пользователя: \"{directive}\". Выполни просьбу пользователя."
        qa_instruction = f"❓ **Вопрос:** {directive}\n💡 **Ответ:** [ёмкий ответ на вопрос]\n\n"

    is_cyrillic = any('\u0400' <= char <= '\u04FF' for char in phrase)
    if is_cyrillic:
        prompt = (
            f"Изучаемый язык: {lang_name}. Родной язык: {native_name}.\n"
            f"Создай карточку для перевода на {lang_name}: \"{phrase}\".{directive_block}\n\n"
            f"ПРАВИЛА:\n"
            f"1. \"front\": точный перевод фразы на {lang_name} (без скобок и вопросов).\n"
            f"2. \"back\": исходная фраза на {native_name} (\"{phrase}\").\n"
            f"3. \"context\": структурированный текст:\n"
            f"   {qa_instruction}"
            f"📖 **Словарь**:\n"
            f"• слово — перевод\n\n"
            f"💡 **Грамматика**:\n"
            f"[объяснение правила и формы]\n\n"
            f"✨ **Примеры**:\n"
            f"1. [фраза на {lang_name}] — [перевод на {native_name}]\n"
            f"2. [фраза на {lang_name}] — [перевод на {native_name}]\n"
            f"3. [фраза на {lang_name}] — [перевод на {native_name}]\n\n"
            f"Return ONLY a JSON object in this format:\n{{\n"
            f'  "front": "перевод на {lang_name.lower()}",\n'
            f'  "back": "{phrase}",\n'
            f'  "context": "..."\n'
            f"}}\nEND_JSON"
        )
    else:
        prompt = (
            f"Изучаемый язык: {lang_name}. Родной язык: {native_name}.\n"
            f"Создай карточку для фразы: \"{phrase}\".{directive_block}\n\n"
            f"ПРАВИЛА:\n"
            f"1. \"front\": только чистая фраза на {lang_name} (без скобок и вопросов).\n"
            f"2. \"back\": точный перевод на {native_name}.\n"
            f"3. \"context\": структурированный текст:\n"
            f"   {qa_instruction}"
            f"📖 **Словарь**:\n"
            f"• слово — перевод\n\n"
            f"💡 **Грамматика**:\n"
            f"[объяснение правила и формы]\n\n"
            f"✨ **Примеры**:\n"
            f"1. [фраза на {lang_name}] — [перевод на {native_name}]\n"
            f"2. [фраза на {lang_name}] — [перевод на {native_name}]\n"
            f"3. [фраза на {lang_name}] — [перевод на {native_name}]\n\n"
            f"Return ONLY a JSON object in this format:\n{{\n"
            f'  "front": "{phrase}",\n'
            f'  "back": "перевод на {native_name.lower()}",\n'
            f'  "context": "..."\n'
            f"}}\nEND_JSON"
        )
    return prompt

def build_custom_directive_prompt(phrase: str, directive: str, target_lang: str = "de", native_lang: str = "uk") -> str:
    lang_config = get_language_config(target_lang, native_lang)
    native_config = get_native_config(native_lang)
    lang_name = lang_config["name"]
    native_name = native_config["name"]

    question_or_directive = directive if directive else phrase
    prompt = (
        f"Изучаемый язык: {lang_name}. Родной язык: {native_name}.\n"
        f"Фраза: \"{phrase}\"\n"
        f"Вопрос или просьба: \"{question_or_directive}\"\n\n"
        f"Выполни просьбу пользователя и дай чёткий ответ.\n\n"
        f"Формат вывода (строго Markdown):\n"
        f"❓ **Вопрос:** {question_or_directive}\n"
        f"💡 **Ответ:** [твой ответ]"
    )
    return prompt

def build_rule_explanation_prompt(phrase: str, target_lang: str = "de", native_lang: str = "uk") -> str:
    lang_config = get_language_config(target_lang, native_lang)
    native_config = get_native_config(native_lang)
    lang_name = lang_config["name"]
    native_name = native_config["name"]

    prompt = (
        f"Ты — профессиональный преподаватель языка {lang_name}.\n"
        f"Проанализируй пропуск в фигурных скобках {{...}} или ключевую конструкцию в предложении: \"{phrase}\".\n\n"
        f"ЗАДАЧА:\n"
        f"1. Дай точный перевод предложения на {native_name} язык.\n"
        f"2. Подробно и понятно объясни грамматическое правило для пропуска {{...}} (почему используется именно эта форма слова, падеж, управление глагола или артикль).\n"
        f"3. Приведи 2 наглядных примера аналогичных предложений.\n\n"
        f"Верни результат СТРОГО в формате JSON:\n"
        f"{{\n"
        f'  "front": "{phrase}",\n'
        f'  "back": "[точный перевод на {native_name} с подставленным правильным словом в пропуске]",\n'
        f'  "context": "📖 **Грамматическое правило**:\\n[Подробное объяснение правила, падежа или формы слова]\\n\\n💡 **Примеры**:\\n• [Пример 1]\\n• [Пример 2]"\n'
        f"}}\n"
    )
    return prompt

def get_system_presets(target_lang: str = "de", native_lang: str = None) -> list:
    if not native_lang:
        try:
            from api import models
            native_rec = models.TMASetting.get_or_none(models.TMASetting.key == "NATIVE_LANGUAGE")
            native_lang = native_rec.value if native_rec else "ru"
        except Exception:
            native_lang = "ru"

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
        "description": f"Генерирует предложения и письма с пропусками {{вариант1|вариант2|вариант3}} и с полным текстом и построчным переводом на обороте.",
        "instruction": (
            f"Ты — профессиональный преподаватель языка {lang_name} для подготовки к экзаменам (A1-C1).\n"
            f"Создавай карточки-тренажёры для изучения грамматики и лексики.\n\n"
            f"ПРАВИЛА ОФОРМЛЕНИЯ:\n"
            f"1. На ЛИЦЕВОЙ стороне (front) пиши предложение или письмо на {lang_name}.\n"
            f"   Оборачивай каждый пропуск в фигурные скобки с 3 вариантами через вертикальную черту {{вариант1|вариант2|вариант3}}.\n"
            f"   Правильный ответ отметь звёздочкой {{*правильный|неверный1|неверный2}} или поставь первым.\n"
            f"   Пример: Sehr geehrter {{Herr Bauer|Frau Bauer|Firma Mustermann}},\n   wir möchten Sie daran erinnern, dass Ihre Bestellung noch zur Abholung bereitliegt. Leider konnten wir bisher keinen Kontakt mit {{*Ihnen|Sie|Ihr}} aufnehmen.\n\n"
            f"2. На ОБРАТНОЙ стороне (back) ОБЯЗАТЕЛЬНО пиши:\n"
            f"   🎯 **Полный текст с построчным переводом**: весь текст на {lang_name} с подставленными правильными ответами, сопровождаемый точным построчным/параллельным переводом каждого предложения на русский язык.\n\n"
            f"   💡 **Разбор ответов и словарный запас**: краткие пояснения правильных ответов и перевод ключевых сложных слов (например: die Filiale — филиал; aushändigen — выдать; gegenstandslos — недействительный)."
        ),
        "prompt_type": "trainer"
    })

    presets.append({
        "id": "preset_exam",
        "name": f"📝 Экзаменационный тест ({lang_name})",
        "level": "Exam",
        "badge": "Тест",
        "description": f"Генерирует вопросы экзаменационного формата с выбором ответа (2-6 вариантов с [*] и [ ]) и подробным грамматическим разбором на обороте без лишних примеров.",
        "instruction": (
            f"Ты — профессиональный экзаменатор языка {lang_name} для подготовки к официальным экзаменам (A1-C1).\n"
            f"Создавай экзаменационные карточки с выбором вариантов ответа (Multiple Choice).\n\n"
            f"ПРАВИЛА ОФОРМЛЕНИЯ:\n"
            f"1. На ЛИЦЕВОЙ стороне (front):\n"
            f"   Напиши четкий вопрос или задание на языке {lang_name}.\n"
            f"   Ниже напиши варианты ответа (от 2 до 6 вариантов) в формате чекбоксов:\n"
            f"   [*] Правильный вариант ответа\n"
            f"   [ ] Неправильный вариант 1\n"
            f"   [ ] Неправильный вариант 2\n"
            f"   [ ] Неправильный вариант 3\n\n"
            f"2. На ОБРАТНОЙ стороне (back) ОБЯЗАТЕЛЬНО пиши:\n"
            f"   🎯 **Перевод**: точный перевод вопроса и всех вариантов ответа на русский язык.\n\n"
            f"   💡 **Грамматический разбор**: понятное и точное объяснение, почему выбранный ответ правильный, и в чём заключается грамматическая или смысловая ошибка других вариантов. Дополнительные 3 примера писать НЕ нужно!"
        ),
        "prompt_type": "exam"
    })

    return presets


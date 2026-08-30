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

def get_cefr_rubric(target_language: str = "de") -> str:
    """Returns a tailored, highly accurate dual CEFR rubric (Grammar + Vocabulary) for the target language (de, en, no)."""
    code = (target_language or "de").lower().strip()

    if code == "en":
        return (
            "КРИТЕРИИ CEFR ДЛЯ АНГЛИЙСКОГО ЯЗЫКА (определяй уровень как МАКСИМУМ из сложности грамматики и сложности лексики):\n\n"
            "1. ГРАММАТИКА:\n"
            "• A1: Present Simple, Present Continuous, базовый Past Simple (be, go, see), модальный can, базовые предлоги (in, at, on), простые вопросы.\n"
            "• A2: Past Continuous, Present Perfect Simple (just, already, yet), Future (will, going to), Conditionals 0 и 1-й (if/when), модальные (should, must, have to), сравнительные степени.\n"
            "• B1: Present Perfect Continuous, Past Perfect (had done), 2-й Conditional (would + V), Passive Voice (Present/Past Simple), придаточные определительные (relative clauses: which, who, that), косвенная речь (reported speech), модальные предположения (might, could).\n"
            "• B2: 3-й Conditional (had been... would have done), Mixed Conditionals, Passive всех времен и модальный пассив, конструкции Wish / If only, Causative (have/get smth done), союзы противопоставления (whereas, despite, nevertheless), инверсии.\n"
            "• C1/C2: Сложные причастные обороты (Having finished...), эмфатические конструкции Cleft sentences (What surprised me was...), сложные инверсии (No sooner had...), субъюнктив (It is crucial that he be...), сложные идиомы.\n\n"
            "2. ЛЕКСИКА:\n"
            "• A1: Базовый быт, семья, еда, простые действия, цифры, цвета, погода.\n"
            "• A2: Покупки, работа, транспорт, здоровье, хобби, базовые фразовые глаголы.\n"
            "• B1: Описание чувств, планов, мнений, путешествия, социальные темы, базовые абстрактные понятия.\n"
            "• B2: Профессиональная, деловая, академическая лексика, устойчивые фразовые глаголы и коллокации.\n"
            "• C1/C2: Академические/юридические термины, узкоспециализированная лексика, идиоматические выражения, метафоры."
        )

    elif code in ("no", "nb", "nn"):
        return (
            "КРИТЕРИИ CEFR ДЛЯ НОРВЕЖСКОГО ЯЗЫКА (определяй уровень как МАКСИМУМ из сложности грамматики и сложности лексики):\n\n"
            "1. ГРАММАТИКА:\n"
            "• A1: Presens, Preteritum (слабые и простые сильные глаголы), прямой порядок слов и базовое правило инверсии V2, притяжательные местоимения, базовые предлоги.\n"
            "• A2: Perfektum (har gjort), придаточные предложения с союзами fordi, at, hvis, da/når, модальные глаголы (skal, vil, må, bør, kan), степени сравнения прилагательных, возвратные местоимения (seg).\n"
            "• B1: Pluskvamperfektum (hadde gjort), Passiv с s-verb и bli-passiv (ble skrevet), инфинитивные обороты (for å...), союзы selv om, mens, ettersom, действительные и страдательные причастия (partisipper).\n"
            "• B2: Двойные союзы (jo... desto, ikke bare... men også), согласование причастий (samsvarsbøying), сложные условные конструкции (hadde jeg visst...), косвенная речь, инверсии в начале предложения.\n"
            "• C1/C2: Сложные причастные конструкции, пассивные стилистические обороты, инверсивные стилистические структуры, устойчивые идиоматические обороты, формальный/академический синтаксис.\n\n"
            "2. ЛЕКСИКА:\n"
            "• A1: Базовый быт, еда, семья, числа, простые глаголы действия.\n"
            "• A2: Покупки, работа, путешествия, здоровье, базовые хобби и повседневные темы.\n"
            "• B1: Описание чувств, планов, мнений, стандартные абстрактные понятия, обсуждение новостей.\n"
            "• B2: Профессиональная, деловая, общественно-политическая лексика, устойчивые выражения.\n"
            "• C1/C2: Академические и юридические термины, идиомы, метафоры, стилистически окрашенная лексика."
        )

    else:
        # Default German (de)
        return (
            "ОПЕРАЦИОННАЯ СИСТЕМА КЛАССИФИКАЦИИ УЧЕБНЫХ ФРАЗ:\n\n"
            "ПРАВИЛА ОЦЕНКИ:\n"
            "1. Не определяй уровень по общему впечатлению от фразы.\n"
            "2. Сначала найди конкретные грамматические конструкции и сложную лексику.\n"
            "3. Уровень отдельной конструкции не равен уровню всего предложения.\n"
            "4. grammar_level = уровень самой сложной грамматической конструкции в предложении.\n"
            "5. vocabulary_level = уровень самого сложного существенного слова или устойчивого выражения.\n"
            "6. overall_level = МАКСИМУМ из grammar_level и vocabulary_level.\n"
            "7. Длина предложения не повышает уровень: оценивай только конкретные конструкции и лексику.\n\n"
            "1. ГРАММАТИЧЕСКАЯ КЛАССИФИКАЦИЯ:\n"
            "• A1:\n"
            "  - Präsens в простых утвердительных и вопросительных предложениях.\n"
            "  - Базовый порядок слов в главном предложении, формы sein, haben, отрицание nicht, kein.\n"
            "  - Nominativ и базовый Akkusativ, личные и притяжательные местоимения.\n"
            "  - Основные модальные глаголы в Präsens: können, müssen, wollen, dürfen, sollen, möchten.\n"
            "  - Базовые предлоги времени и места.\n"
            "  - Простые отделяемые глаголы в Präsens: aufstehen, einkaufen, anrufen.\n"
            "  - Imperativ в простых бытовых ситуациях.\n"
            "• A2:\n"
            "  - Perfekt как грамматическая конструкция: haben/sein + Partizip II (gemacht, gekauft, gegangen, gehört, eingegeben и др.).\n"
            "  - Отделяемые глаголы в Präsens и Perfekt.\n"
            "  - Präteritum основных часто употребляемых глаголов (war, hatte, musste, wollte, konnte).\n"
            "  - Dativ и предлоги Dativ (mit, nach, aus, zu, bei, von, seit).\n"
            "  - Возвратные глаголы (sich freuen, sich erinnern).\n"
            "  - Простые придаточные предложения с союзами weil, dass, wenn, ob, als (глагол в конце).\n"
            "  - Сравнительная степень прилагательных (größer, besser, am größten).\n"
            "  - Вежливые формы Konjunktiv II (möchte, könnte, hätte gern, wäre gern).\n"
            "  - Базовые конструкции с zu + Infinitiv.\n"
            "• B1:\n"
            "  - Придаточные предложения: obwohl, während, nachdem, bevor, seitdem, sodass.\n"
            "  - Инфинитивные конструкции: um ... zu, ohne ... zu, statt ... zu.\n"
            "  - Relativsätze (придаточные определительные: der, die, das, den, dem, deren).\n"
            "  - Passiv Präsens: wird gemacht, wird repariert.\n"
            "  - Полноценный Konjunktiv II для гипотез и условий (hätte, wäre, würde + Infinitiv).\n"
            "  - Plusquamperfekt, Futur I.\n"
            "  - Управление глаголов с предлогами (warten auf, denken an, sich interessieren für) и Pronominaladverbien (darauf, damit, daran).\n"
            "  - Предлоги с Genitiv: wegen, trotz, während, aufgrund.\n"
            "• B2:\n"
            "  - Passiv в сложных временах (ist gemacht worden, war gemacht worden) и с модальными (muss gemacht werden).\n"
            "  - Konjunktiv I и косвенная речь.\n"
            "  - Partizip I и Partizip II в роли распространенных определений.\n"
            "  - Сложные двойные союзы: je ... desto, nicht nur ... sondern auch, sowohl ... als auch, weder ... noch, zwar ... aber.\n"
            "  - Nomen-Verb-Verbindungen (eine Entscheidung treffen, zur Verfügung stehen).\n"
            "• C1/C2:\n"
            "  - sein + zu + Infinitiv, sich lassen + Infinitiv, сложные Partizipialkonstruktionen.\n"
            "  - Инверсия как средство организации текста, официальный, научный и академический синтаксис.\n\n"
            "2. ЛЕКСИЧЕСКАЯ КЛАССИФИКАЦИЯ:\n"
            "• A1: Быт, еда, семья, числа, время, погода, базовые действия (wohnen, essen, trinken, kaufen).\n"
            "• A2: Работа, банк, транспорт, здоровье, бытовые сервисы, базовая цифровая лексика (Passwort, Datei, App, herunterladen, anmelden, eingeben).\n"
            "• B1: Чувства, мнения, планы, аргументация, абстрактные понятия, обсуждение причин и последствий.\n"
            "• B2: Профессиональная, деловая, экономическая лексика (verschlüsseln, Verantwortung, Erfahrung).\n"
            "• C1/C2: Академическая, юридическая, научная лексика (Datenschutzbestimmung, Paradigmenwechsel), редкие идиомы."
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
            f"Язык всех пояснений и переводов: СТРОГО {native_name}, независимо от языка ввода.\n\n"
            f"1. \"front\": точный перевод фразы/слова на {lang_name} (без скобок и вопросов).\n"
            f"2. \"back\": точный перевод фразы/слова на {native_name} язык.\n"
            f"3. \"context\": структурированный текст:\n"
            f"   {qa_instruction}"
            f"📖 **Словарь**:\n"
            f"- [слово / глагол с артиклем на {lang_name}] — [перевод на {native_name}]\n\n"
            f"💡 **Грамматика**:\n"
            f"[объяснение правила, форм и конструкций]\n\n"
            f"✨ **Примеры**:\n"
            f"(Обязательно 3 примера предложений с использованием данного слова/фразы и их перевод):\n"
            f"1. [предложение на {lang_name}] — [перевод]\n"
            f"2. [предложение на {lang_name}] — [перевод]\n"
            f"3. [предложение на {lang_name}] — [перевод]\n\n"
            f"Return ONLY a JSON object in this format:\n{{\n"
            f'  "front": "перевод на {lang_name.lower()}",\n'
            f'  "back": "перевод на {native_name}",\n'
            f'  "context": "..."\n'
            f"}}\nEND_JSON"
        )
    else:
        prompt = (
            f"Изучаемый язык: {lang_name}. Родной язык: {native_name}.\n"
            f"Создай карточку для фразы/слова: \"{phrase}\".{directive_block}\n\n"
            f"ПРАВИЛА:\n"
            f"Язык всех пояснений и ответов: СТРОГО {native_name}.\n\n"
            f"1. \"front\": только чистая фраза/слово на {lang_name} (без скобок и вопросов).\n"
            f"2. \"back\": точный перевод на {native_name}.\n"
            f"3. \"context\": структурированный текст:\n"
            f"   {qa_instruction}"
            f"📖 **Словарь**:\n"
            f"- [слово / глагол с артиклем на {lang_name}] — [перевод на {native_name}]\n\n"
            f"💡 **Грамматика**:\n"
            f"[объяснение правила, форм и конструкций]\n\n"
            f"✨ **Примеры**:\n"
            f"(Обязательно 3 примера предложений с использованием данного слова/фразы и их перевод):\n"
            f"1. [предложение на {lang_name}] — [перевод]\n"
            f"2. [предложение на {lang_name}] — [перевод]\n"
            f"3. [предложение на {lang_name}] — [перевод]\n\n"
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
        f"Выполни просьбу пользователя и дай чёткий ответ СТРОГО на языке: {native_name}.\n\n"
        f"Формат вывода (строго Markdown):\n"
        f"❓ **Вопрос:** {question_or_directive}\n"
        f"💡 **Ответ:** [твой ответ на {native_name} языке]"
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
        f"Язык всех объяснений, примеров и перевода: СТРОГО {native_name}.\n\n"
        f"1. Дай точный перевод предложения на {native_name} язык.\n"
        f"2. Подробно и понятно объясни грамматическое правило для пропуска {{...}} на {native_name} языке (почему используется именно эта форма слова, падеж, управление глагола или артикль).\n"
        f"3. Приведи 2 наглядных примера аналогичных предложений с переводом на {native_name}.\n\n"
        f"Верни результат СТРОГО в формате JSON:\n"
        f"{{\n"
        f'  "front": "{phrase}",\n'
        f'  "back": "[точный перевод на {native_name} с подставленным правильным словом в пропуске]",\n'
        f'  "context": "📖 **Грамматическое правило**:\\n[Подробное объяснение правила на {native_name} языке]\\n\\n💡 **Примеры**:\\n• [Пример 1]\\n• [Пример 2]"\n'
        f"}}\n"
    )
    return prompt

def build_quiz_prompt(phrase_or_items, target_lang: str = "de", native_lang: str = "ru", is_batch: bool = False, detect_level: bool = True) -> str:
    """
    Единый источник истины (Single Source of Truth) для генерации экзаменационных тестов.
    Используется как для одиночной генерации (preset_exam), так и для пакетного обогащения тестов.
    """
    lang_config = get_language_config(target_lang, native_lang)
    native_config = get_native_config(native_lang)
    lang_name = lang_config["name"]
    native_name = native_config["name"]

    level_rule = '4. "level": определи CEFR уровень сложности вопроса ("A1", "A2", "B1", "B2", "C1", "C2").\n' if detect_level else ''
    json_level = ',\n  "level": "B1"' if detect_level else ''

    if is_batch:
        items_count = len(phrase_or_items) if isinstance(phrase_or_items, list) else "нескольких"
        return (
            f"Ты — профессиональный преподаватель языка {lang_name}.\n"
            f"Изучаемый язык: {lang_name}. Родной язык пользователя: {native_name}.\n\n"
            f"Тебе передан список из {items_count} вопросов с вариантами ответа.\n\n"
            f"ДЛЯ КАЖДОГО БЛОКА СФОРМИРУЙ ОБЪЕКТ:\n"
            f"Язык всех объяснений, словаря и перевода: СТРОГО {native_name}.\n\n"
            f"1. \"front\": Исходный текст вопроса и вариантов на {lang_name} (правильный вариант начинается со звёздочки '*').\n\n"
            f"2. \"back\": ПОЛНЫЙ перевод вопроса и ВСЕХ имеющихся вариантов ответа на {native_name} язык.\n"
            f"   - Сохрани точное количество вариантов (2, 3, 4 или более) и их исходный порядок.\n"
            f"   - Поставь зелёную галочку ✅ перед правильным вариантом ответа.\n\n"
            f"3. \"context\":\n"
            f"   🎯 **Объяснение**:\n"
            f"   [подробно: почему правилен именно этот ответ]\n\n"
            f"   📖 **Словарный запас**:\n"
            f"   - [слово / глагол / существительное с артиклем на {lang_name}] — [перевод на {native_name}]\n"
            f"   (подробный разбор всех ключевых слов и глаголов из вопроса и вариантов)\n\n"
            f"{level_rule}"
            f"5. \"card_type\": \"quiz\"\n\n"
            f"Верни СТРОГО валидный JSON-массив из {items_count} объектов:\n"
            f"[\n"
            f"  {{\n"
            f'    "front": "Frage auf {lang_name}?\\n\\nOption 1\\n*Option 2\\nOption 3",\n'
            f'    "back": "Перевод вопроса на {native_name}\\n\\n1. Перевод опции 1\\n2. ✅ Перевод правильной опции 2\\n3. Перевод опции 3",\n'
            f'    "context": "🎯 **Объяснение**:\\n...\\n\\n📖 **Словарный запас**:\\n- слово1 — перевод1\\n- die слово2 — перевод2",\n'
            f'    "level": "B1",\n'
            f'    "card_type": "quiz"\n'
            f"  }}\n"
            f"]\nEND_JSON"
        )
    else:
        clean_phrase = phrase_or_items if isinstance(phrase_or_items, str) else phrase_or_items[0]
        return (
            f"Ты — профессиональный преподаватель языка {lang_name}.\n"
            f"Изучаемый язык: {lang_name}. Родной язык пользователя: {native_name}.\n\n"
            f"Проанализируй вопрос с вариантами ответа:\n'{clean_phrase}'\n\n"
            f"ПРАВИЛА ОФОРМЛЕНИЯ:\n"
            f"Язык всех объяснений, словаря и перевода: СТРОГО {native_name}.\n\n"
            f"1. \"front\": Исходный текст вопроса и вариантов на {lang_name} без изменений.\n\n"
            f"2. \"back\": ПОЛНЫЙ перевод вопроса и ВСЕХ имеющихся вариантов ответа на {native_name} язык.\n"
            f"   - Сохрани точное количество вариантов (2, 3, 4 или более) и их исходный порядок.\n"
            f"   - Поставь зелёную галочку ✅ перед правильным вариантом ответа.\n\n"
            f"3. \"context\":\n"
            f"   🎯 **Объяснение**:\n"
            f"   [подробно: почему правилен именно этот ответ]\n\n"
            f"   📖 **Словарный запас**:\n"
            f"   - [слово / глагол / существительное с артиклем на {lang_name}] — [перевод на {native_name}]\n"
            f"   (подробный разбор всех ключевых слов и глаголов из вопроса и вариантов)\n\n"
            f"   💡 **Грамматика**:\n"
            f"   [Понятный разбор правил, падежей или грамматических конструкций на {native_name} языке]\n\n"
            f"{level_rule}"
            f"Return ONLY a JSON object in this format:\n{{\n"
            f'  "front": "{clean_phrase}",\n'
            f'  "back": "[Перевод вопроса]\\n\\n1. [Перевод первого варианта]\\n2. ✅ [Перевод правильного варианта]\\n... [перевод остальных вариантов]",\n'
            f'  "context": "🎯 **Объяснение**:\\n...\\n\\n📖 **Словарный запас**:\\n- слово1 — перевод1\\n- die слово2 — перевод2\\n\\n💡 **Грамматика**:\\n[разбор правил]"{json_level}\n'
            f"}}\nEND_JSON"
        )

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
            f"   Оборачивай каждый пропуск в фигурные скобки с вариантами через вертикальную черту {{вариант1|вариант2|вариант3}}.\n"
            f"   Правильный ответ отметь звёздочкой {{*правильный|неверный1|неверный2}} или поставь первым.\n"
            f"   Пример: Sehr geehrter {{Herr Bauer|Frau Bauer|Firma Mustermann}},\n   wir möchten Sie daran erinnern, dass Ihre Bestellung noch zur Abholung bereitliegt. Leider konnten wir bisher keinen Kontakt mit {{*Ihnen|Sie|Ihr}} наnehmen.\n\n"
            f"2. На ОБРАТНОЙ стороне (back) ОБЯЗАТЕЛЬНО пиши:\n"
            f"   🎯 **Полный текст с построчным переводом**: весь текст на {lang_name} с подставленными правильными ответами, сопровождаемый точным параллельным переводом каждого предложения на русский язык.\n\n"
            f"   💡 **Разбор ответов и словарный запас**: краткие пояснения правильных ответов и перевод ключевых сложных слов."
        ),
        "prompt_type": "trainer"
    })

    presets.append({
        "id": "preset_exam",
        "name": f"📝 Экзаменационный тест ({lang_name})",
        "level": "Exam",
        "badge": "Тест",
        "description": f"Генерирует вопросы с выбором ответа (со звёздочкой * у верного), переводом с галочкой ✅ на обороте, объяснением, словарным запасом и грамматикой.",
        "instruction": (
            f"Ты — профессиональный преподаватель языка {lang_name}.\n"
            f"Создавай экзаменационные карточки с выбором вариантов ответа (Multiple Choice).\n\n"
            f"ПРАВИЛА ОФОРМЛЕНИЯ:\n"
            f"1. На ЛИЦЕВОЙ стороне (front):\n"
            f"   Напиши четкий вопрос или задание на языке {lang_name}.\n"
            f"   Ниже напиши варианты ответа (2, 3, 4 или более вариантов), ставя звёздочку * в начале строки ТОЛЬКО для ПРАВИЛЬНОГО ответа:\n"
            f"   *Правильный вариант ответа\n"
            f"   Неправильный вариант 1\n"
            f"   Неправильный вариант 2\n\n"
            f"2. На ОБРАТНОЙ стороне (back):\n"
            f"   Напиши ПОЛНЫЙ перевод вопроса и ВСЕХ вариантов ответа на русский язык (без префиксов вроде 'Вопрос:').\n"
            f"   Сохрани исходное количество и порядок вариантов, поставь зеленую галочку ✅ перед правильным ответом!\n\n"
            f"3. В поле 'context' пиши:\n"
            f"   🎯 **Объяснение**:\n"
            f"   [подробно: почему правилен именно этот ответ]\n\n"
            f"   📖 **Словарный запас**:\n"
            f"   - [слово / глагол / существительное с артиклем на {lang_name}] — [перевод на русский]\n"
            f"   (подробный разбор всех ключевых слов и глаголов из вопроса и вариантов)\n\n"
            f"   💡 **Грамматика**:\n"
            f"   [Понятный разбор правил, падежей или грамматических конструкций]\n"
        ),
        "prompt_type": "exam"
    })

    return presets

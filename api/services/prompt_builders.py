"""
LLM Prompt Builders and System Presets for Lerne AI services.
Generates structured JSON prompts for card creation, trainers, quizzes, and grammar explanations.
"""

from api.services.language_config import get_language_config, get_native_config

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
        f"Изучаемый язык: {lang_name}. Родной язык: {native_name}.\n"
        f"Предложение с пропуском: \"{phrase}\"\n\n"
        f"Кратко, понятно и ёмко объясни грамматическое правило для слова/конструкции в скобках {{...}} (почему именно эта форма, падеж или предлог).\n"
        f"Ответ дай СТРОГО на языке: {native_name}.\n\n"
        f"Формат вывода (строго Markdown):\n"
        f"📖 **Правило:** [понятное объяснение правила на {native_name} языке]"
    )
    return prompt

def build_trainer_prompt(phrase: str, target_lang: str = "de", native_lang: str = "uk", detect_level: bool = True) -> str:
    lang_config = get_language_config(target_lang, native_lang)
    native_config = get_native_config(native_lang)
    lang_name = lang_config["name"]
    native_name = native_config["name"]

    level_rule = '4. "level": определи CEFR уровень сложности выражения ("A1", "A2", "B1", "B2", "C1", "C2").\n\n' if detect_level else '\n'
    json_level = ',\n  "level": "B1"' if detect_level else ''

    prompt = (
        f"Ты — профессиональный преподаватель языка {lang_name}. Родной язык пользователя: {native_name}.\n"
        f"Создай полноценную карточку-тренажёр на основе фразы:\n'{phrase}'\n\n"
        f"Инструкции:\n"
        f"Язык всех пояснений, грамматики, словаря и перевода: СТРОГО {native_name}.\n\n"
        f"1. \"front\": предложение на {lang_name} языке с сохранением проверяемой формы в фигурных скобках {{...}} (например: 'Ich fahre {{mit dem}} Bus' или 'Direkt gegenüber {{von}} meinem Haus ist eine Bäckerei').\n"
        f"2. \"back\": ПОЛНЫЙ и точный перевод всего предложения на {native_name} язык.\n"
        f"3. \"context\": оформи 4 чётких блока:\n"
        f"   🎯 **Ответ и суть**:\n"
        f"   [понятно: почему в пропуск {{...}} ставится именно эта форма, падеж или предлог]\n\n"
        f"   📖 **Словарь**:\n"
        f"   - [слово / глагол с артиклем на {lang_name}] — [перевод на {native_name}]\n\n"
        f"   💡 **Грамматика**:\n"
        f"   [Понятное грамматическое правило на {native_name} языке простыми словами]\n\n"
        f"   ✨ **Примеры**:\n"
        f"   (Обязательно 3 примера предложений с использованием этой конструкции/предлога и их перевод):\n"
        f"   1. [предложение на {lang_name}] — [перевод]\n"
        f"   2. [предложение на {lang_name}] — [перевод]\n"
        f"   3. [предложение на {lang_name}] — [перевод]\n\n"
        f"{level_rule}"
        f"Return ONLY a JSON object in this format:\n{{\n"
        f'  "front": "{phrase}",\n'
        f'  "back": "полный перевод предложения на {native_name}",\n'
        f'  "context": "🎯 **Ответ и суть**:\\n...\\n\\n📖 **Словарь**:\\n- слово — перевод\\n\\n💡 **Грамматика**:\\n...\\n\\n✨ **Примеры**:\\n1. ...\\n2. ...\\n3. ..."{json_level}\n'
        f"}}\nEND_JSON"
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

    native_code = (native_lang or "ru").lower().strip()

    if native_code == "uk":
        presets = [
            {
                "id": "preset_a2",
                "name": f"🎯 Рівень A2 — Базовий ({lang_name})",
                "level": "A2",
                "badge": "Базовий",
                "description": f"Пояснення слів з перекладом на українську, детальна граматика та 3 приклади з іншими варіантами того ж змісту. Складність тексту не вище рівня A2.",
                "instruction": f"поясни слова з перекладом на українську та детально граматику, потім 3 приклади з іншими варіантами того ж змісту. Вивчаєма мова {lang_name} рівня А2, рідна мова українська. Пиши {lang_name} текст складністю не вище рівня А2",
                "prompt_type": "standard"
            },
            {
                "id": "preset_b1",
                "name": f"⚡ Рівень B1 — Впевнений ({lang_name}) (За замовчуванням)",
                "level": "B1",
                "badge": "Рекомендований",
                "description": f"Пояснення слів з перекладом на українську, детальна граматика та 3 приклади з іншими варіантами того ж змісту. Складність тексту не вище рівня B1.",
                "instruction": f"поясни слова з перекладом на українську та детально граматику, потім 3 приклади з іншими варіантами того ж змісту. Вивчаєма мова {lang_name}, рідна мова українська. Пиши {lang_name} текст складністю не вище рівня Б1",
                "prompt_type": "standard"
            },
            {
                "id": "preset_b2",
                "name": f"🚀 Рівень B2 — Просунутий ({lang_name})",
                "level": "B2",
                "badge": "Просунутий",
                "description": f"Пояснення слів з перекладом на українську, синоніми та детальна граматика, потім 3 приклади з іншими варіантами того ж змісту. Складність тексту рівня B2.",
                "instruction": f"поясни слова з перекладом на українську, синоніми та детально граматику, потім 3 приклади з іншими варіантами того ж змісту. Вивчаєма мова {lang_name}, рідна мова українська. Пиши {lang_name} текст складністю рівня Б2",
                "prompt_type": "standard"
            }
        ]
    elif native_code == "en":
        presets = [
            {
                "id": "preset_a2",
                "name": f"🎯 Level A2 — Basic ({lang_name})",
                "level": "A2",
                "badge": "Basic",
                "description": f"Word breakdown with translation to English, detailed grammar, and 3 examples with other options of the same meaning. Text complexity no higher than A2 level.",
                "instruction": f"explain words with translation to English and detailed grammar, then 3 examples with other options of the same meaning. Target language is {lang_name} at A2 level, native language is English. Write {lang_name} text with complexity no higher than A2 level",
                "prompt_type": "standard"
            },
            {
                "id": "preset_b1",
                "name": f"⚡ Level B1 — Confident ({lang_name}) (Default)",
                "level": "B1",
                "badge": "Recommended",
                "description": f"Word breakdown with translation to English, detailed grammar, and 3 examples with other options of the same meaning. Text complexity no higher than B1 level.",
                "instruction": f"explain words with translation to English and detailed grammar, then 3 examples with other options of the same meaning. Target language is {lang_name}, native language is English. Write {lang_name} text with complexity no higher than B1 level",
                "prompt_type": "standard"
            },
            {
                "id": "preset_b2",
                "name": f"🚀 Level B2 — Advanced ({lang_name})",
                "level": "B2",
                "badge": "Advanced",
                "description": f"Word breakdown with translation to English, synonyms and detailed grammar, then 3 examples with other options of the same meaning. Text complexity at B2 level.",
                "instruction": f"explain words with translation to English, synonyms and detailed grammar, then 3 examples with other options of the same meaning. Target language is {lang_name}, native language is English. Write {lang_name} text with complexity at B2 level",
                "prompt_type": "standard"
            }
        ]
    else:
        presets = [
            {
                "id": "preset_a2",
                "name": f"🎯 Уровень A2 — Базовый {lang_name}",
                "level": "A2",
                "badge": "Базовый",
                "description": f"Объяснение слов с переводом, подробная грамматика и 3 примера с другими вариантами того же смысла. Сложность текста не выше уровня A2.",
                "instruction": f"объясни слова с переводом на русский и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык {lang_name} уровня А2, родной русский. пиши {lang_name} текст сложностью не выше уровня А2",
                "prompt_type": "standard"
            },
            {
                "id": "preset_b1",
                "name": f"⚡ Уровень B1 — Уверенный {lang_name} (По умолчанию)",
                "level": "B1",
                "badge": "Рекомендуемый",
                "description": f"Объяснение слов с переводом на русский, подробная грамматика и 3 примера с другими вариантами того же смысла. Сложность текста не выше уровня B1.",
                "instruction": f"объясни слова с переводом на русский и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык {lang_name}, родной русский. пиши {lang_name} текст сложностью не выше уровня Б1",
                "prompt_type": "standard"
            },
            {
                "id": "preset_b2",
                "name": f"🚀 Уровень B2 — Продвинутый {lang_name}",
                "level": "B2",
                "badge": "Продвинутый",
                "description": f"Объяснение слов с переводом на русский, синонимы и подробно грамматика, затем 3 примера с другими вариантами того же смысла. Сложность текста уровня B2.",
                "instruction": f"объясни слова с переводом на русский, синонимы и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык {lang_name}, родной русский. пиши {lang_name} текст сложностью уровня Б2",
                "prompt_type": "standard"
            }
        ]

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
            f"   [Понятный разбор правил, падежей или грамматических конструкций]\n\n"
        ),
        "prompt_type": "exam"
    })

    return presets

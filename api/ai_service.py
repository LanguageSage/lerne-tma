import re
import json
import logging
import time
import asyncio

logger = logging.getLogger(__name__)

from api.models import TMASetting
from api.ai_clients import AIService

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

async def generate_card_fields(user_id: int, phrase: str, target_language: str = "de", native_language: str = None, action_type: str = "full_card"):
    """Generates Front, Back, and Context for a card using AI."""
    start_time = time.time()
    try:
        from api.services.language_service import (
            get_prompt_for_phrase, get_language_config, get_native_config,
            build_card_prompt, build_custom_directive_prompt, build_rule_explanation_prompt
        )
        from api.services.input_parser import parse_user_input, parse_ai_json_response
        from api.models import TMACustomPrompt, TMASetting

        parsed = parse_user_input(phrase)
        clean_phrase = parsed.clean_phrase or phrase

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

        # Handle explain_rule mode (grammar explanation for cloze gap)
        if action_type == "explain_rule":
            system_prompt = build_rule_explanation_prompt(
                phrase=clean_phrase,
                target_lang=target_lang,
                native_lang=native_lang
            )
            logger.info(f"AI: Processing explain_rule for '{clean_phrase}' using {provider}/{model_name}...")
            response, success = await client.chat_completion(
                system_prompt=system_prompt,
                user_message=clean_phrase,
                model=model_name
            )
            duration = time.time() - start_time
            if not success:
                logger.error(f"AI: Explain rule failed after {duration:.2f}s: {response}")
                return {"error": response}
            logger.info(f"AI: Explain rule successful in {duration:.2f}s")
            parsed_json = parse_ai_json_response(response)
            if parsed_json:
                return parsed_json
            return {"front": clean_phrase, "back": "", "context": response.strip()}

        # Handle custom_directive mode (Answer/directive only)
        if action_type == "custom_directive":
            system_prompt = build_custom_directive_prompt(
                phrase=clean_phrase,
                directive=parsed.directive,
                target_lang=target_lang,
                native_lang=native_lang
            )
            logger.info(f"AI: Processing custom_directive for '{clean_phrase}' using {provider}/{model_name}...")
            response, success = await client.chat_completion(
                system_prompt=system_prompt,
                user_message=clean_phrase,
                model=model_name
            )
            duration = time.time() - start_time
            if not success:
                logger.error(f"AI: Custom directive failed after {duration:.2f}s: {response}")
                return {"error": response}
            logger.info(f"AI: Custom directive successful in {duration:.2f}s")
            return {"front": "", "back": "", "context": response.strip()}

        # Standard full_card mode
        is_quiz_request = any(marker in phrase for marker in ['[*]', '[ ]', '[x]', '[X]'])
        is_trainer_request = '{' in phrase or any(w in phrase.lower() for w in ['тренажер', 'тренажёр', 'пропуск', 'cloze', 'грамматика', 'грамматик'])
        target_ptype = 'exam' if is_quiz_request else ('trainer' if is_trainer_request else 'standard')

        custom_prompt = TMACustomPrompt.get_or_none(
            (TMACustomPrompt.user_id == user_id) & 
            (TMACustomPrompt.is_active == True) &
            (TMACustomPrompt.prompt_type == target_ptype) &
            ((TMACustomPrompt.target_language == target_lang) | (TMACustomPrompt.target_language.is_null()))
        )
        
        if not custom_prompt:
            custom_prompt = TMACustomPrompt.get_or_none(
                (TMACustomPrompt.user_id == user_id) & 
                (TMACustomPrompt.is_active == True) &
                ((TMACustomPrompt.target_language == target_lang) | (TMACustomPrompt.target_language.is_null()))
            )
        
        is_cyrillic = any('\u0400' <= char <= '\u04FF' for char in clean_phrase)
        is_system_preset = custom_prompt and any(icon in (custom_prompt.name or "") for icon in ["🎯", "⚡", "🔥", "📝", "Уровень", "Рівень", "Level", "preset"])
        
        if custom_prompt and not is_system_preset:
            raw_prompt = custom_prompt.translation_prompt if is_cyrillic else custom_prompt.context_prompt
            system_prompt = (raw_prompt or get_prompt_for_phrase(clean_phrase, target_lang, native_lang)).replace("{phrase}", clean_phrase)
            if parsed.has_directive:
                system_prompt += f"\n\nДополнительное указание пользователя: \"{parsed.directive}\". Выполни просьбу пользователя."
        elif is_quiz_request:
            native_name = native_config["name"].lower()
            system_prompt = (
                f"Ты — профессиональный преподаватель и экзаменатор языка {lang_name}.\n"
                f"Для экзаменационного вопроса с выбором вариантов ответа:\n'{clean_phrase}'\n\n"
                f"Проанализируй вопрос и варианты ответов.\n"
                f"1. Сделай точный перевод вопроса и всех вариантов ответов на {native_name} язык.\n"
                f"2. Подробно объясни грамматику и логику, почему именно отмеченный [*] или [x] вариант ответа является правильным, и в чём заключается ошибка остальных вариантов.\n"
                f"3. Переведи ключевые сложные слова из вопроса.\n"
                f"НЕ пиши дополнительные 3 примера предложений!\n\n"
                f"Return ONLY a JSON object in this format:\n{{\n"
                f'  "front": "{clean_phrase}",\n'
                f'  "back": "Перевод вопроса и правильного ответа",\n'
                f'  "context": "🎯 **Перевод**:\\n[перевод вопроса и всех вариантов]\\n\\n💡 **Грамматический разбор и объяснение ответа**:\\n[подробное объяснение почему правильный ответ именно этот]\\n\\n📖 **Словарный запас**:\\n[слово — перевод]"\n'
                f"}}\nEND_JSON"
            )
        elif is_trainer_request:
            native_name = native_config["name"].lower()
            system_prompt = (
                f"Ты — преподаватель языка {lang_name}. Создай грамматическую карточку-тренажёр на основе фразы:\n'{clean_phrase}'\n\n"
                f"Инструкции:\n"
                f"1. На лицевой стороне ('front') сформируй предложение на {lang_name} языке и обязательно оберни проверяемую грамматическую форму, предлог или артикль в фигурные скобки, например: 'Ich fahre {{mit dem}} Bus' или 'der Weg {{zum}} Gipfel' (можно указать варианты через черту: '{{zum|zur|ins}}').\n"
                f"2. На обратной стороне ('back') ОБЯЗАТЕЛЬНО укажи ПОЛНЫЙ И ТОЧНЫЙ перевод всего предложения на {native_name} язык.\n"
                f"3. В поле 'context' дай структурированное и понятное объяснение:\n"
                f"   - 🎯 **Перевод**: [перевод фразы]\n"
                f"   - 💡 **Грамматический разбор**: [почему выбран именно этот вариант/падеж/род/управление/окончание, подробное правило простыми словами]\n"
                f"   - 📖 **Словарик**: [разбор ключевых слов фразы]\n\n"
                f"Return ONLY a JSON object in this format:\n{{\n"
                f'  "front": "предложение с {{пропуском}} на {lang_name.lower()}",\n'
                f'  "back": "полный перевод предложения на {native_name}",\n'
                f'  "context": "🎯 **Перевод**:\\n[перевод]\\n\\n💡 **Грамматический разбор**:\\n[объяснение правила и почему именно такой ответ]\\n\\n📖 **Словарик**:\\n[слово - перевод]"\n'
                f"}}\nEND_JSON"
            )
        else:
            system_prompt = build_card_prompt(
                phrase=clean_phrase,
                target_lang=target_lang,
                native_lang=native_lang,
                directive=parsed.directive
            )

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


async def generate_batch_card_fields(user_id: int, text: str, target_language: str = "de", native_language: str = None) -> dict:
    """
    Parses multi-line text input (each line = 1 card) and generates cards in AI batches.
    Dynamic batching:
    - Short phrases (< 30 chars): 15 items per prompt batch.
    - Long sentences (>= 30 chars): 5 items per prompt batch.
    Rate-limit safe: Delays 3.5s between consecutive batch prompt calls to comply with Gemini 15 RPM.
    """
    start_time = time.time()
    try:
        from api.services.language_service import get_language_config, get_native_config
        from api.models import TMACustomPrompt, TMASetting

        raw_lines = [line.strip() for line in text.splitlines() if line and line.strip()]
        if not raw_lines:
            return {"error": "Введите хотя бы одну непустую строку для генерации."}
        
        # Max limit safeguard (30 lines per call)
        if len(raw_lines) > 30:
            raw_lines = raw_lines[:30]

        if not native_language:
            native_rec = TMASetting.get_or_none(TMASetting.key == "NATIVE_LANGUAGE")
            native_language = native_rec.value if native_rec else "uk"
            
        target_lang = (target_language or "de").lower()
        native_lang = (native_language or "uk").lower()
        
        lang_config = get_language_config(target_lang, native_lang)
        native_config = get_native_config(native_lang)
        lang_name = lang_config["name"]
        native_name = native_config["name"]

        provider, ai_key, ai_model = get_ai_config()
        if not ai_key and provider != "ollama":
            return {"error": f"API ключ для {provider} не настроен."}

        client = AIService(provider=provider, api_key=ai_key)

        # Determine batch size dynamically based on average line length
        avg_len = sum(len(line) for line in raw_lines) / len(raw_lines)
        batch_size = 5 if avg_len >= 30 else 15

        chunks = [raw_lines[i:i + batch_size] for i in range(0, len(raw_lines), batch_size)]
        all_results = []

        # Check for active custom prompt
        custom_prompt = TMACustomPrompt.get_or_none(
            (TMACustomPrompt.user_id == user_id) & 
            (TMACustomPrompt.is_active == True) &
            ((TMACustomPrompt.target_language == target_lang) | (TMACustomPrompt.target_language.is_null()))
        )

        for index, chunk in enumerate(chunks):
            if index > 0:
                # Rate-limit safe delay (3.5 seconds) for consecutive API calls
                await asyncio.sleep(3.5)

            chunk_text = "\n".join(f"{idx+1}. {phrase}" for idx, phrase in enumerate(chunk))

            if custom_prompt and custom_prompt.translation_prompt:
                custom_instructions = custom_prompt.translation_prompt
                batch_prompt = (
                    f"Ты — профессиональный преподаватель языка {lang_name}.\n"
                    f"Инструкции по стилю:\n{custom_instructions}\n\n"
                    f"Сгенерируй карточки для {len(chunk)} элементов:\n{chunk_text}\n\n"
                    f"Верни СТРОГО JSON-массив из объектов формата:\n"
                    f"[{{\"front\": \"...\", \"back\": \"...\", \"context\": \"...\"}}]"
                )
            else:
                batch_prompt = (
                    f"Ты — профессиональный преподаватель языка {lang_name}.\n"
                    f"Сгенерируй учебные флеш-карточки для следующего списка из {len(chunk)} элементов:\n"
                    f"{chunk_text}\n\n"
                    f"ТРЕБОВАНИЯ:\n"
                    f"1. Верни СТРОГО JSON-массив из {len(chunk)} объектов без текста вокруг.\n"
                    f"2. Формат каждого объекта в массиве:\n"
                    f"   {{\n"
                    f"     \"front\": \"исходная фраза на немецком/родном языке\",\n"
                    f"     \"back\": \"точный перевод на {native_name} язык + грамматический комментарий\",\n"
                    f"     \"context\": \"2-3 контекстных примера на {lang_name} с переводом\"\n"
                    f"   }}\n"
                    f"3. Если фраза на русском, переведи её на {lang_name} для 'front'.\n"
                )

            success, response = await client.chat_completion(
                system_prompt=batch_prompt,
                user_message="Сгенерируй JSON массив для указанного списка.",
                model=ai_model
            )

            if success and response:
                try:
                    clean_resp = response.replace("```json", "").replace("```", "").strip()
                    first_bracket = clean_resp.find('[')
                    last_bracket = clean_resp.rfind(']')
                    if first_bracket != -1 and last_bracket != -1:
                        clean_resp = clean_resp[first_bracket:last_bracket+1]
                    items = json.loads(clean_resp)
                    if isinstance(items, list):
                        all_results.extend(items)
                except Exception as parse_err:
                    logger.warning(f"Batch parse warning on chunk {index}: {parse_err}")

        duration = time.time() - start_time
        logger.info(f"Batch AI Generation complete for {len(raw_lines)} lines in {duration:.2f}s")
        return {
            "status": "success",
            "total_requested": len(raw_lines),
            "generated_count": len(all_results),
            "cards": all_results
        }
    except Exception as e:
        logger.error(f"Batch AI Generation Error: {e}", exc_info=True)
        return {"error": f"Ошибка пакетной генерации: {str(e)}"}


import re
import json
import logging
import time
import asyncio

logger = logging.getLogger(__name__)

from api.models import TMASetting, TMACustomPrompt
from api.ai_clients import AIService
# Service imports — no circular dependency since none of these import ai_service
from api.services.language_service import (
    get_prompt_for_phrase, get_language_config, get_native_config,
    build_card_prompt, build_custom_directive_prompt, build_rule_explanation_prompt,
    build_trainer_prompt, build_quiz_prompt, get_cefr_rubric
)
from api.services.input_parser import (
    detect_ai_input_type,
    parse_exercise_content,
    parse_ai_json_response,
    parse_ai_batch_json_response,
    preserve_exercise_marker,
    restore_exercise_content,
)
from api.services.cefr_metadata import build_ai_cefr_payload, build_local_cefr_payload

_AI_CONFIG_CACHE = {"data": None, "ts": 0}
_AI_CONFIG_CACHE_TTL = 60  # 60 seconds cache

def invalidate_ai_config_cache():
    """Invalidates the in-memory AI configuration cache."""
    _AI_CONFIG_CACHE["data"] = None
    _AI_CONFIG_CACHE["ts"] = 0

def get_ai_config(force_refresh: bool = False):
    import os
    now = time.time()
    if not force_refresh and _AI_CONFIG_CACHE["data"] is not None and (now - _AI_CONFIG_CACHE["ts"] < _AI_CONFIG_CACHE_TTL):
        return _AI_CONFIG_CACHE["data"]

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
    
    config = (provider, ai_key, model)
    _AI_CONFIG_CACHE["data"] = config
    _AI_CONFIG_CACHE["ts"] = now
    return config

def extract_json_from_text(text: str, default_front: str) -> dict:
    """Decode complete JSON, never salvage fields from a broken response."""
    if not isinstance(text, str):
        raise ValueError('ИИ вернул пустой ответ вместо JSON')
    clean_text = re.sub(r'\s*END_JSON\s*$', '', text).strip()
    match = re.fullmatch(r'```(?:json)?\s*(.*?)\s*```', clean_text, re.DOTALL | re.IGNORECASE)
    if match:
        clean_text = match.group(1)
    data = json.loads(clean_text)
    if not isinstance(data, dict):
        raise ValueError('ИИ должен вернуть JSON объект')
    valid_levels = {"A1", "A2", "B1", "B2", "C1", "C2"}
    level_str = str(data.get('level') or '').upper().strip()
    return {
        'front': data.get('front', default_front),
        'back': data.get('back', ''),
        'context': data.get('context', ''),
        'level': level_str if level_str in valid_levels else None,
    }


def _quiz_analysis_fields(response: str, options: list) -> dict:
    """Check the existing Quiz prompt's text fields; keep its output unchanged."""
    data = extract_json_from_text(response, '')
    back, context = data['back'], data['context']
    if any(not isinstance(value, str) or not value.strip() or re.search(r'\\[nr]', value)
           for value in (back, context)):
        raise ValueError('Нужны непустые back/context без буквальных \\n')
    sections = re.fullmatch(
        r'\s*🎯\s*\*\*Объяснение\*\*:\s*(.*?)'
        r'\s*📖\s*\*\*Словарный запас\*\*:\s*(.*?)'
        r'\s*💡\s*\*\*Грамматика\*\*:\s*(.*?)\s*', context, re.DOTALL)
    if not sections or not all(part.strip() for part in sections.groups()):
        raise ValueError('Нужны объяснение, словарь и грамматика')
    translated_options = list(re.finditer(r'(?m)^[ \t]*(?:✅[ \t]*)?(\d+|[A-Za-z])[.)][ \t]+\S[^\n]*', back))
    labels = [match[1] for match in translated_options]
    positions = [int(label) if label.isdigit() else ord(label.upper()) - ord('A') + 1 for label in labels]
    if positions != list(range(1, len(options) + 1)):
        raise ValueError('Нужен перевод каждого варианта по порядку')
    if '✅' not in back:
        raise ValueError('Не отмечен правильный вариант')
    if not back[:translated_options[0].start()].strip():
        raise ValueError('Отсутствует перевод вопроса')
    if not re.search(r'(?m)^[ \t]*[-•][ \t]+\S.*[—–-][ \t]+\S', sections[2]):
        raise ValueError('Словарь пуст или не содержит переводов')
    return {'back': back, 'context': context}


async def generate_card_fields(
    user_id: int,
    phrase: str,
    target_language: str = "de",
    native_language: str = None,
    action_type: str = "full_card",
    user_request: str = None,
):
    """Generates Front, Back, and Context for a card using AI."""
    start_time = time.time()
    try:
        from api.services.language_service import (
            get_prompt_for_phrase, get_language_config, get_native_config,
            build_card_prompt, build_custom_directive_prompt, build_rule_explanation_prompt,
            build_trainer_prompt, build_quiz_prompt, build_match_prompt, build_puzzle_prompt,
            build_word_bank_prompt, build_free_text_prompt
        )
        from api.services.prompt_builders import is_system_preset_name, with_user_request
        from api.services.input_parser import (
            detect_ai_input_type,
            parse_exercise_content,
            parse_ai_json_response,
            preserve_exercise_marker,
            restore_exercise_content,
        )
        from api.models import TMACustomPrompt, TMASetting

        clean_phrase = str(phrase or "").strip()
        clean_user_request = str(user_request or "").strip()
        parsed_content = parse_exercise_content(clean_phrase)
        exercise_phrase = parsed_content["exercise"] if parsed_content["has_blocks"] else clean_phrase
        input_type = detect_ai_input_type(clean_phrase)

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

        if not ai_model or not ai_model.strip():
            return {"error": "В настройках не выбрана модель ИИ. Пожалуйста, выберите модель в Настройках."}

        client = AIService(provider=provider, api_key=ai_key)
        model_name = ai_model.strip()
        if provider == 'openrouter' and '/' not in model_name:
            model_name = f'google/{model_name}'

        # Existing authored quizzes have a separate contract, including legacy
        # full_card callers. Creation from a topic and other types keep their flow.
        from api.services.input_parser import detect_card_type, parse_quiz_options
        if action_type == 'quiz_analysis' or (action_type == 'full_card' and detect_card_type(phrase) == 'quiz'):
            if detect_card_type(phrase) != 'quiz':
                return {'error': 'Для разбора нужен Quiz с вариантами и отмеченным ответом.'}
            options = parse_quiz_options(parsed_content['exercise'], allow_empty_question=True)
            system_prompt = build_quiz_prompt(phrase, target_lang, native_lang, detect_level=False)
            # Bound the entire analysis to two provider calls; do not multiply
            # transport retries or key rotation with the content retry.
            client.request_attempts = 1
            client.key_attempts = 1
            error = ''
            for attempt in range(2):
                response, success = await client.chat_completion(
                    system_prompt=system_prompt,
                    user_message=phrase,
                    model=model_name,
                    temperature=0.1,
                    max_output_tokens=8192,
                )
                if success:
                    try:
                        return _quiz_analysis_fields(response, options)
                    except ValueError as exc:
                        error = str(exc)
                else:
                    error = str(response)
                logger.warning('Quiz analysis attempt %s failed: %s', attempt + 1, error)
            return {'error': 'Не удалось получить полный разбор теста после двух попыток. Карточка не изменена.'}

        # Handle explain_rule mode (grammar explanation for cloze gap)
        if action_type == "explain_rule":
            system_prompt = build_rule_explanation_prompt(
                phrase=exercise_phrase,
                target_lang=target_lang,
                native_lang=native_lang
            )
            logger.info(f"AI: Processing explain_rule for '{exercise_phrase}' using {provider}/{model_name}...")
            response, success = await client.chat_completion(
                system_prompt=system_prompt,
                user_message=exercise_phrase,
                model=model_name
            )
            duration = time.time() - start_time
            if not success:
                logger.error(f"AI: Explain rule failed after {duration:.2f}s: {response}")
                return {"error": response}
            logger.info(f"AI: Explain rule successful in {duration:.2f}s")
            parsed_rule = parse_ai_json_response(response)
            if parsed_rule:
                return {
                    "front": "",
                    "back": parsed_rule.get("back", ""),
                    "context": parsed_rule.get("context", "") or response.strip(),
                }
            # Backward-compatible fallback for providers that return the old
            # Markdown-only response instead of the requested JSON object.
            return {"front": "", "back": "", "context": response.strip()}

        # Handle custom_directive mode (Answer/directive only)
        if action_type == "custom_directive":
            system_prompt = build_custom_directive_prompt(
                phrase=exercise_phrase,
                directive=clean_user_request,
                target_lang=target_lang,
                native_lang=native_lang
            )
            logger.info(f"AI: Processing custom_directive for '{exercise_phrase}' using {provider}/{model_name}...")
            response, success = await client.chat_completion(
                system_prompt=system_prompt,
                user_message=exercise_phrase,
                model=model_name
            )
            duration = time.time() - start_time
            if not success:
                logger.error(f"AI: Custom directive failed after {duration:.2f}s: {response}")
                return {"error": response}
            logger.info(f"AI: Custom directive successful in {duration:.2f}s")
            return {"front": "", "back": "", "context": response.strip()}

        # Standard full_card mode
        is_quiz_request = input_type == 'quiz'
        is_trainer_request = input_type == 'trainer'
        target_ptype = 'exam' if is_quiz_request else ('trainer' if is_trainer_request else 'standard')

        custom_prompt = TMACustomPrompt.get_or_none(
            (TMACustomPrompt.user_id == user_id) & 
            (TMACustomPrompt.is_active == True) &
            (TMACustomPrompt.prompt_type == target_ptype) &
            ((TMACustomPrompt.target_language == target_lang) | (TMACustomPrompt.target_language.is_null() if target_lang == 'de' else False))
        )
        
        if not custom_prompt:
            custom_prompt = TMACustomPrompt.get_or_none(
                (TMACustomPrompt.user_id == user_id) & 
                (TMACustomPrompt.is_active == True) &
                ((TMACustomPrompt.target_language == target_lang) | (TMACustomPrompt.target_language.is_null() if target_lang == 'de' else False))
            )
        
        is_cyrillic = any('\u0400' <= char <= '\u04FF' for char in exercise_phrase)
        is_system_preset = custom_prompt and is_system_preset_name(custom_prompt.name)

        detect_level_setting = TMASetting.get_or_none(TMASetting.key == "AI_DETECT_LEVEL")
        detect_level = (detect_level_setting.value.lower() != "false") if detect_level_setting else True

        common = dict(target_lang=target_lang, native_lang=native_lang)
        typed_builders = {'trainer': build_trainer_prompt, 'match': build_match_prompt, 'puzzle': build_puzzle_prompt,
                          'word_bank': build_word_bank_prompt, 'free_text': build_free_text_prompt}
        if custom_prompt and not is_system_preset:
            raw_prompt = custom_prompt.translation_prompt if is_cyrillic else custom_prompt.context_prompt
            system_prompt = (raw_prompt or get_prompt_for_phrase(exercise_phrase, target_lang, native_lang)).replace("{phrase}", exercise_phrase)
            if detect_level and "level" not in system_prompt.lower():
                system_prompt += f"\n\nОбязательно добавь в выводимый JSON объект поле уровня:\n\"level\": \"один из уровня CEFR (A1, A2, B1, B2, C1, C2)\""
            system_prompt = with_user_request(system_prompt, clean_user_request)
        elif is_quiz_request:
            system_prompt = with_user_request(build_quiz_prompt(
                phrase_or_items=exercise_phrase, is_batch=False, detect_level=detect_level, **common), clean_user_request)
        elif input_type in typed_builders:
            system_prompt = with_user_request(typed_builders[input_type](
                phrase=exercise_phrase, detect_level=detect_level, **common), clean_user_request)
        elif input_type == 'editable_text':
            system_prompt = with_user_request(
                build_card_prompt(phrase=exercise_phrase, directive=clean_user_request, **common),
                'Это @edit: FRONT сохрани без изменений. BACK должен содержать полный исправленный текст, '
                'CONTEXT — краткое объяснение правки.')
        else:
            system_prompt = build_card_prompt(phrase=exercise_phrase, directive=clean_user_request, **common)

        if input_type == 'theory':
            system_prompt += ('\nЭто карточка Theory (@theory). Сохраняй её смысл и педагогическое назначение. '
                              'Не превращай теорию в упражнение или Quiz, даже если в ней есть вопрос. '
                              'Сохраняй front и маркер @theory; дополняй только back/context по запросу.')

        if "JSON" not in system_prompt.upper():
            native_name = native_config["name"].lower()
            front_hint = f"перевод на {lang_name.lower()}" if is_cyrillic else exercise_phrase
            system_prompt += (f"\nReturn ONLY a JSON object in this format:\n{{\n  \"front\": \"{front_hint}\",\n"
                              f"  \"back\": \"перевод на {native_name}\",\n"
                              "  \"context\": \"слово 1 - перевод\\nслово 2 - перевод\\n\\nПримеры:\\n1. текст - перевод\\n2. текст - перевод\\n3. текст - перевод\"\n}\nEND_JSON")

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
            user_message=exercise_phrase,
            model=model_name
        )
        
        duration = time.time() - start_time
        if not success:
            logger.error(f"AI: Generation failed after {duration:.2f}s: {response}")
            return {"error": response}
        
        logger.info(f"AI: Generation successful in {duration:.2f}s")
        try:
            result = extract_json_from_text(response, exercise_phrase)
            if not all(isinstance(result[field], str) for field in ('front', 'back', 'context')):
                raise ValueError('Поля карточки должны быть текстом')
        except ValueError:
            return {'error': 'ИИ вернул повреждённый JSON. Карточка не изменена.'}
        if input_type in ("theory", "match", "puzzle", "word_bank", "free_text", "editable_text"):
            result["front"] = clean_phrase
        else:
            generated_front = preserve_exercise_marker(result.get("front", exercise_phrase), input_type)
            result["front"] = restore_exercise_content(parsed_content, generated_front)
        if input_type != "standard":
            result["card_type"] = input_type

        # Determine CEFR level using fast local classifier if not already set
        if detect_level and result and "front" in result and not result.get("level"):
            try:
                from api.services.classifier import classify_sentence_fast
                from api.services.cefr_metadata import build_ai_cefr_payload, build_local_cefr_payload
                from api.utils.audio import _prepare_tts_text
                # Strip trainer/quiz syntax before classification to avoid a 2nd AI call.
                classified_front = _prepare_tts_text(result["front"], max_chars=500) \
                    or parse_exercise_content(result["front"])["exercise"]
                local_res = classify_sentence_fast(classified_front, target_lang)
                if local_res.get("confidence", 0.0) >= 0.80:
                    result["level"] = local_res.get("level", "A1")
                    result["cefr"] = build_local_cefr_payload(local_res)
                else:
                    ai_levels = await classify_phrases_batch([classified_front], target_lang)
                    result["level"] = ai_levels[0] if ai_levels else local_res.get("level", "A1")
                    result["cefr"] = build_ai_cefr_payload(result["level"])
            except Exception as classify_err:
                logger.warning(f"Local classifier in generate_card_fields warning: {classify_err}")
                result["level"] = "A1"
                from api.services.cefr_metadata import build_ai_cefr_payload
                result["cefr"] = build_ai_cefr_payload("A1", source="fallback")
        elif result and result.get("level") and not result.get("cefr"):
            from api.services.cefr_metadata import build_ai_cefr_payload
            result["cefr"] = build_ai_cefr_payload(result.get("level"), reason=result.get("reason"))

        return result
        
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
        from api.services.prompt_builders import build_batch_cards_prompt, is_system_preset_name
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
            return {"error": f"API ключ для {provider} не настроен. Обратитесь к администратору или введите свой в Настройках."}

        if not ai_model or not ai_model.strip():
            return {"error": "В настройках не выбрана модель ИИ. Пожалуйста, выберите модель в Настройках."}

        client = AIService(provider=provider, api_key=ai_key)
        model_name = ai_model.strip()

        # Determine batch size dynamically based on average line length
        avg_len = sum(len(line) for line in raw_lines) / len(raw_lines)
        batch_size = 5 if avg_len >= 30 else 15

        chunks = [raw_lines[i:i + batch_size] for i in range(0, len(raw_lines), batch_size)]
        all_results = []

        # Check for active custom prompt
        custom_prompt = TMACustomPrompt.get_or_none(
            (TMACustomPrompt.user_id == user_id) & 
            (TMACustomPrompt.is_active == True) &
            ((TMACustomPrompt.target_language == target_lang) | (TMACustomPrompt.target_language.is_null() if target_lang == 'de' else False))
        )
        is_system_preset = custom_prompt and is_system_preset_name(custom_prompt.name)

        from api.services.input_parser import parse_ai_batch_json_response

        for index, chunk in enumerate(chunks):
            if index > 0:
                # Rate-limit safe delay (3.5 seconds) for consecutive API calls
                await asyncio.sleep(3.5)

            custom_instructions = (custom_prompt.translation_prompt if custom_prompt and not is_system_preset else None)
            batch_prompt = build_batch_cards_prompt(chunk, target_lang, native_lang, custom_instructions)

            logger.info(f"Batch AI: processing chunk {index+1}/{len(chunks)} ({len(chunk)} lines) with {provider}/{model_name}...")
            response, success = await client.chat_completion(
                system_prompt=batch_prompt,
                user_message="Сгенерируй JSON массив для указанного списка.",
                model=model_name
            )

            if not success:
                logger.error(f"Batch AI chunk {index+1} failed: {response}")
                return {"error": str(response), "status_code": 502}

            if response:
                try:
                    items = parse_ai_batch_json_response(response, expected_count=len(chunk))
                    if items:
                        all_results.extend(items)
                    else:
                        logger.warning(f"Batch parse empty items on chunk {index}: {str(response)[:200]}")
                except Exception as parse_err:
                    logger.warning(f"Batch parse warning on chunk {index}: {parse_err}")
                    return {"error": str(parse_err), "status_code": 502}
            else:
                return {"error": "ИИ вернул пустой ответ", "status_code": 502}

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


async def classify_phrases_batch(phrases: list[str], target_language: str = "de", *, strict: bool = False) -> list[str]:
    """Classifies a list of phrases into CEFR levels (A1 - C2).

    For German (de):
      1. Local rule-based classifier first (zero API cost, < 1 ms/phrase).
      2. Only phrases with confidence < 0.80 go to AI.
    For other languages: AI only (existing behaviour).
    """
    if not phrases:
        return []

    # Step 1: Local rule-based pre-filter (German only)
    final_results  = ["A1"] * len(phrases)
    local_fallback_results = ["A1"] * len(phrases)
    phrases_for_ai = []
    ai_indices     = []

    lang = (target_language or "de").lower()

    if lang == "de":
        try:
            from api.services.classifier import classify_sentence_fast
            from api.utils.audio import _prepare_tts_text
            local_hits = 0
            for i, phrase in enumerate(phrases):
                clean = _prepare_tts_text(phrase, max_chars=500) or phrase.strip()
                local = classify_sentence_fast(clean, "de")
                local_fallback_results[i] = local.get("level", "A1")
                if local.get("confidence", 0.0) >= 0.80:
                    final_results[i] = local["level"]
                    local_hits += 1
                else:
                    phrases_for_ai.append(clean)
                    ai_indices.append(i)
            if local_hits:
                logger.info(
                    f"classify_phrases_batch: {local_hits}/{len(phrases)} classified locally; "
                    f"{len(phrases_for_ai)} going to AI."
                )
        except Exception as local_err:
            logger.warning(f"classify_phrases_batch: local classifier failed ({local_err}), using full AI.")
            phrases_for_ai = list(phrases)
            ai_indices     = list(range(len(phrases)))
    else:
        phrases_for_ai = list(phrases)
        ai_indices     = list(range(len(phrases)))

    if not phrases_for_ai:
        return final_results

    # Step 2: AI for uncertain / unsupported-language phrases
    provider, ai_key, ai_model = get_ai_config()
    if not ai_model or not ai_model.strip():
        if strict:
            raise ValueError("CEFR AI model is not configured")
        for i in ai_indices:
            final_results[i] = local_fallback_results[i]
        logger.warning("classify_phrases_batch: No AI model configured, returning local low-confidence fallback for remaining.")
        return final_results

    client     = AIService(provider=provider, api_key=ai_key)
    model_name = ai_model.strip()
    if strict:
        client.request_attempts = 1
        client.key_attempts = 1
        client.request_timeout = 18

    numbered_phrases = "\n".join([f"{i+1}. {p.strip()}" for i, p in enumerate(phrases_for_ai)])

    from api.services.language_service import get_cefr_rubric
    rubric = get_cefr_rubric(target_language)

    prompt = (
        f"Определи точный уровень сложности CEFR (A1, A2, B1, B2, C1, C2) для каждого из следующих {len(phrases_for_ai)} элементов:\n\n"
        f"{numbered_phrases}\n\n"
        f"{rubric}\n\n"
        f"Верни СТРОГО JSON-массив строк ровно из {len(phrases_for_ai)} элементов:\n"
        '["A1", "A2", ...]'
    )

    try:
        response, success = await asyncio.wait_for(
            client.chat_completion(
                system_prompt="Ты сертифицированный экзаменатор CEFR. Возвращай только JSON массив уровней.",
                user_message=prompt,
                model=model_name
            ),
            timeout=35.0
        )
        if success and response:
            import json, re
            clean = response.strip()
            if strict:
                clean = re.sub(r'^```(?:json)?\s*|\s*```$', '', clean).strip()
                if not isinstance(json.loads(clean), list):
                    raise ValueError("Invalid CEFR AI result")
            match = re.search(r'\[\s*(.*?)\s*\]', clean, re.DOTALL)
            if match:
                raw_arr    = json.loads(f"[{match.group(1)}]")
                valid_lvls = {"A1", "A2", "B1", "B2", "C1", "C2"}
                if strict and (len(raw_arr) != len(ai_indices) or any(not isinstance(v, str) or v.upper().strip() not in valid_lvls for v in raw_arr)):
                    raise ValueError("Invalid CEFR AI result")
                ai_levels  = [
                    (str(item).upper().strip() if str(item).upper().strip() in valid_lvls else "A1")
                    for item in raw_arr
                ]
                for j, i in enumerate(ai_indices):
                    if j < len(ai_levels):
                        final_results[i] = ai_levels[j]
                return final_results
    except asyncio.TimeoutError:
        logger.warning(f"Timeout in classify_phrases_batch AI step after 35s for {len(phrases_for_ai)} items.")
    except Exception as e:
        logger.error(f"Error in classify_phrases_batch (AI step): {e}")

    if strict:
        raise ValueError("CEFR AI classification failed")
    return final_results


async def enrich_batch_quiz_fields(user_id: int, cards: list, target_language: str = "de", native_language: str = None) -> dict:
    """
    Массово обогащает список тестов и карточек с помощью ИИ:
    - Генерирует точный перевод вопроса и правильного ответа на родной язык (русский);
    - Генерирует понятное учебное объяснение (почему ответ правильный, законы ФРГ, грамматика);
    - Составляет структурированный контекстный словарь ключевых слов (context);
    - Определяет правильный ответ со звёздочкой '*', если он не был отмечен;
    - Рассчитывает уровень сложности CEFR.
    """
    start_time = time.time()
    try:
        from api.services.language_service import get_language_config, get_native_config
        from api.models import TMASetting
        from api.services.input_parser import parse_ai_batch_json_response

        if not cards:
            return {"error": "Список карточек для генерации пуст."}

        # Ограничение на количество за один запрос (до 30 карточек)
        if len(cards) > 30:
            cards = cards[:30]

        if not native_language:
            native_rec = TMASetting.get_or_none(TMASetting.key == "NATIVE_LANGUAGE")
            native_language = native_rec.value if native_rec else "ru"

        target_lang = (target_language or "de").lower()
        native_lang = (native_language or "ru").lower()
        
        lang_config = get_language_config(target_lang, native_lang)
        native_config = get_native_config(native_lang)
        lang_name = lang_config["name"]
        native_name = native_config["name"]

        provider, ai_key, ai_model = get_ai_config()
        if not ai_key and provider != "ollama":
            return {"error": f"API ключ для {provider} не настроен. Обратитесь к администратору или введите свой в Настройках."}

        if not ai_model or not ai_model.strip():
            return {"error": "В настройках не выбрана модель ИИ. Пожалуйста, выберите модель в Настройках."}

        client = AIService(provider=provider, api_key=ai_key)
        model_name = ai_model.strip()

        batch_size = 5
        chunks = [cards[i:i + batch_size] for i in range(0, len(cards), batch_size)]
        enriched_cards = []

        for index, chunk in enumerate(chunks):
            if index > 0:
                await asyncio.sleep(2.5)

            from api.services.prompt_builders import build_batch_enrichment_prompt
            chunk_for_prompt = []
            for c in chunk:
                front = c.get('front') or c.get('front_text') or ''
                parsed = parse_exercise_content(front)
                chunk_for_prompt.append({
                    'front': parsed['exercise'], 'task': parsed['task'],
                    'options': parsed['options'], 'source': parsed['context'],
                    'examples': parsed['examples'],
                    'back': c.get('back') or c.get('back_text') or '',
                    'card_type': c.get('card_type') or detect_ai_input_type(front),
                })
            prompt_text = json.dumps(chunk_for_prompt, ensure_ascii=False)
            system_prompt = build_batch_enrichment_prompt(chunk_for_prompt, target_lang, native_lang)

            logger.info(f"Batch Quiz AI: processing chunk {index+1}/{len(chunks)} ({len(chunk)} items)...")
            response, success = await client.chat_completion(
                system_prompt=system_prompt,
                user_message=prompt_text,
                model=model_name
            )

            if success and response:
                try:
                    items = parse_ai_batch_json_response(response, expected_count=len(chunk))
                    if items and len(items) > 0:
                        for original_card, generated_item in zip(chunk, items):
                            merged = dict(original_card)
                            card_type = original_card.get('card_type') or detect_ai_input_type(
                                original_card.get('front') or original_card.get('front_text') or '')
                            if generated_item.get("front") and card_type == 'quiz':
                                original_front = original_card.get("front") or original_card.get("front_text") or ""
                                protected_front = restore_exercise_content(
                                    parse_exercise_content(original_front),
                                    generated_item["front"],
                                )
                                merged["front"] = protected_front
                                merged["front_text"] = protected_front
                            if generated_item.get("back") and card_type in ('standard', 'quiz', 'free_text'):
                                merged["back"] = generated_item["back"]
                                merged["back_text"] = generated_item["back"]
                            if generated_item.get("context"):
                                merged["context"] = generated_item["context"]
                            if generated_item.get("level"):
                                from api.services.cefr_metadata import build_ai_cefr_payload
                                merged["level"] = generated_item["level"]
                                merged["tags"] = generated_item["level"]
                                merged["cefr"] = build_ai_cefr_payload(generated_item["level"])
                            merged["card_type"] = card_type
                            enriched_cards.append(merged)
                    else:
                        logger.warning(f"Could not parse AI response chunk {index}")
                        return {"error": "ИИ не вернул карточки", "status_code": 502}
                except Exception as parse_e:
                    logger.warning(f"Error parsing AI enriched cards chunk {index}: {parse_e}")
                    return {"error": str(parse_e), "status_code": 502}
            else:
                logger.error(f"Batch Quiz AI chunk {index+1} failed: {response}")
                return {"error": str(response or "ИИ вернул пустой ответ"), "status_code": 502}

        duration = time.time() - start_time
        logger.info(f"Batch Quiz AI finished in {duration:.2f}s, total cards: {len(enriched_cards)}")
        return {"status": "success", "cards": enriched_cards}

    except Exception as e:
        logger.error(f"Critical error in enrich_batch_quiz_fields: {e}", exc_info=True)
        return {"error": str(e)}


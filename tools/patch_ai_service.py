"""
Patch script: integrates local CEFR pre-filter into classify_phrases_batch.
Run from project root:  python tools/patch_ai_service.py
"""
import re
from pathlib import Path

TARGET = Path("api/ai_service.py")

NEW_FUNC = '''async def classify_phrases_batch(phrases: list[str], target_language: str = "de") -> list[str]:
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
    phrases_for_ai = []
    ai_indices     = []

    lang = (target_language or "de").lower()

    if lang == "de":
        try:
            from api.services.classifier import classify_sentence_fast
            local_hits = 0
            for i, phrase in enumerate(phrases):
                local = classify_sentence_fast(phrase.strip(), "de")
                if local.get("confidence", 0.0) >= 0.80:
                    final_results[i] = local["level"]
                    local_hits += 1
                else:
                    phrases_for_ai.append(phrase)
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
        logger.warning("classify_phrases_batch: No AI model configured, returning default A1 for remaining.")
        return final_results

    client     = AIService(provider=provider, api_key=ai_key)
    model_name = ai_model.strip()

    numbered_phrases = "\\n".join([f"{i+1}. {p.strip()}" for i, p in enumerate(phrases_for_ai)])

    from api.services.language_service import get_cefr_rubric
    rubric = get_cefr_rubric(target_language)

    prompt = (
        f"Определи точный уровень сложности CEFR (A1, A2, B1, B2, C1, C2) для каждого из следующих {len(phrases_for_ai)} элементов:\\n\\n"
        f"{numbered_phrases}\\n\\n"
        f"{rubric}\\n\\n"
        f"Верни СТРОГО JSON-массив строк ровно из {len(phrases_for_ai)} элементов:\\n"
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
            match = re.search(r\'\\[\\s*(.*?)\\s*\\]\', clean, re.DOTALL)
            if match:
                raw_arr    = json.loads(f"[{match.group(1)}]")
                valid_lvls = {"A1", "A2", "B1", "B2", "C1", "C2"}
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

    return final_results
'''

text = TARGET.read_text(encoding="utf-8")

# Find the function by its def line and replace until the next async def / end of file
pattern = re.compile(
    r'(async def classify_phrases_batch\(phrases: list\[str\].*?)(\n\nasync def |\Z)',
    re.DOTALL
)
m = pattern.search(text)
if not m:
    print("ERROR: Could not find classify_phrases_batch in file!")
else:
    new_text = text[:m.start()] + NEW_FUNC + text[m.start(2):]
    TARGET.write_text(new_text, encoding="utf-8")
    print(f"DONE: classify_phrases_batch replaced in {TARGET}")
    print(f"  Old length: {len(m.group(1))} chars")
    print(f"  New length: {len(NEW_FUNC)} chars")

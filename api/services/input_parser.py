import re
from typing import Optional


def detect_ai_input_type(text: str) -> str:
    """Classify AI card input without relying on the stored ``card_type``."""
    normalized = str(text or "").strip()
    if not normalized:
        return "standard"

    # Explicit exercise markers own the card even when their content contains
    # cloze or quiz-like characters.
    if re.search(r"(?im)^\s*@match\b", normalized):
        return "match"
    if re.search(r"(?im)^\s*@puzzle\b", normalized):
        return "puzzle"

    # Keep the established backend priority: quiz markers win over cloze.
    is_quiz = (
        "\n*" in normalized
        or normalized.startswith("*")
        or any(marker in normalized for marker in ["[*]", "[ ]", "[x]", "[X]"])
    )
    if is_quiz:
        return "quiz"

    if re.search(r"\{[^}]+\}|\[\[[^\]]+\]\]", normalized):
        return "trainer"

    trainer_words = ["тренажер", "тренажёр", "пропуск", "cloze", "грамматика", "грамматик"]
    if any(word in normalized.lower() for word in trainer_words):
        return "trainer"

    return "standard"


def preserve_exercise_marker(front: str, input_type: str) -> str:
    """Ensure explicit ``@match``/``@puzzle`` markers survive AI output."""
    if input_type not in {"match", "puzzle"}:
        return front

    marker = f"@{input_type}"
    generated_front = str(front or "").strip()
    if re.search(rf"(?im)^\s*{re.escape(marker)}\b", generated_front):
        return generated_front

    generated_front = re.sub(r"(?im)^\s*@(match|puzzle)\b\s*", "", generated_front, count=1).strip()
    return f"{marker}\n{generated_front}" if generated_front else marker


def parse_ai_json_response(text: str) -> Optional[dict]:
    """
    Extracts and parses JSON object from AI response text.
    Returns dict with 'front', 'back', and 'context' keys if parsing succeeds, or None if invalid.
    """
    if not text:
        return None

    clean_text = text.replace("END_JSON", "").strip()

    if "```" in clean_text:
        match = re.search(r'```(?:json)?\s*(.*?)\s*```', clean_text, re.DOTALL | re.IGNORECASE)
        clean_text = match.group(1).strip() if match else re.sub(r'^```(?:json)?\n?', '', clean_text, flags=re.IGNORECASE).strip()

    first_brace = clean_text.find('{')
    last_brace = clean_text.rfind('}')

    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        json_str = clean_text[first_brace:last_brace + 1]
    elif first_brace != -1:
        json_str = clean_text[first_brace:]
    else:
        json_str = clean_text

    try:
        import json
        data = json.loads(json_str)
        if isinstance(data, dict):
            front = data.get("front", "")
            back = data.get("back", "")
            context = data.get("context", "")
            if "rule" in data and not context:
                context = data.get("rule", "")
            if "explanation" in data and not context:
                context = data.get("explanation", "")
            return {"front": front, "back": back, "context": context}
    except Exception:
        pass

    # Fallback to regex extraction
    front = back = context = ""
    m_front = re.search(r'"front"\s*:\s*"(.*?)"', text, re.DOTALL)
    if m_front:
        front = m_front.group(1).replace('\\"', '"').replace('\\n', '\n')
    m_back = re.search(r'"back"\s*:\s*"(.*?)"', text, re.DOTALL)
    if m_back:
        back = m_back.group(1).replace('\\"', '"').replace('\\n', '\n')
    m_context = re.search(r'"context"\s*:\s*"(.*?)"', text, re.DOTALL)
    if m_context:
        context = m_context.group(1).replace('\\"', '"').replace('\\n', '\n')

    if front or back or context:
        return {"front": front, "back": back, "context": context}

    return None


def parse_ai_batch_json_response(text: str) -> list:
    """
    Extracts and parses a JSON array of cards from AI response text.
    Normalizes front, back, context, level, and tags for each card item.
    """
    if not text:
        return []

    clean_text = str(text).replace("END_JSON", "").strip()

    if "```" in clean_text:
        match = re.search(r'```(?:json)?\s*(.*?)\s*```', clean_text, re.DOTALL | re.IGNORECASE)
        clean_text = match.group(1).strip() if match else re.sub(r'^```(?:json)?\n?', '', clean_text, flags=re.IGNORECASE).strip()

    items = []
    first_bracket = clean_text.find('[')
    last_bracket = clean_text.rfind(']')

    if first_bracket != -1 and last_bracket != -1 and last_bracket > first_bracket:
        array_str = clean_text[first_bracket:last_bracket + 1]
        try:
            import json
            parsed = json.loads(array_str)
            if isinstance(parsed, list):
                items = parsed
        except Exception:
            pass

    if not items:
        try:
            import json
            parsed = json.loads(clean_text)
            if isinstance(parsed, list):
                items = parsed
            elif isinstance(parsed, dict):
                for key in ["cards", "items", "result", "results", "data"]:
                    if isinstance(parsed.get(key), list):
                        items = parsed[key]
                        break
        except Exception:
            pass

    valid_levels = {"A1", "A2", "B1", "B2", "C1", "C2"}
    results = []

    if isinstance(items, list) and items:
        for item in items:
            if isinstance(item, dict):
                front = item.get("front", "")
                back = item.get("back", "")
                context = item.get("context", "")
                raw_lvl = str(item.get("level", "")).upper().strip()
                lvl = raw_lvl if raw_lvl in valid_levels else "A1"
                results.append({
                    "front": front,
                    "back": back,
                    "context": context,
                    "level": lvl,
                    "tags": lvl
                })

    return results

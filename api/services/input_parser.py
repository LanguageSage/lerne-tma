import re
from typing import Optional


EXERCISE_BLOCK_TYPES = {"task", "options", "context", "example"}
EXERCISE_MARKER_TO_BLOCK_TYPE = {
    "task": "task",
    "options": "options",
    "source": "context",
    "example": "example",
}


def _is_exercise_marker(line: str) -> bool:
    return bool(re.fullmatch(r"\s*::exercise\s*", line or "", re.IGNORECASE))


def _exercise_block_type(line: str) -> str | None:
    match = re.fullmatch(r"\s*::(task|options|source|example)\s*", line or "", re.IGNORECASE)
    block_type = EXERCISE_MARKER_TO_BLOCK_TYPE.get(match.group(1).lower()) if match else None
    return block_type if block_type in EXERCISE_BLOCK_TYPES else None


def _exercise_block_marker(block_type: str) -> str:
    return f"::{'source' if block_type == 'context' else block_type}"


def parse_exercise_content(raw_text: str) -> dict:
    """Split leading visual blocks from the exercise without changing storage."""
    raw = str(raw_text or "").replace("\r\n", "\n").replace("\r", "\n")
    empty = {
        "task": "",
        "options": [],
        "context": "",
        "examples": [],
        "blocks": [],
        "exercise": raw.strip(),
        "raw_preamble": "",
        "has_blocks": False,
    }
    if not raw.strip():
        return empty

    lines = raw.split("\n")
    first_non_empty = 0
    while first_non_empty < len(lines) and not lines[first_non_empty].strip():
        first_non_empty += 1
    if first_non_empty >= len(lines) or not _exercise_block_type(lines[first_non_empty]):
        return empty

    explicit_exercise_idx = -1
    for idx, line in enumerate(lines):
        if _is_exercise_marker(line):
            explicit_exercise_idx = idx
            break

    blocks = []
    exercise_start = len(lines)
    index = first_non_empty

    if explicit_exercise_idx != -1 and explicit_exercise_idx >= first_non_empty:
        # Mode A: Explicit ::exercise marker present
        while index < explicit_exercise_idx:
            if not lines[index].strip():
                index += 1
                continue

            block_type = _exercise_block_type(lines[index])
            if not block_type:
                index += 1
                continue

            marker = _exercise_block_marker(block_type)
            index += 1
            content_lines = []

            while index < explicit_exercise_idx:
                if _exercise_block_type(lines[index]):
                    break
                content_lines.append(lines[index])
                index += 1

            content = "\n".join(content_lines).strip()
            block = {"type": block_type, "marker": marker, "content": content}
            if block_type == "options":
                block["options"] = [
                    value.strip()
                    for value in re.split(r"\s*\|\s*|\n+", content)
                    if value.strip()
                ]
            blocks.append(block)

        exercise_start = explicit_exercise_idx + 1
    else:
        # Mode B: Implicit boundary (no ::exercise marker)
        finished_preamble = False

        while index < len(lines) and not finished_preamble:
            block_type = _exercise_block_type(lines[index])
            if not block_type:
                exercise_start = index
                break

            marker = _exercise_block_marker(block_type)
            index += 1
            content_lines = []

            while index < len(lines):
                if _is_exercise_marker(lines[index]):
                    exercise_start = index + 1
                    finished_preamble = True
                    break

                if _exercise_block_type(lines[index]):
                    break

                if not lines[index].strip():
                    next_index = index
                    while next_index < len(lines) and not lines[next_index].strip():
                        next_index += 1
                    if next_index < len(lines) and _is_exercise_marker(lines[next_index]):
                        exercise_start = next_index + 1
                        finished_preamble = True
                        break
                    if next_index < len(lines) and _exercise_block_type(lines[next_index]):
                        index = next_index
                    else:
                        exercise_start = next_index
                        finished_preamble = True
                    break

                content_lines.append(lines[index])
                index += 1

            content = "\n".join(content_lines).strip()
            block = {"type": block_type, "marker": marker, "content": content}
            if block_type == "options":
                block["options"] = [
                    value.strip()
                    for value in re.split(r"\s*\|\s*|\n+", content)
                    if value.strip()
                ]
            blocks.append(block)

    raw_exercise_lines = lines[exercise_start:]
    while raw_exercise_lines and _is_exercise_marker(raw_exercise_lines[0]):
        raw_exercise_lines = raw_exercise_lines[1:]
    exercise = "\n".join(raw_exercise_lines).strip()

    def first_content(block_type: str) -> str:
        return next(
            (block["content"] for block in blocks if block["type"] == block_type and block["content"]),
            "",
        )

    return {
        "task": first_content("task"),
        "options": [
            option
            for block in blocks
            if block["type"] == "options"
            for option in block.get("options", [])
        ],
        "context": first_content("context"),
        "examples": [
            block["content"]
            for block in blocks
            if block["type"] == "example" and block["content"]
        ],
        "blocks": blocks,
        "exercise": "\n".join(lines[exercise_start:]).strip(),
        "raw_preamble": "\n".join(lines[:exercise_start]).strip(),
        "has_blocks": bool(blocks),
    }


def restore_exercise_content(parsed_content: dict, generated_exercise: str) -> str:
    """Reattach the original visual preamble after AI changes the exercise."""
    generated = parse_exercise_content(generated_exercise)
    exercise = (
        generated["exercise"] if generated["has_blocks"] else str(generated_exercise or "")
    ).strip()
    preamble = str((parsed_content or {}).get("raw_preamble") or "").strip()
    if not preamble:
        return exercise
    has_source = bool((parsed_content or {}).get("context"))
    has_exercise_marker = bool(re.search(r"(?im)^\s*::exercise\s*$", preamble))
    if has_source and not has_exercise_marker:
        return f"{preamble}\n\n::exercise\n{exercise}" if exercise else f"{preamble}\n\n::exercise"
    return f"{preamble}\n\n{exercise}" if exercise else preamble


def detect_ai_input_type(text: str) -> str:
    """
    Classify AI card input without relying on the stored ``card_type``.

    Architectural Principle:
    - front_text is the storage source of truth for the complete card.
    - parse_exercise_content(front_text) is the single boundary between visual preamble blocks and exercise syntax.
    - parsed["exercise"] is the ONLY front text allowed to be passed to specialized exercise analyzers.
    """
    parsed = parse_exercise_content(text)
    normalized = str(parsed["exercise"] if parsed["has_blocks"] else (text or "")).strip()
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

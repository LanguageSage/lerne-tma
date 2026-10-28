import re
from typing import Optional


EXERCISE_BLOCK_TYPES = {"task", "options", "context", "example", "level", "topic"}
EXERCISE_MARKER_TO_BLOCK_TYPE = {
    "task": "task",
    "options": "options",
    "source": "context",
    "example": "example",
    "level": "level",
    "topic": "topic",
}


def _is_exercise_marker(line: str) -> bool:
    return bool(re.fullmatch(r"\s*::exercise\s*", line or "", re.IGNORECASE))


def _exercise_block_type(line: str) -> str | None:
    match = re.fullmatch(r"\s*::(task|options|source|example|level|topic)\s*", line or "", re.IGNORECASE)
    block_type = EXERCISE_MARKER_TO_BLOCK_TYPE.get(match.group(1).lower()) if match else None
    return block_type if block_type in EXERCISE_BLOCK_TYPES else None


def _exercise_block_marker(block_type: str) -> str:
    return f"::{'source' if block_type == 'context' else block_type}"


def _interactive_marker(line: str) -> bool:
    return bool(re.fullmatch(r"[ \t]*@(puzzle|match|wordbank|free|edit|theory)[ \t]*", line or "", re.IGNORECASE))


def parse_exercise_content(raw_text: str) -> dict:
    """Split visual information and standalone interactive blocks without changing storage."""
    raw = str(raw_text or "").replace("\r\n", "\n").replace("\r", "\n")
    empty = {
        "task": "",
        "options": [],
        "context": "",
        "examples": [],
        "blocks": [],
        "exercise": raw.strip(),
        "raw_preamble": "",
        "is_theory": False,
        "has_blocks": False,
    }
    if not raw.strip():
        return empty

    lines = raw.split("\n")
    has_explicit_exercise = any(_is_exercise_marker(line) for line in lines)
    blocks = []
    current_type = None
    current_marker = None
    current_lines = []
    exercise_start = None
    is_theory = False

    def save_block():
        nonlocal current_type, current_marker, current_lines
        content = "\n".join(current_lines).strip()
        if current_type or content:
            block = {"type": current_type or "exercise", "marker": current_marker, "content": content}
            if current_type == "options":
                block["options"] = [v.strip() for v in re.split(r"\s*\|\s*|\n+", content) if v.strip()]
            blocks.append(block)
        current_type, current_marker, current_lines = None, None, []

    for index, line in enumerate(lines):
        info_type = _exercise_block_type(line)
        is_exercise = _is_exercise_marker(line)
        if info_type or is_exercise:
            save_block()
            current_type = info_type or "exercise"
            current_marker = _exercise_block_marker(current_type)
            if is_exercise and exercise_start is None:
                exercise_start = index + 1
            continue

        # Retain legacy blank-line boundaries for plain exercises. A standalone
        # directive after a blank line starts an exercise even if ::exercise is
        # elsewhere; contiguous directives inside information remain literal.
        if current_type and current_type != "exercise" and not line.strip():
            next_index = index
            while next_index < len(lines) and not lines[next_index].strip():
                next_index += 1
            if next_index < len(lines):
                next_line = lines[next_index]
                if _interactive_marker(next_line) or (
                    not has_explicit_exercise and not _exercise_block_type(next_line)
                ):
                    save_block()
                    current_type = "exercise"
                    if exercise_start is None:
                        exercise_start = next_index

        if re.fullmatch(r"[ \t]*@theory[ \t]*", line, re.IGNORECASE) and current_type in (None, "exercise"):
            is_theory = True
            continue

        if _interactive_marker(line) and current_type in (None, "exercise"):
            if any(value.strip() for value in current_lines):
                save_block()
            current_type = "exercise"
        if current_type in (None, "exercise") and line.strip() and exercise_start is None:
            exercise_start = index
        current_lines.append(line)
    save_block()

    exercise = "\n\n".join(b["content"] for b in blocks if b["type"] == "exercise").strip()
    raw_preamble = "\n".join(lines[:exercise_start]).strip()

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
        "level": first_content("level"),
        "topic": first_content("topic"),
        "examples": [
            block["content"]
            for block in blocks
            if block["type"] == "example" and block["content"]
        ],
        "blocks": blocks,
        "exercise": exercise,
        "raw_preamble": raw_preamble,
        "is_theory": is_theory,
        "has_blocks": any(b["type"] != "exercise" for b in blocks),
    }


def restore_exercise_content(parsed_content: dict, generated_exercise: str) -> str:
    """Reattach the original visual preamble after AI changes the exercise."""
    generated = parse_exercise_content(generated_exercise)
    exercise = (
        generated["exercise"] if generated["has_blocks"] or generated.get('is_theory') else str(generated_exercise or "")
    ).strip()
    preamble = str((parsed_content or {}).get("raw_preamble") or "").strip()
    blocks = (parsed_content or {}).get("blocks", [])
    first_exercise = next((i for i, b in enumerate(blocks) if b['type'] == 'exercise'), len(blocks))
    trailing_info = '\n\n'.join(
        b['marker'] + '\n' + b['content'] for b in blocks[first_exercise + 1:] if b['type'] != 'exercise'
    )
    if not preamble:
        restored = exercise
    else:
        has_source = bool((parsed_content or {}).get("context"))
        has_exercise_marker = bool(re.search(r"(?im)^\s*::exercise\s*$", preamble))
        if has_source and not has_exercise_marker:
            preamble += '\n\n::exercise'
        restored = f"{preamble}\n\n{exercise}" if exercise else preamble
    result = '\n\n'.join(part for part in (restored, trailing_info) if part)
    return preserve_exercise_marker(result, 'theory') if parsed_content.get('is_theory') else result


def detect_ai_input_type(text: str) -> str:
    """
    Classify AI card input without relying on the stored ``card_type``.

    Architectural Principle:
    - front_text is the storage source of truth for the complete card.
    - parse_exercise_content(front_text) is the single boundary between visual preamble blocks and exercise syntax.
    - parsed["exercise"] is the ONLY front text allowed to be passed to specialized exercise analyzers.
    """
    parsed = parse_exercise_content(text)
    if parsed.get('is_theory'):
        return "theory"
    normalized = str(parsed["exercise"]).strip()
    if not normalized:
        return "standard"

    # Explicit exercise markers own the card even when their content contains
    # cloze or quiz-like characters.
    if re.search(r"(?im)^[ \t]*@match[ \t]*$", normalized):
        return "match"
    if re.search(r"(?im)^[ \t]*@puzzle[ \t]*$", normalized):
        return "puzzle"
    if re.search(r"(?im)^[ \t]*@wordbank[ \t]*$", normalized):
        return "word_bank"
    if re.search(r"(?im)^[ \t]*@free[ \t]*$", normalized):
        return "free_text"
    if re.search(r"(?im)^[ \t]*@edit[ \t]*$", normalized):
        return "editable_text"

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


_TRAINER_SYNTAX = re.compile(r"\{[^}]+\}|\[\[[^\]]+\]\]")
_OPTION_LINE = re.compile(r"^\*(?!\*)|^\[[*xX ]\]|^[-○•]|^(?:[a-zA-Z]|[0-9]{1,2})(?:\)|\.\s)")
_CORRECT_OPTION = (re.compile(r"^\*(?!\*)"), re.compile(r"^\[\*\]"),
                   re.compile(r"^(?:[a-zA-Z]|[0-9]{1,2})[).]\s*\*(?!\*)"), re.compile(r"^[-○•]\s*\*(?!\*)"))


def _option_parts(line: str) -> tuple[bool, str]:
    """Mirror parseQuizOption in app/src/utils/quizParser.js (without Markdown stripping)."""
    line = line.strip()
    cleaned = line
    for pattern in (r"^\[[*xX ]\]\s*", r"^\*(?!\*)\s*", r"^[-○•]\s*",
                    r"^(?:[a-zA-Z]|[0-9]{1,2})[).]\s*", r"^\*(?!\*)\s*"):
        cleaned = re.sub(pattern, "", cleaned, count=1)
    return any(rx.search(line) for rx in _CORRECT_OPTION), cleaned


def find_quiz_option_start(lines: list[str], *, allow_empty_question: bool = False) -> int:
    """Same whole-block boundary contract as quizParser.js/findQuizOptionStart."""
    lines = [re.sub(r"\{[^}]+\}", "__TRAINER_CHOICE__",
                    re.sub(r"\[\[[^\]]+\]\]", "__TRAINER_INPUT__", line)).strip() for line in lines]
    end = len(lines)
    while end and not lines[end - 1]:
        end -= 1

    def valid_start(start, accepts):
        options = [line for line in lines[start:end] if line]
        return start if ((allow_empty_question or (start > 0 and any(lines[:start])))
                         and all(accepts(line) for line in options)
                         and sum(bool(_option_parts(line)[1]) for line in options) >= 2) else -1

    def is_option(line):
        return bool(_OPTION_LINE.search(line))

    def bare_star(line):
        return re.match(r'^\*(?!\*)', line) and not is_option(re.sub(r'^\*(?!\*)\s*', '', line))

    checkbox = next((i for i, line in enumerate(lines) if re.match(r'^\[[*xX ]\]', line)), -1)
    if checkbox != -1:
        while checkbox > 0 and bare_star(lines[checkbox - 1]):
            checkbox -= 1
        return valid_start(checkbox, lambda line: re.match(r'^\[[*xX ]\]', line) or bare_star(line))

    paragraph = end
    while paragraph > 0 and lines[paragraph - 1]:
        paragraph -= 1

    def label_kind(line):
        match = re.match(r'^(?:([a-zA-Z])|([0-9]{1,2}))(?:\)|\.\s)', re.sub(r'^\*(?!\*)\s*', '', line))
        return ('letter' if match[1] else 'number') if match else None

    tail = lines[paragraph:end]
    start = end
    while start > paragraph and is_option(lines[start - 1]):
        start -= 1
    structured_suffix = any(is_option(re.sub(r'^\*(?!\*)\s*', '', line)) for line in lines[start:end])
    if (paragraph > 0 and any(re.match(r'^\*(?!\*)', line) for line in tail)
            and any(not is_option(line) for line in tail)
            and not any(map(label_kind, tail)) and (not structured_suffix or end - start < 2)):
        legacy_start = valid_start(paragraph, lambda _line: True)
        if legacy_start != -1:
            return legacy_start

    def coherent(option_lines):
        labels = [match[1].lower() for line in option_lines
                  if (match := re.match(r'^([a-zA-Z]|[0-9]{1,2})(?:\)|\.\s)', re.sub(r'^\*(?!\*)\s*', '', line)))]
        return len({kind for line in option_lines if (kind := label_kind(line))}) <= 1 and len(set(labels)) == len(labels)

    while start > 0 and not lines[start - 1]:
        previous_end = start
        while previous_end > 0 and not lines[previous_end - 1]:
            previous_end -= 1
        previous_start = previous_end
        while previous_start > 0 and is_option(lines[previous_start - 1]):
            previous_start -= 1
        if previous_start == 0 or previous_start == previous_end or not coherent(lines[previous_start:end]):
            break
        start = previous_start
    context_start = start
    while context_start > 0 and lines[context_start - 1]:
        context_start -= 1
    kinds = {kind for line in lines[start:end] if (kind := label_kind(line))}
    if (not coherent(lines[start:end])
            or any(label_kind(line) in kinds for line in lines[context_start:start])):
        return -1
    return valid_start(start, is_option)


def parse_quiz_options(exercise: str, *, allow_empty_question: bool = False) -> list[tuple[bool, str]]:
    """Parse only a complete answer block; ambiguous syntax stays source text."""
    masked = re.sub(r"\{[^}]+\}", "__TRAINER_CHOICE__", re.sub(r"\[\[[^\]]+\]\]", "__TRAINER_INPUT__", exercise))
    lines = masked.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    first = find_quiz_option_start(lines, allow_empty_question=allow_empty_question)
    if first < 0:
        return []
    return [parts for line in lines[first:] if line.strip() and (parts := _option_parts(line))[1]]


def _has_quiz_structure(exercise: str, *, allow_empty_question: bool = False) -> bool:
    """>= 2 options with a correct marker; explicit exercises may omit the question."""
    options = parse_quiz_options(exercise, allow_empty_question=allow_empty_question)
    return any(correct for correct, _ in options) and sum(1 for _, text in options if text) >= 2


def detect_card_type(text: str) -> str:
    """Classify a stored card FRONT exactly like the client (exerciseDetector.js).

    Unlike detect_ai_input_type this is not a heuristic for raw AI input: quiz needs a real
    option structure, trainer tokens win over quiz and no keyword guessing is applied.
    Shared fixtures: local/test-data/fixtures/exercise_detection_corpus.json.
    """
    parsed = parse_exercise_content(text)
    if parsed.get("is_theory"):
        return "theory"
    normalized = parsed["exercise"].strip()
    if not normalized:
        return "standard"
    for marker, card_type in (("match", "match"), ("free", "free_text"), ("edit", "editable_text"),
                              ("puzzle", "puzzle"), ("wordbank", "word_bank")):
        if re.search(rf"(?im)^[ \t]*@{marker}[ \t]*$", normalized):
            return card_type
    if _TRAINER_SYNTAX.search(normalized):
        return "trainer"
    allow_empty_question = any(b['type'] == 'exercise' and b['marker'] for b in parsed['blocks'])
    if _has_quiz_structure(normalized, allow_empty_question=allow_empty_question):
        return "quiz"
    return "standard"


def preserve_exercise_marker(front: str, input_type: str) -> str:
    """Ensure explicit markers survive AI output."""
    type_to_marker = {
        "theory": "@theory",
        "match": "@match",
        "puzzle": "@puzzle",
        "free_text": "@free",
        "editable_text": "@edit",
        "word_bank": "@wordbank"
    }
    if input_type not in type_to_marker:
        return front

    marker = type_to_marker[input_type]
    generated_front = str(front or "").strip()
    if re.search(rf"(?im)^\s*{re.escape(marker)}\b", generated_front):
        return generated_front

    generated_front = re.sub(r"(?im)^\s*@(match|puzzle|free|edit|wordbank)\b\s*", "", generated_front, count=1).strip()
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


def parse_ai_batch_json_response(text: str, *, expected_count: int = None) -> list:
    """
    Extracts and parses a JSON array of cards from AI response text.
    Normalizes front, back, context, level, and tags for each card item.
    """
    if not text:
        if expected_count is not None:
            raise ValueError('ИИ вернул пустой ответ')
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
                front = item.get("front", item.get("front_text", ""))
                back = item.get("back", item.get("back_text", ""))
                context = item.get("context", "")
                if expected_count is not None and (
                    not isinstance(front, str) or not front.strip()
                    or not isinstance(back, str) or not back.strip()
                    or not isinstance(context, str)
                ):
                    raise ValueError('ИИ вернул карточку с некорректными полями front/back/context')
                raw_lvl = str(item.get("level", "")).upper().strip()
                lvl = raw_lvl if raw_lvl in valid_levels else "A1"
                results.append({
                    "front": front,
                    "back": back,
                    "context": context,
                    "level": lvl,
                    "tags": lvl
                })

    if expected_count is not None and len(results) != expected_count:
        raise ValueError(f'ИИ вернул {len(results)} карточек вместо {expected_count}')
    return results

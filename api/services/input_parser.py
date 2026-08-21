import re
from typing import NamedTuple, Optional

class ParsedInput(NamedTuple):
    clean_phrase: str
    directive: Optional[str]
    has_directive: bool

def parse_user_input(text: str) -> ParsedInput:
    """
    Parses user input phrase.
    If the text has a new line at the end containing parenthesized instructions/questions,
    e.g.:
      "Ich fahre mit dem Bus\n(почему dem, а не den?)"
    it extracts the clean phrase ("Ich fahre mit dem Bus") and the directive ("почему dem, а не den?").
    
    Rule: Matches `\\n\\s*\\((.+)\\)\\s*$` at the very end of the string.
    """
    if not text:
        return ParsedInput(clean_phrase="", directive=None, has_directive=False)

    text_str = text.strip()
    
    # Match a newline followed by optional whitespace and parenthesized directive at string end
    match = re.search(r'\n\s*\((.+?)\)\s*$', text_str, re.DOTALL)
    if match:
        directive_text = match.group(1).strip()
        clean_text = text_str[:match.start()].strip()
        if clean_text and directive_text:
            return ParsedInput(clean_phrase=clean_text, directive=directive_text, has_directive=True)
            
    return ParsedInput(clean_phrase=text_str, directive=None, has_directive=False)


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


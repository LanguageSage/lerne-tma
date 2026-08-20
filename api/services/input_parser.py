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
    
    # Match a newline followed by optional whitespace, open paren, content, close paren at string end
    match = re.search(r'\n\s*\((.+?)\)\s*$', text_str, re.DOTALL)
    if match:
        directive_text = match.group(1).strip()
        clean_text = text_str[:match.start()].strip()
        if clean_text and directive_text:
            return ParsedInput(clean_phrase=clean_text, directive=directive_text, has_directive=True)
            
    return ParsedInput(clean_phrase=text_str, directive=None, has_directive=False)

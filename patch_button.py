import re

file_path = r'c:\121\Lerne_projekt\tma\app\src\components\deckgrid\DeckCardItem.jsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# We want to find the exact button block
# It starts with `{!deck.is_inbox && !deck.is_global_readonly && (`
# Then `<button`
# `className="dropdown-item"`
# `style={{ opacity: 0.6, cursor: 'not-allowed' }}`
# etc.
# We will use regex to find and replace it.

pattern = re.compile(
    r'(\{!deck\.is_inbox && !deck\.is_global_readonly && \(\s*<button\s+className="dropdown-item"\s+)style=\{\{\s*opacity:\s*0\.6,\s*cursor:\s*\'not-allowed\'\s*\}\}\s+onClick=\{\(e\)\s*=>\s*\{[^}]*showToast\([^}]*\}\}\s+title=\{[^}]*\}\s*>\s*<span>([^<]*?)\s*\(в разработке\)</span>\s*</button>\s*\})',
    re.DOTALL
)

def replace_func(match):
    prefix = match.group(1)
    span_content = match.group(2)
    # Rebuild the button without the stub
    return (
        "{!deck.is_inbox && !deck.is_global_readonly && (\n"
        "              <button \n"
        "                className=\"dropdown-item\" \n"
        "                onClick={(e) => {\n"
        "                  handleToggleLearning(e);\n"
        "                  setIsMenuOpen(false);\n"
        "                }}\n"
        "              >\n"
        f"                <span>{span_content}</span>\n"
        "              </button>\n"
        "            )}"
    )

new_content = pattern.sub(replace_func, content)

if new_content == content:
    print("No changes made. Regex didn't match.")
else:
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Successfully replaced.")

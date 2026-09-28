import sys

file_path = r'c:\121\Lerne_projekt\tma\app\src\components\deckgrid\DeckCardItem.jsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the duplicate line
bad_duplicate = (
    "            {!deck.is_inbox && !deck.is_global_readonly && (\n"
    "            {!deck.is_inbox && !deck.is_global_readonly && (\n"
)
good_single = "            {!deck.is_inbox && !deck.is_global_readonly && (\n"

if bad_duplicate in content:
    content = content.replace(bad_duplicate, good_single)
    with open(file_path, 'w', encoding='utf-8', newline='') as f:
        f.write(content)
    print("Fixed duplicate.")
else:
    print("No duplicate found.")

import re

path = r'c:\121\Lerne_projekt\tma\app\src\components\deckgrid\FolderTreeNav.jsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace both back to old just in case
content = content.replace("{(!folder.is_global_readonly || isAdmin) && (", "{!folder.is_global_readonly && (")

# Now properly replace only the menu one
content = content.replace(
    "<div className=\"deck-footer-actions-right\">\n          {!folder.is_global_readonly && (",
    "<div className=\"deck-footer-actions-right\">\n          {(!folder.is_global_readonly || isAdmin) && ("
)

with open(path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print("Fixed visibility condition.")

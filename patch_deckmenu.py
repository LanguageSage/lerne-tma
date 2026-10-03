import re

path = r'c:\121\Lerne_projekt\tma\app\src\components\deckgrid\DeckCardItem.jsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add useAuthStore if not present
if "import { useAuthStore }" not in content:
    content = content.replace(
        "import { useDeckStore } from '../../store/useDeckStore';",
        "import { useDeckStore } from '../../store/useDeckStore';\nimport { useAuthStore } from '../../store/useAuthStore';"
    )

# Add isAdmin variable
if "const isAdmin = " not in content:
    content = content.replace(
        "const [menuPlacement, setMenuPlacement] = useState('bottom');",
        "const [menuPlacement, setMenuPlacement] = useState('bottom');\n  const isAdmin = useAuthStore(state => state.userProfile?.is_admin);"
    )

# Fix menu visibility condition
old_cond = "{!deck.is_global_readonly && !deck.is_inbox && ("
new_cond = "{(!deck.is_global_readonly || isAdmin) && !deck.is_inbox && ("

if old_cond in content:
    # Only replace the one controlling the menu trigger button
    # Let's do string replacement for the specific block
    menu_block_old = (
        "        <div className=\"deck-footer-actions-right\">\n"
        "          {!deck.is_global_readonly && !deck.is_inbox && (\n"
        "            <button \n"
        "              className={`card-item-actions-trigger ${isMenuOpen ? 'active' : ''}`}"
    )
    menu_block_new = (
        "        <div className=\"deck-footer-actions-right\">\n"
        "          {(!deck.is_global_readonly || isAdmin) && !deck.is_inbox && (\n"
        "            <button \n"
        "              className={`card-item-actions-trigger ${isMenuOpen ? 'active' : ''}`}"
    )
    if menu_block_old in content:
        content = content.replace(menu_block_old, menu_block_new)
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(content)
        print("DeckCardItem.jsx menu patched")
    else:
        print("DeckCardItem menu block not found")
else:
    print("old_cond not found")

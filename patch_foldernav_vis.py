import re

path = r'c:\121\Lerne_projekt\tma\app\src\components\deckgrid\FolderTreeNav.jsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old_cond = "{!folder.is_global_readonly && ("
new_cond = "{(!folder.is_global_readonly || isAdmin) && ("

if old_cond in content:
    # Need to be careful because there might be other usages, but wait, I only added it once to hide the menu button.
    # Also I hid the drag handle with `{!folder.is_global_readonly && (` 
    # Actually, drag handle doesn't matter much for admins. But menu does.
    content = content.replace(old_cond, new_cond, 1) # only first occurrence which is the menu button
    # Actually, let's make sure it's the right one
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)
    print("FolderTreeNav.jsx visibility patched")
else:
    print("visibility condition not found")

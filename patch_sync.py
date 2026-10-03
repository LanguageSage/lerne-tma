import re

path = r'c:\121\Lerne_projekt\tma\api\routers\auth.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old_return = (
    "                \"active_language\": user.active_language or \"de\",\n"
    "                \"native_language\": getattr(user, 'native_language', None) or \"uk\",\n"
    "                \"has_selected_language\": bool(user.has_selected_language)\n"
    "            }\n"
    "        }\n"
)
new_return = (
    "                \"active_language\": user.active_language or \"de\",\n"
    "                \"native_language\": getattr(user, 'native_language', None) or \"uk\",\n"
    "                \"has_selected_language\": bool(user.has_selected_language),\n"
    "                \"is_admin\": bool(user.username in ADMIN_USERNAMES)\n"
    "            }\n"
    "        }\n"
)

if old_return in content:
    content = content.replace(old_return, new_return)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)
    print("auth.py sync_user patched")
else:
    print("old_return not found in sync_user")

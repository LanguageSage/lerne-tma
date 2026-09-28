import re

def patch_auth_v2():
    path = r'c:\121\Lerne_projekt\tma\api\routers\auth_v2.py'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    admin_code = "ADMIN_USERNAMES = {'Nimaypumpay', 'Aruna27', 'Chintamanichapliuk'}"
    if admin_code not in content:
        content = content.replace("from api.models import TMAUser\n", f"from api.models import TMAUser\n\n{admin_code}\n")
    
    old_return = (
        "        'native_language': user.native_language or 'uk',\n"
        "        'has_selected_language': bool(user.has_selected_language),\n"
        "        'is_guest': False,\n"
        "    }"
    )
    new_return = (
        "        'native_language': user.native_language or 'uk',\n"
        "        'has_selected_language': bool(user.has_selected_language),\n"
        "        'is_guest': False,\n"
        "        'is_admin': bool(user.username in ADMIN_USERNAMES),\n"
        "    }"
    )
    if old_return in content:
        content = content.replace(old_return, new_return)
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(content)
        print("auth_v2.py patched")
    else:
        print("auth_v2.py old_return not found")

def patch_auth():
    path = r'c:\121\Lerne_projekt\tma\api\routers\auth.py'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    admin_code = "ADMIN_USERNAMES = {'Nimaypumpay', 'Aruna27', 'Chintamanichapliuk'}"
    if admin_code not in content:
        content = content.replace("from api.models import TMAUser, tma_db\n", f"from api.models import TMAUser, tma_db\n\n{admin_code}\n")
    
    old_return = (
        "        \"active_language\": user.active_language or \"de\",\n"
        "        \"native_language\": getattr(user, 'native_language', None) or \"uk\",\n"
        "        \"has_selected_language\": bool(user.has_selected_language)\n"
        "    }"
    )
    new_return = (
        "        \"active_language\": user.active_language or \"de\",\n"
        "        \"native_language\": getattr(user, 'native_language', None) or \"uk\",\n"
        "        \"has_selected_language\": bool(user.has_selected_language),\n"
        "        \"is_admin\": bool(user.username in ADMIN_USERNAMES)\n"
        "    }"
    )
    if old_return in content:
        content = content.replace(old_return, new_return)
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(content)
        print("auth.py patched")
    else:
        print("auth.py old_return not found")

patch_auth_v2()
patch_auth()

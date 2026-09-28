import re

path = r'c:\121\Lerne_projekt\tma\api\services\collaborative_service.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old_admin_check = (
    "    admin_id = int(os.environ.get(\"ADMIN_USER_ID\", \"642478257\"))\n"
    "    if requester_id != admin_id:\n"
    "        raise HTTPException(status_code=403, detail=\"Only the platform admin can set access_scope\")"
)

new_admin_check = (
    "    admin_usernames = {'Nimaypumpay', 'Aruna27', 'Chintamanichapliuk'}\n"
    "    user = models.TMAUser.get_or_none(models.TMAUser.user_id == requester_id)\n"
    "    if not user or user.username not in admin_usernames:\n"
    "        raise HTTPException(status_code=403, detail=\"Only the platform admin can set access_scope\")"
)

if old_admin_check in content:
    content = content.replace(old_admin_check, new_admin_check)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)
    print("collaborative_service.py patched")
else:
    print("old_admin_check not found")

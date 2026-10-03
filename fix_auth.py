import re

path = r'c:\121\Lerne_projekt\tma\api\routers\auth.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

admin_code = "ADMIN_USERNAMES = {'Nimaypumpay', 'Aruna27', 'Chintamanichapliuk'}\n"

if "ADMIN_USERNAMES = " not in content:
    # Insert right after logger = logging.getLogger(__name__)
    content = content.replace(
        "logger = logging.getLogger(__name__)\n",
        "logger = logging.getLogger(__name__)\n\n" + admin_code
    )
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)
    print("auth.py admin list added")
else:
    print("Already added")

import os

root_dir = 'c:\\121\\Lerne_projekt\\tma\\api'

files_to_update = [
    os.path.join(root_dir, 'main.py'),
    os.path.join(root_dir, 'routers', 'decks.py'),
    os.path.join(root_dir, 'routers', 'cards.py'),
    os.path.join(root_dir, 'routers', 'study.py'),
    os.path.join(root_dir, 'routers', 'settings.py'),
    os.path.join(root_dir, 'routers', 'media.py'),
    os.path.join(root_dir, 'routers', 'ai.py'),
    os.path.join(root_dir, 'routers', 'bot.py'),
]

for file_path in files_to_update:
    if not os.path.exists(file_path):
        continue
    
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replace simple import
    content = content.replace('import services', 'from api import services')
    # If it was already from api import models, services, it should be fine.
    # But let's be specific for main.py
    if 'from api import models, services' in content:
        # Already correct for a package
        pass

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

print("Updated imports in all routers and main.py.")

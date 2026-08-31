import sys

with open('tools/admin/server.py', 'r', encoding='utf-8') as f:
    content = f.read()

start_batch = content.find('# ==========================================\n# Batch Multi-Deck Regeneration API\n# ==========================================')
if start_batch == -1:
    print('Batch section not found!')
    sys.exit(1)

end_batch = content.find('class BackupSettingsRequest', start_batch)
if end_batch == -1:
    print('End of batch section not found!')
    sys.exit(1)

batch_code = content[start_batch:end_batch]
content = content[:start_batch] + content[end_batch:]

insert_pos = content.find('@app.post("/api/admin/decks/{deck_id}/deduplicate")')
if insert_pos == -1:
    insert_pos = content.find('@app.post("/api/admin/decks/{deck_id}/regenerate")')

content = content[:insert_pos] + '\n\n' + batch_code + '\n\n' + content[insert_pos:]

with open('tools/admin/server.py', 'w', encoding='utf-8') as f:
    f.write(content)

print('Moved Batch routes above Single Deck routes successfully!')

import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('app/src/data/lidQuestions.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

for q in d['questions'][:8]:
    print(f"ID: {q['id']}, Num: {q['num']}")
    print(f"  DE Q: {q['question']}")
    print(f"  RU Q: {q.get('translationRu', {}).get('question')}")
    for opt in q['options']:
        oid = opt['id']
        ru_val = q.get('translationRu', {}).get(oid)
        print(f"    [{oid}] DE: {opt['text']}  --> RU: {ru_val}")
    print("---")

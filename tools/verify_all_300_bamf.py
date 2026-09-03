import json
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('app/src/data/lidQuestions.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

qs = data['questions']
gen_qs = [q for q in qs if q['block'] in [1, 2, 3]]

print(f"Total general questions: {len(gen_qs)}")

# Check numbering continuity
for idx, q in enumerate(gen_qs):
    expected_num = str(idx + 1)
    actual_num = str(q.get('num'))
    if actual_num != expected_num:
        print(f"Mismatch at index {idx}: expected num '{expected_num}', got '{actual_num}' (id: {q.get('id')})")

print("All general questions 1-300 continuous check finished.")

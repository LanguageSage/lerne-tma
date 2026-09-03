import json
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('app/src/data/lidQuestions.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

questions = data['questions']

print("=== CHECKING GENERAL QUESTIONS 1-300 ===")
for i in range(0, 300, 10):
    q = questions[i]
    print(f"Index {i:3d} (Expected #{i+1:3d}): num='{q.get('num')}', block={q.get('block')}, id='{q.get('id')}' -> {q['question'][:60]}")

print("\n=== CHECKING LAST 10 QUESTIONS OF GENERAL (291-300) ===")
for i in range(290, 300):
    q = questions[i]
    print(f"Index {i:3d} (#{i+1:3d}): num='{q.get('num')}', block={q.get('block')}, id='{q.get('id')}' -> {q['question'][:60]}")

print("\n=== CHECKING STATE QUESTIONS 301-460 ===")
for i in range(300, 460, 10):
    q = questions[i]
    print(f"Index {i:3d} (#{i+1:3d}): num='{q.get('num')}', block={q.get('block')}, state={q.get('stateCode')}, id='{q.get('id')}' -> {q['question'][:60]}")

import json
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('app/src/data/lidQuestions.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

questions = data['questions']
print("=== FIRST 30 QUESTIONS IN lidQuestions.json ===")
for i, q in enumerate(questions[:30]):
    print(f"{i+1:2d}. [num={q.get('num')}] {q['question']}")

print("\n=== QUESTIONS 95-105 IN lidQuestions.json ===")
for i, q in enumerate(questions[94:105], start=95):
    print(f"{i:3d}. [num={q.get('num')}] {q['question']}")

print("\n=== QUESTIONS 195-205 IN lidQuestions.json ===")
for i, q in enumerate(questions[194:205], start=195):
    print(f"{i:3d}. [num={q.get('num')}] {q['question']}")

print("\n=== QUESTIONS 290-300 IN lidQuestions.json ===")
for i, q in enumerate(questions[289:300], start=290):
    print(f"{i:3d}. [num={q.get('num')}] {q['question']}")

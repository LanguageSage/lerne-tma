import json
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('app/src/data/lidQuestions.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

qs = data['questions']
states = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH']

for st in states:
    st_qs = [q for q in qs if q.get('stateCode') == st]
    print(f"\nState {st} ({len(st_qs)} questions):")
    for q in st_qs:
        print(f"  [{q.get('num')}] (id={q.get('id')}): {q['question'][:50]}")

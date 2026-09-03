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
    seen_texts = set()
    duplicates = []
    for q in st_qs:
        t = q['question'].strip()
        if t in seen_texts:
            duplicates.append((q['num'], t))
        seen_texts.add(t)
    if duplicates:
        print(f"State {st} has duplicates: {duplicates}")
    else:
        print(f"State {st}: OK (10 unique questions)")

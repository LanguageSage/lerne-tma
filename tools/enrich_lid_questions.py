import os
import sys
import json
import re

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from api.database import initialize_database
if not initialize_database():
    print("Failed to initialize database")
    sys.exit(1)

from api import models

def enrich_questions():
    json_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'app', 'src', 'data', 'lidQuestions.json'))
    with open(json_path, 'r', encoding='utf-8') as f:
        lid_data = json.load(f)
        
    norm = lambda s: re.sub(r'\s+', ' ', (s or '').replace('\n', ' ')).strip()

    # Query all cards in DB from 'Leben in Deutschland' folder that have rich context
    print("Loading cards from database...")
    rich_cards = list(models.TMA_Card.select(models.TMA_Card, models.TMA_Deck).join(models.TMA_Deck).join(models.TMA_Folder).where(
        models.TMA_Folder.name == 'Leben in Deutschland',
        models.TMA_Card.context.contains('🎯')
    ))
    print(f"Found {len(rich_cards)} cards with rich context in DB")

    # Map by (deck_name, norm_question) and (norm_question)
    rich_map_by_deck = {}
    rich_map_by_question = {}

    for c in rich_cards:
        deck_name = c.deck.name if c.deck else ""
        first_line = norm(c.front_text.split('\n\n')[0] if '\n\n' in (c.front_text or '') else (c.front_text or '').split('\n')[0])
        
        if (deck_name, first_line) not in rich_map_by_deck:
            rich_map_by_deck[(deck_name, first_line)] = c
            
        if first_line not in rich_map_by_question:
            rich_map_by_question[first_line] = c

    state_map = lid_data['stateCodeMap']
    matched = 0
    missing = []

    for q in lid_data['questions']:
        q_norm = norm(q['question'])
        
        if q['block'] == 1:
            deck_name = '1. Politik in der Demokratie (1–100)'
        elif q['block'] == 2:
            deck_name = '2. Geschichte und Verantwortung (101–200)'
        elif q['block'] == 3:
            deck_name = '3. Mensch und Gesellschaft (201–300)'
        else:
            state_info = state_map.get(q.get('stateCode'))
            deck_name = state_info['name_de'] if state_info else None

        found = rich_map_by_deck.get((deck_name, q_norm))
        if not found:
            found = rich_map_by_question.get(q_norm)
            
        # Partial match fallback
        if not found:
            for (d_name, f_line), c in rich_map_by_deck.items():
                if d_name == deck_name and (q_norm[:30] in f_line or f_line[:30] in q_norm):
                    found = c
                    break

        if not found:
            for f_line, c in rich_map_by_question.items():
                if q_norm[:30] in f_line or f_line[:30] in q_norm:
                    found = c
                    break

        if found:
            matched += 1
            q['cardBack'] = found.back_text or ''
            q['cardContext'] = found.context or ''
            q['context'] = found.context or ''
            if found.audio_path:
                q['audioUrl'] = found.audio_path
        else:
            missing.append((q['id'], q['question'], deck_name))

    print(f"Total questions in JSON: {len(lid_data['questions'])}")
    print(f"Matched with rich context: {matched}")
    print(f"Missing: {len(missing)}")
    for m in missing:
        print("  Missing:", m)

    # Save to lidQuestions.json
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(lid_data, f, ensure_ascii=False, indent=2)

    print(f"✅ Successfully written to {json_path}")

if __name__ == '__main__':
    enrich_questions()

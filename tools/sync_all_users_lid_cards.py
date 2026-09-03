import os
import sys
import json
import io

sys.stdout.reconfigure(encoding='utf-8')
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from api.database import initialize_database
if not initialize_database():
    print("❌ Failed to connect to database", flush=True)
    sys.exit(1)

from api import models

JSON_PATH = os.path.join(project_root, 'app', 'src', 'data', 'lidQuestions.json')

def sync_all_users():
    print("🚀 Начало быстрой синхронизации карточек Leben in Deutschland для ВСЕХ пользователей...", flush=True)
    with open(JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    questions = data['questions']
    print(f"Загружено {len(questions)} вопросов из {JSON_PATH}", flush=True)

    # Pre-build lookup map for fast O(1) matching
    q_lookup = {}
    for q in questions:
        q_text = q['question'].strip()
        q_lookup[q_text] = q
        if len(q_text) >= 28:
            q_lookup[q_text[:28]] = q

    # Find all LiD folders across ALL users
    lid_folders = list(models.TMA_Folder.select().where(
        (models.TMA_Folder.name.ilike('%Leben in Deutschland%')) &
        (models.TMA_Folder.is_deleted == False)
    ))
    folder_ids = [f.id for f in lid_folders]
    print(f"Найдено {len(lid_folders)} LiD папок в БД", flush=True)

    decks = list(models.TMA_Deck.select().where(
        (models.TMA_Deck.folder_id.in_(folder_ids)) &
        (models.TMA_Deck.is_deleted == False)
    ))
    deck_ids = [d.id for d in decks]
    print(f"Найдено {len(decks)} LiD колод в БД", flush=True)

    cards = list(models.TMA_Card.select().where(
        (models.TMA_Card.deck_id.in_(deck_ids)) &
        (models.TMA_Card.is_deleted == False)
    ))
    print(f"Всего LiD карточек для проверки/обновления: {len(cards)}", flush=True)

    cards_to_update = []
    for card in cards:
        front = (card.front_text or '').strip()
        lines = front.split('\n')
        q_text = lines[0].strip() if lines else ''

        matched_q = q_lookup.get(q_text) or q_lookup.get(q_text[:28])
        if not matched_q:
            for q in questions:
                if q['question'].strip().startswith(q_text[:22]) or q_text.startswith(q['question'].strip()[:22]):
                    matched_q = q
                    break

        if matched_q:
            tr = matched_q.get('translationRu') or {}
            ru_q = tr.get('question', '').strip() if isinstance(tr, dict) else ''
            ru_context = tr.get('context', '').strip() if isinstance(tr, dict) else ''
            de_context = matched_q.get('context', '').strip() if matched_q.get('context') else ''

            # Format clean front with correct * marker on correct option
            options_lines = []
            for opt in matched_q.get('options', []):
                is_corr = opt['id'] == matched_q.get('correctOption')
                prefix = '*' if is_corr else ''
                options_lines.append(f"{prefix}{opt['text']}")
            
            new_front = f"{matched_q['question']}\n\n" + "\n".join(options_lines)
            
            # Format rich back with translation & explanation
            back_parts = []
            if ru_q:
                back_parts.append(ru_q)
            
            # Add detailed option translations on back
            opt_trans_lines = []
            for opt in matched_q.get('options', []):
                opt_id = opt['id']
                opt_ru = tr.get(opt_id, '') if isinstance(tr, dict) else ''
                is_corr = opt['id'] == matched_q.get('correctOption')
                mark = '✅' if is_corr else '▫️'
                if opt_ru:
                    opt_trans_lines.append(f"{mark} {opt_id.upper()}: {opt['text']} — {opt_ru}")
                else:
                    opt_trans_lines.append(f"{mark} {opt_id.upper()}: {opt['text']}")
            
            if opt_trans_lines:
                back_parts.append("\n" + "\n".join(opt_trans_lines))

            if ru_context or de_context:
                ctx_text = f"💡 {ru_context}" if ru_context else f"💡 {de_context}"
                back_parts.append(f"\n{ctx_text}")

            new_back = "\n\n".join(back_parts).strip()

            card.front_text = new_front
            card.back_text = new_back
            if ru_context or de_context:
                card.context = f"🎯 {ru_context}" if ru_context else f"🎯 {de_context}"
            if matched_q.get('image'):
                card.image_path = matched_q['image']
            card.card_type = 'quiz'
            cards_to_update.append(card)

    print(f"Подготовлено к пакетному сохранению: {len(cards_to_update)} карточек...", flush=True)

    # Fast bulk update in chunks of 500
    chunk_size = 500
    with models.tma_db.atomic():
        for i in range(0, len(cards_to_update), chunk_size):
            chunk = cards_to_update[i:i+chunk_size]
            models.TMA_Card.bulk_update(
                chunk,
                fields=[
                    models.TMA_Card.front_text,
                    models.TMA_Card.back_text,
                    models.TMA_Card.context,
                    models.TMA_Card.image_path,
                    models.TMA_Card.card_type
                ]
            )
            print(f"  💾 Обновлено {min(i+chunk_size, len(cards_to_update))}/{len(cards_to_update)} карточек", flush=True)

    print(f"\n🎉 ВСЕГО успешно синхронизировано {len(cards_to_update)} карточек по ВСЕМ 28 пользователям в базе данных!", flush=True)

if __name__ == '__main__':
    sync_all_users()

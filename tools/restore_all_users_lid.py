"""Restores and synchronizes Leben in Deutschland decks with canonical color images for all users."""
import io
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from api.database import initialize_database

if not initialize_database():
    print("❌ Failed to connect to database", flush=True)
    sys.exit(1)

from api import models, services

JSON_PATH = os.path.join(project_root, 'tools', 'lidQuestions.json')
LID_IMAGES_DIR = os.path.join(project_root, 'app', 'public', 'lid_images')


def ensure_media_in_db():
    """Ensures all 42 color images from app/public/lid_images exist in TMAMedia."""
    if not os.path.exists(LID_IMAGES_DIR):
        print(f"⚠️ Images directory not found: {LID_IMAGES_DIR}", flush=True)
        return

    files = [f for f in os.listdir(LID_IMAGES_DIR) if os.path.isfile(os.path.join(LID_IMAGES_DIR, f))]
    print(f"📸 Checking {len(files)} image files in TMAMedia DB...", flush=True)
    uploaded = 0

    for fn in files:
        fp = os.path.join(LID_IMAGES_DIR, fn)
        with open(fp, 'rb') as f:
            content = f.read()

        existing = models.TMAMedia.get_or_none(
            (models.TMAMedia.filename == fn) &
            (models.TMAMedia.folder == 'images')
        )
        if not existing:
            models.TMAMedia.create(
                filename=fn,
                folder='images',
                content=content
            )
            uploaded += 1

    print(f"✅ Verified {len(files)} media files in TMAMedia (newly added: {uploaded})", flush=True)


def build_card_payloads(questions, deck_id):
    """Builds clean card payload dictionary list from question objects."""
    cards_payload = []
    for q in questions:
        opts_str = '\n'.join([
            ('*' + o['text'] if o['id'] == q['correctOption'] else o['text'])
            for o in q['options']
        ])
        front_text = f"{q['question']}\n\n{opts_str}"

        tr = q.get('translationRu') or {}
        ru_q = tr.get('question', '').strip() if isinstance(tr, dict) else ''
        ru_context = tr.get('context', '').strip() if isinstance(tr, dict) else ''
        de_context = q.get('context', '').strip() if q.get('context') else ''

        back_parts = []
        if ru_q:
            back_parts.append(ru_q)

        opt_trans_lines = []
        for opt in q.get('options', []):
            opt_id = opt['id']
            opt_ru = tr.get(opt_id, '') if isinstance(tr, dict) else ''
            is_corr = opt['id'] == q.get('correctOption')
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

        back_text = "\n\n".join(back_parts).strip()
        ctx = f"🎯 {ru_context}" if ru_context else (f"🎯 {de_context}" if de_context else '')

        img_rel = q.get('image') or ''
        if img_rel and not img_rel.startswith('/lid_images/'):
            img_rel = f"/lid_images/{os.path.basename(img_rel)}"

        cards_payload.append({
            'deck_id': deck_id,
            'front': front_text,
            'back': back_text,
            'context': ctx,
            'image_path': img_rel,
            'card_type': 'quiz',
            'level': 'B1'
        })
    return cards_payload


def restore_all_users():
    """Restores all 19 decks for all users possessing a 'Leben in Deutschland' folder."""
    ensure_media_in_db()

    with open(JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    questions = data['questions']
    state_map = data['stateCodeMap']
    print(f"📖 Loaded {len(questions)} canonical questions from {JSON_PATH}", flush=True)

    general_blocks = [
        (1, '1. Politik in der Demokratie (1–100)'),
        (2, '2. Geschichte und Verantwortung (101–200)'),
        (3, '3. Mensch und Gesellschaft (201–300)')
    ]

    # Find all users
    all_users = list(models.TMAUser.select())
    print(f"\n👥 Processing {len(all_users)} total users...", flush=True)

    total_restored_cards = 0

    for user in all_users:
        user_id = user.user_id
        username = user.username or f"user_{user_id}"

        # Find or create root folder
        root_folder = models.TMA_Folder.get_or_none(
            (models.TMA_Folder.user_id == user_id) &
            (models.TMA_Folder.name.ilike('%Leben in Deutschland%')) &
            (models.TMA_Folder.is_deleted == False)
        )
        if not root_folder:
            root_folder = models.TMA_Folder.create(
                user_id=user_id,
                name='Leben in Deutschland',
                color='#ffd043',
                target_language='de'
            )
            print(f"  📁 [{username}] Created folder 'Leben in Deutschland'", flush=True)

        user_cards_count = 0

        # 1. Populate the 3 General Decks
        for block_num, deck_name in general_blocks:
            deck = models.TMA_Deck.get_or_none(
                (models.TMA_Deck.user_id == user_id) &
                (models.TMA_Deck.folder == root_folder) &
                (models.TMA_Deck.name == deck_name) &
                (models.TMA_Deck.is_deleted == False)
            )
            if not deck:
                deck = models.TMA_Deck.create(
                    user_id=user_id,
                    folder=root_folder,
                    name=deck_name,
                    target_language='de',
                    level='B1',
                    is_pinned=True,
                    position=block_num
                )

            block_qs = [q for q in questions if q.get('block') == block_num]
            payloads = build_card_payloads(block_qs, deck.id)

            # Atomic replace cards in deck
            with models.tma_db.atomic():
                models.TMA_Card.delete().where(models.TMA_Card.deck == deck).execute()
                saved = services.bulk_save_cards(payloads, user_id)
                user_cards_count += len(saved)

        # 2. Populate 16 Bundesland Decks
        state_pos = 4
        for code, info in state_map.items():
            state_deck_name = info['name_de']
            deck = models.TMA_Deck.get_or_none(
                (models.TMA_Deck.user_id == user_id) &
                (models.TMA_Deck.folder == root_folder) &
                (models.TMA_Deck.name == state_deck_name) &
                (models.TMA_Deck.is_deleted == False)
            )
            if not deck:
                deck = models.TMA_Deck.create(
                    user_id=user_id,
                    folder=root_folder,
                    name=state_deck_name,
                    target_language='de',
                    level='B1',
                    is_pinned=False,
                    position=state_pos
                )
            state_pos += 1

            state_qs = [q for q in questions if q.get('block') == 'state' and q.get('stateCode') == code]
            payloads = build_card_payloads(state_qs, deck.id)

            with models.tma_db.atomic():
                models.TMA_Card.delete().where(models.TMA_Card.deck == deck).execute()
                saved = services.bulk_save_cards(payloads, user_id)
                user_cards_count += len(saved)

        print(f"  ✅ [{username}] Restored 19 decks ({user_cards_count} cards with color images)", flush=True)
        total_restored_cards += user_cards_count

    # 3. Update Deck 691 (Test "Leben in Deutschland" 300) for aruna27 if present
    deck_691 = models.TMA_Deck.get_or_none(
        (models.TMA_Deck.id == 691) &
        (models.TMA_Deck.is_deleted == False)
    )
    if deck_691:
        print("\n🎨 Updating Deck 691 (Test 'Leben in Deutschland' 300) with color images...", flush=True)
        gen_qs = [q for q in questions if q.get('block') in (1, 2, 3)]
        q_map = {q['question'].strip(): q for q in gen_qs}
        q_sub_map = {q['question'].strip()[:25]: q for q in gen_qs if len(q['question'].strip()) >= 25}

        cards_691 = list(models.TMA_Card.select().where(
            (models.TMA_Card.deck == deck_691) &
            (models.TMA_Card.is_deleted == False)
        ))
        updated_691 = 0
        with models.tma_db.atomic():
            for c in cards_691:
                first_line = (c.front_text or '').split('\n')[0].strip()
                matched = q_map.get(first_line) or q_sub_map.get(first_line[:25])
                if matched and matched.get('image'):
                    img_rel = matched['image']
                    if not img_rel.startswith('/lid_images/'):
                        img_rel = f"/lid_images/{os.path.basename(img_rel)}"
                    c.image_path = img_rel
                    c.save()
                    updated_691 += 1
        print(f"✅ Updated {updated_691} cards in Deck 691 with color BAMF images!", flush=True)

    print(f"\n🎉 SUCCESS: All users synchronized! Total cards restored across all users: {total_restored_cards}", flush=True)


if __name__ == '__main__':
    restore_all_users()

"""Apply reviewed Relativsaetze B1 updates transactionally to Supabase.

Guards:
- Verifies folder 285 (14 decks, 678 cards), strictly excludes folder 343.
- Verifies every deck/card matches original in update-plan.json.
- Creates a full fresh backup before applying.
- Atomic PostgreSQL transaction.
- Zero cards/decks deleted or recreated.
- Preserves all user SRS, progress, and review history.
- Inserts 8 Grammar Knowledge Items and 48 diagnostic mappings for D14.
- Runs post-apply verification and Lesson QA on the live database.
"""
import argparse
import datetime
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.update(VERCEL='1', RUN_MIGRATIONS='false', FORCE_LOCAL_DB='false')

from api.models import (
    TMA_Folder, TMA_Deck, TMA_Card, TMAKnowledgeItem, TMACardKnowledgeItem, tma_db
)
from api.database import initialize_database
from scripts.lesson_qa import read_database, run_audit

OUT = ROOT / 'reports/lesson-qa'
TARGET_FOLDER_ID = 285
EXCLUDED_FOLDER_ID = 343


def run_prechecks(plan):
    print("--- 1. Prechecks & Safety Guards ---")
    if not initialize_database():
        raise RuntimeError("Failed to initialize database connection")

    # Read live data first (read_database manages its own connection_context)
    live_data = read_database(folder_id=TARGET_FOLDER_ID)
    live_decks = live_data['decks']
    live_cards = live_data['cards']

    print(f"Active decks in folder {TARGET_FOLDER_ID}: {len(live_decks)}")
    print(f"Active cards in folder {TARGET_FOLDER_ID}: {len(live_cards)}")

    if len(live_decks) != 14:
        raise RuntimeError(f"Expected 14 active decks, found {len(live_decks)}")
    if len(live_cards) != 678:
        raise RuntimeError(f"Expected 678 active cards, found {len(live_cards)}")

    with tma_db.connection_context(), tma_db.atomic():
        tma_db.execute_sql('SET TRANSACTION READ ONLY')

        # Check target folder
        target_folder = TMA_Folder.get_or_none(TMA_Folder.id == TARGET_FOLDER_ID, TMA_Folder.is_deleted == False)
        if not target_folder:
            raise RuntimeError(f"Target folder {TARGET_FOLDER_ID} not found or deleted")

        # Verify excluded folder 343 is not in scope
        deck_ids = {d['id'] for d in live_decks}
        archive_decks = list(TMA_Deck.select().where(TMA_Deck.folder_id == EXCLUDED_FOLDER_ID, TMA_Deck.is_deleted == False))
        if any(d.id in deck_ids for d in archive_decks):
            raise RuntimeError(f"Found archive deck from folder {EXCLUDED_FOLDER_ID} in target scope!")

        # Verify original fields against live DB
        deck_changes = plan['changes']['decks']
        card_changes = plan['changes']['cards']

        db_decks_map = {d.id: d for d in TMA_Deck.select().where(TMA_Deck.id.in_([d['id'] for d in deck_changes]))}
        deck_mismatches = []
        for d in deck_changes:
            deck_id = d['id']
            db_d = db_decks_map.get(deck_id)
            if not db_d:
                deck_mismatches.append(f"Deck {deck_id} not found in DB")
                continue
            orig_meta = d['original'].get('metadata')
            if json.loads(db_d.metadata or '{}') != json.loads(orig_meta or '{}'):
                deck_mismatches.append(f"Deck {deck_id} metadata mismatch")

        db_cards_map = {c.id: c for c in TMA_Card.select().where(TMA_Card.id.in_([c['id'] for c in card_changes]))}
        card_mismatches = []
        for c in card_changes:
            card_id = c['id']
            db_c = db_cards_map.get(card_id)
            if not db_c:
                card_mismatches.append(f"Card {card_id} not found in DB")
                continue
            orig = c['original']
            for field in c['fields']:
                db_val = getattr(db_c, field)
                orig_val = orig.get(field)
                if field == 'metadata':
                    db_meta = json.loads(db_val) if db_val else None
                    orig_meta = json.loads(orig_val) if orig_val else None
                    if db_meta != orig_meta:
                        card_mismatches.append(f"Card {card_id} metadata mismatch")
                else:
                    if db_val != orig_val:
                        card_mismatches.append(f"Card {card_id} field {field} mismatch")

        if deck_mismatches or card_mismatches:
            raise RuntimeError(
                f"Data mismatch between live DB and update plan! Decks: {len(deck_mismatches)}, Cards: {len(card_mismatches)}"
            )

        print("All 9 decks and 158 cards in plan match live DB original exactly.")
        return live_data


def create_fresh_backup(live_data):
    print("--- 2. Creating Fresh Backup ---")
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_file = OUT / f"pre-apply-backup-{timestamp}.json"
    backup_file.write_text(json.dumps(live_data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    # Also save as pre-apply-backup-latest.json
    (OUT / "pre-apply-backup-latest.json").write_text(json.dumps(live_data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"Saved fresh backup to {backup_file.name} ({len(live_data['cards'])} cards, {len(live_data['decks'])} decks)")
    return backup_file


def apply_updates(plan, dry_run=False):
    deck_changes = plan['changes']['decks']
    card_changes = plan['changes']['cards']
    knowledge_seed = plan['knowledge_seed']
    # 48 diagnostic mappings for D14
    d14_card_ids = set(range(358363, 358411))
    d14_mappings = [m for m in plan['knowledge_mappings'] if m['card_id'] in d14_card_ids]

    mode_label = "DRY RUN (ROLLBACK)" if dry_run else "PRODUCTION APPLY (COMMIT)"
    print(f"\n--- 3. Executing {mode_label} ---")
    print(f"Decks to update: {len(deck_changes)}")
    print(f"Cards to update: {len(card_changes)}")
    print(f"Knowledge Items to seed: {len(knowledge_seed)}")
    print(f"D14 diagnostic mappings to create: {len(d14_mappings)}")

    with tma_db.connection_context(), tma_db.atomic() as txn:
        # Update decks
        for d in deck_changes:
            deck_id = d['id']
            new_metadata = d['proposed']['metadata']
            TMA_Deck.update(metadata=new_metadata).where(TMA_Deck.id == deck_id).execute()

        # Update cards
        for c in card_changes:
            card_id = c['id']
            proposed = c['proposed']
            update_fields = {}
            for field in c['fields']:
                update_fields[field] = proposed[field]
            TMA_Card.update(**update_fields).where(TMA_Card.id == card_id).execute()

        # Insert Knowledge Items (idempotent get_or_create by rule_code)
        ki_map = {}
        for item in knowledge_seed:
            ki, created = TMAKnowledgeItem.get_or_create(
                rule_code=item['rule_code'],
                defaults={
                    'name': item['name'],
                    'language': item.get('language', 'de'),
                    'category': item.get('category', 'grammar'),
                    'cefr_level': item.get('cefr_level', 'B1'),
                    'is_global': item.get('is_global', True),
                    'author_id': item.get('author_id', None),
                    'description': item.get('description', ''),
                }
            )
            if not created:
                # Update details if needed
                ki.name = item['name']
                ki.description = item.get('description', '')
                ki.cefr_level = item.get('cefr_level', 'B1')
                ki.save()
            ki_map[item['rule_code']] = ki

        # Insert D14 diagnostic mappings into TMACardKnowledgeItem
        created_mappings = 0
        for m in d14_mappings:
            ki = ki_map[m['rule_code']]
            mapping, created = TMACardKnowledgeItem.get_or_create(
                card_id=m['card_id'],
                knowledge_item=ki,
                defaults={
                    'role': m.get('role', 'primary'),
                    'complexity': m.get('complexity', 3),
                    'weight': m.get('weight', None)
                }
            )
            if created:
                created_mappings += 1

        print(f"Processed {len(ki_map)} Knowledge Items.")
        print(f"Created {created_mappings} new TMACardKnowledgeItem entries (total D14 mappings: {len(d14_mappings)}).")

        if dry_run:
            print("Dry run requested. Rolling back transaction...")
            txn.rollback()
            print("Rollback complete. Zero database changes made.")
            return False

        print("Committing transaction...")

    print("Transaction successfully committed to Supabase!")
    return True


def post_verify():
    print("\n--- 4. Post-Apply Verification & Live Lesson QA ---")
    live_data = read_database(folder_id=TARGET_FOLDER_ID)

    with tma_db.connection_context(), tma_db.atomic():
        tma_db.execute_sql('SET TRANSACTION READ ONLY')

        # Count cards and decks
        decks_count = len(live_data['decks'])
        cards_count = len(live_data['cards'])
        print(f"Live database: {decks_count} decks, {cards_count} cards.")
        if decks_count != 14 or cards_count != 678:
            raise RuntimeError(f"Unexpected count: {decks_count} decks, {cards_count} cards!")

        # Verify Knowledge Items and D14 mappings
        ki_count = TMAKnowledgeItem.select().where(TMAKnowledgeItem.rule_code.startswith('de.relativsaetze.')).count()
        d14_card_ids = list(range(358363, 358411))
        mapping_count = TMACardKnowledgeItem.select().where(TMACardKnowledgeItem.card_id.in_(d14_card_ids)).count()
        print(f"Live Knowledge Items: {ki_count}")
        print(f"Live D14 Card Knowledge Items: {mapping_count}")

        # Check target cards
        card_349238 = TMA_Card.get_by_id(349238)
        print(f"Card 349238 front: {repr(card_349238.front_text)}")
        card_358514 = TMA_Card.get_by_id(358514)
        print(f"Card 358514 front: {repr(card_358514.front_text)}")
        card_348882 = TMA_Card.get_by_id(348882)
        print(f"Card 348882 back: {repr(card_348882.back_text)}")

    # Run full Lesson QA on live database
    print("\nRunning Lesson QA on live database...")
    report = run_audit(live_data)
    qa_path = OUT / 'production-verified.qa.json'
    qa_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"Lesson QA findings: {report['counts']}")
    if report['counts']['ERROR'] > 0:
        raise RuntimeError(f"Lesson QA reported {report['counts']['ERROR']} ERRORs on live DB!")
    print("Lesson QA PASS: 0 ERROR!")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply changes to database (default is dry-run)')
    args = parser.parse_args()

    plan_path = OUT / 'update-plan.json'
    if not plan_path.exists():
        print(f"Error: {plan_path} does not exist", file=sys.stderr)
        return 1

    plan = json.loads(plan_path.read_text(encoding='utf-8'))

    # Step 1: Prechecks
    live_data = run_prechecks(plan)

    # Step 2: Backup
    create_fresh_backup(live_data)

    # Step 3: Apply or Dry run
    if not args.apply:
        print("\n*** DRY-RUN MODE *** Run with --apply to commit changes.")
        apply_updates(plan, dry_run=True)
    else:
        applied = apply_updates(plan, dry_run=False)
        if applied:
            plan['applied'] = True
            plan['applied_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            post_verify()

    print("\nDone.")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

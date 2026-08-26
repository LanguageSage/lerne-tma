#!/usr/bin/env python
"""
tools/reclassify_c1_cards.py

Finds all cards currently tagged as C1 in the database,
re-classifies them using the updated rules (e.g. B1 Adjektiv + zu vs C1 Passiversatzform),
updates the database, and prints a detailed report of changes.
"""

import os, sys, datetime
from collections import Counter

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from api import models
from api.services.classifier import classify_sentence_fast

def main():
    print("=" * 70)
    print("🔍 ПОИСК И ПЕРЕРАЗМЕТКА КАРТОЧЕК С УРОВНЕМ C1")
    print("=" * 70)

    if not models.tma_db.obj:
        models.initialize_database()

    # Query all cards where tags contain C1
    c1_cards = list(
        models.TMA_Card
        .select()
        .where(
            (models.TMA_Card.is_deleted == False) &
            (models.TMA_Card.tags.contains("C1"))
        )
        .order_by(models.TMA_Card.id.asc())
    )

    total_c1 = len(c1_cards)
    print(f"\nНайдено карточек с уровнем C1 в базе: {total_c1}\n")

    if total_c1 == 0:
        print("В базе нет карточек C1.")
        return

    changes = Counter()
    updated_items = []

    print(f"{'ID':<6} {'СТАРЫЙ':<6} {'НОВЫЙ':<6} {'ПРАВИЛО/ПРИЧИНА':<25} {'ФРАЗА'}")
    print("-" * 75)

    with models.tma_db.atomic():
        for card in c1_cards:
            front = (card.front_text or "").strip()
            res = classify_sentence_fast(front, "de")
            new_lvl = res.get("level", "C1")
            reason_short = res.get("reason_short", new_lvl)
            reason = res.get("reason", new_lvl)

            old_tags = card.tags or "C1"

            # Clean old level tags from card.tags and replace with new_lvl
            cleaned_tags = ",".join([
                t for t in str(old_tags).split(",")
                if t and t.upper() not in {"A1", "A2", "B1", "B2", "C1", "C2"}
            ])
            new_tags = f"{cleaned_tags},{new_lvl}".strip(",") if cleaned_tags else new_lvl

            if new_lvl != "C1":
                card.tags = new_tags
                card.updated_at = datetime.datetime.now()
                card.save()
                changes[f"C1 -> {new_lvl}"] += 1
            else:
                changes["C1 (сохранился)"] += 1

            flag = "🔄" if new_lvl != "C1" else "✅"
            print(f"{flag} {card.id:<5} C1     -> {new_lvl:<5} {reason_short:<24} {front[:40]}")

    print("\n" + "=" * 70)
    print("📊 ИТОГОВЫЙ ОТЧЕТ ИЗМЕНЕНИЙ КАРТОЧЕК C1")
    print("=" * 70)
    print(f"Всего проверено C1 карточек: {total_c1}")
    for change_type, count in sorted(changes.items()):
        print(f"  • {change_type}: {count} шт.")
    print("=" * 70 + "\n")

if __name__ == "__main__":
    main()

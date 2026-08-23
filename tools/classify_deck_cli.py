import os, sys, argparse, asyncio, datetime
sys.stdout.reconfigure(encoding="utf-8")
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
from api import models, ai_service

async def classify_deck(deck_id: int, target_lang: str = "de"):
    print("=" * 65)
    print(f"🎯 РАЗМЕТКА УРОВНЕЙ ДЛЯ КОЛОДЫ ID: {deck_id} (Язык: {target_lang.upper()})")
    print("=" * 65)

    if not models.tma_db.obj:
        models.initialize_database()

    deck = models.TMA_Deck.get_or_none(models.TMA_Deck.id == deck_id)
    if not deck:
        print(f"❌ Колода с ID {deck_id} не найдена!")
        return

    print(f"Колода: "{deck.name}"")
    cards = list(models.TMA_Card.select().where(
        (models.TMA_Card.deck_id == deck_id) & (models.TMA_Card.is_deleted == False)
    ).order_by(models.TMA_Card.position.asc(), models.TMA_Card.id.asc()))

    print(f"Всего активных карточек: {len(cards)}")
    if not cards:
        print("В колоде нет карточек.")
        return

    phrases = [(c.front_text or "").strip() for c in cards]
    CHUNK_SIZE = 30
    chunks = [phrases[i:i + CHUNK_SIZE] for i in range(0, len(phrases), CHUNK_SIZE)]
    all_levels = []

    print(f"\nЗапуск классификации ({len(chunks)} пачек)...")
    for idx, chunk in enumerate(chunks):
        print(f"  -> Пачка [{idx + 1}/{len(chunks)}] ({len(chunk)} фраз)... ", end="", flush=True)
        levels = await ai_service.classify_phrases_batch(chunk, target_language=target_lang)
        all_levels.extend(levels)
        print(f"✅ Готово ({len(levels)} уровней)")
        if idx < len(chunks) - 1:
            await asyncio.sleep(1.2)

    now = datetime.datetime.now()
    with models.tma_db.atomic():
        for idx, card in enumerate(cards):
            lvl = all_levels[idx] if idx < len(all_levels) else "A1"
            curr_tags = card.tags or ""
            cleaned_tags = ",".join([t for t in curr_tags.split(",") if t and t.upper() not in {"A1", "A2", "B1", "B2", "C1", "C2"}])
            new_tags = f"{cleaned_tags},{lvl}".strip(",") if cleaned_tags else lvl
            card.tags = new_tags
            card.updated_at = now
            card.save()

    print(f"\n✅ Колода "{deck.name}" успешно размечена! Обновлено {len(cards)} карточек.")
    print("=" * 65)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Classify Single Deck by ID")
    parser.add_argument("deck_id", type=int, help="ID of the deck to classify")
    parser.add_argument("--lang", type=str, default="de", help="Target language (de, en, no)")
    args = parser.parse_args()
    asyncio.run(classify_deck(args.deck_id, args.lang))

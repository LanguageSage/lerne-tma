import os
import sys
import json
import time
import argparse
import asyncio
import datetime
import re

# Set stdout UTF-8 encoding for Windows terminals
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
    except Exception:
        pass

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from api import models, ai_service, services

RATE_LIMIT_KEYWORDS = [
    "429", "rate limit", "ratelimit", "resource_exhausted",
    "resourceexhausted", "too many requests", "quota exceeded",
    "quota", "overloaded", "temporarily unavailable", "503"
]

def is_rate_limit_error(error_str: str) -> bool:
    if not error_str:
        return False
    lower = str(error_str).lower()
    return any(kw in lower for kw in RATE_LIMIT_KEYWORDS)

def ensure_backup(deck: models.TMA_Deck, cards: list) -> str:
    """Creates a local JSON backup of all cards before regeneration."""
    backup_dir = os.path.join(project_root, "api", "data", "backups")
    os.makedirs(backup_dir, exist_ok=True)
    
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"deck_{deck.id}_{timestamp}.json"
    backup_path = os.path.join(backup_dir, backup_filename)
    
    dump_data = {
        "deck": {
            "id": deck.id,
            "name": deck.name,
            "user_id": deck.user_id,
            "target_language": deck.target_language,
            "created_at": str(deck.created_at)
        },
        "cards_count": len(cards),
        "backup_date": timestamp,
        "cards": [
            {
                "id": c.id,
                "front_text": c.front_text,
                "back_text": c.back_text,
                "context": c.context,
                "tags": c.tags,
                "level": getattr(c, 'level', None),
                "audio_path": c.audio_path,
                "audio_back_path": c.audio_back_path,
                "position": c.position
            }
            for c in cards
        ]
    }
    
    with open(backup_path, "w", encoding="utf-8") as f:
        json.dump(dump_data, f, ensure_ascii=False, indent=2)
        
    return backup_path

def get_checkpoint_path(deck_id: int) -> str:
    return os.path.join(project_root, "api", "data", f"regen_checkpoint_deck_{deck_id}.json")

def load_checkpoint(deck_id: int) -> set:
    cp_path = get_checkpoint_path(deck_id)
    if os.path.exists(cp_path):
        try:
            with open(cp_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return set(data.get("completed_card_ids", []))
        except Exception:
            pass
    return set()

def save_checkpoint(deck_id: int, completed_ids: set):
    cp_path = get_checkpoint_path(deck_id)
    try:
        with open(cp_path, "w", encoding="utf-8") as f:
            json.dump({"completed_card_ids": list(completed_ids)}, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

def clear_checkpoint(deck_id: int):
    cp_path = get_checkpoint_path(deck_id)
    if os.path.exists(cp_path):
        try:
            os.remove(cp_path)
        except Exception:
            pass

async def generate_with_retry(
    user_id: int,
    phrase: str,
    target_lang: str,
    native_lang: str,
    action_type: str = "full_card",
    max_retries: int = 6,
    initial_backoff: float = 10.0
) -> tuple[dict, bool]:
    """Generates card with single generation and exponential backoff on rate limits."""
    backoff = initial_backoff
    
    for attempt in range(1, max_retries + 1):
        res = await ai_service.generate_card_fields(
            user_id=user_id,
            phrase=phrase,
            target_language=target_lang,
            native_language=native_lang,
            action_type=action_type
        )
        
        # Check for error
        if isinstance(res, dict) and "error" in res:
            err_msg = res["error"]
            if is_rate_limit_error(err_msg):
                if attempt < max_retries:
                    print(f"\n   ⚠️  [Rate Limit / Лимит API] Ожидание {backoff:.1f}с перед повтором (попытка {attempt}/{max_retries})...", flush=True)
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 1.8, 120.0) # exponential backoff capped at 120s
                    continue
                else:
                    return res, False
            else:
                # Other non-retryable error
                return res, False
                
        return res, True

    return {"error": "Превышено максимальное количество попыток генерации."}, False

async def main():
    parser = argparse.ArgumentParser(description="Regenerate Deck via High-Quality Single Generation")
    parser.add_argument("--deck-id", type=int, default=None, help="Deck ID to regenerate")
    parser.add_argument("--deck-name", type=str, default=None, help="Deck Name search query")
    parser.add_argument("--delay", type=float, default=2.0, help="Delay between cards in seconds (default: 2.0s)")
    parser.add_argument("--max-retries", type=int, default=6, help="Max retry attempts on Rate Limits (default: 6)")
    parser.add_argument("--initial-backoff", type=float, default=10.0, help="Initial backoff wait in seconds on Rate Limit")
    parser.add_argument("--target-lang", type=str, default=None, help="Target language (default: auto from deck or 'de')")
    parser.add_argument("--native-lang", type=str, default=None, help="Native language (default: 'ru' or user setting)")
    parser.add_argument("--no-audio", action="store_true", help="Skip TTS audio regeneration")
    parser.add_argument("--only-empty", action="store_true", help="Only regenerate cards with missing back or context")
    parser.add_argument("--resume", action="store_true", help="Resume from last checkpoint")
    parser.add_argument("--dry-run", action="store_true", help="Test run without saving changes to DB")
    parser.add_argument("--start", type=int, default=None, help="Start card index 1-based (e.g. 11)")
    parser.add_argument("--end", type=int, default=None, help="End card index 1-based (e.g. 290)")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of cards to process (for testing)")
    parser.add_argument("-y", "--yes", action="store_true", help="Skip confirmation prompt")
    parser.add_argument("--list-decks", action="store_true", help="List all available decks and exit")
    args = parser.parse_args()

    print("=" * 70, flush=True)
    print("✨ ПЕРЕГЕНЕРАЦИЯ КОЛОДЫ (ОДИНОЧНАЯ ГЕНЕРАЦИЯ ВЫСОКОГО КАЧЕСТВА)", flush=True)
    print("=" * 70, flush=True)

    # 1. Initialize Database
    print("\n[1/5] Подключение к базе данных...", flush=True)
    if not models.tma_db.obj:
        models.initialize_database()
    print("  -> База данных успешно подключена.")

    # List Decks if requested or if no deck specified
    if args.list_decks or (args.deck_id is None and args.deck_name is None):
        decks = list(models.TMA_Deck.select().where(models.TMA_Deck.is_deleted == False).order_by(models.TMA_Deck.id.desc()))
        print(f"\nНайдено колод в базе: {len(decks)}")
        print("-" * 70)
        print(f"{'ID':<6} | {'Пользователь':<12} | {'Язык':<6} | {'Карточек':<8} | {'Название'}")
        print("-" * 70)
        for d in decks[:40]:
            c_cnt = models.TMA_Card.select().where((models.TMA_Card.deck_id == d.id) & (models.TMA_Card.is_deleted == False)).count()
            print(f"{d.id:<6} | {d.user_id:<12} | {d.target_language or 'de':<6} | {c_cnt:<8} | {d.name}")
        print("-" * 70)
        
        if args.list_decks:
            return

        user_input = input("\nВведите ID или часть названия колоды для перегенерации: ").strip()
        if not user_input:
            print("Отмена операции.")
            return
        if user_input.isdigit():
            args.deck_id = int(user_input)
        else:
            args.deck_name = user_input

    # 2. Find Deck
    deck = None
    if args.deck_id:
        deck = models.TMA_Deck.get_or_none((models.TMA_Deck.id == args.deck_id) & (models.TMA_Deck.is_deleted == False))
    elif args.deck_name:
        deck = models.TMA_Deck.get_or_none(
            (models.TMA_Deck.name.contains(args.deck_name)) & (models.TMA_Deck.is_deleted == False)
        )

    if not deck:
        print(f"❌ Ошибка: Колода не найдена.")
        return

    # 3. Load Cards
    cards = list(
        models.TMA_Card.select()
        .where((models.TMA_Card.deck_id == deck.id) & (models.TMA_Card.is_deleted == False))
        .order_by(models.TMA_Card.position.asc(), models.TMA_Card.id.asc())
    )

    if not cards:
        print(f"❌ В колоде '{deck.name}' (ID: {deck.id}) нет активных карточек.")
        return

    # Language Config
    target_lang = args.target_lang or deck.target_language or "de"
    native_lang = args.native_lang
    if not native_lang:
        native_setting = models.TMASetting.get_or_none(models.TMASetting.key == "NATIVE_LANGUAGE")
        native_lang = native_setting.value if native_setting else "ru"

    provider, _, model_name = ai_service.get_ai_config()

    print(f"\n[2/5] Выбрана колода:")
    print(f"  • Название:         {deck.name}")
    print(f"  • ID колоды:        {deck.id}")
    print(f"  • Владелец:         {deck.user_id}")
    print(f"  • Карточек:         {len(cards)}")
    print(f"  • Изучаемый язык:   {target_lang.upper()}")
    print(f"  • Родной язык:      {native_lang.upper()}")
    print(f"  • ИИ Провайдер:     {provider.upper()} ({model_name or 'Default'})")
    print(f"  • Пауза между фраз: {args.delay} сек.")
    print(f"  • Озвучка (TTS):    {'ВЫКЛ' if args.no_audio else 'ВКЛ (Edge-TTS)'}")
    print(f"  • Режим:            {'DRY-RUN (без записи)' if args.dry_run else 'ПРОДАКШН (с записью в БД)'}")

    # 4. Create Backup
    if not args.dry_run:
        print(f"\n[3/5] Создание резервной копии колоды...")
        backup_file = ensure_backup(deck, cards)
        print(f"  -> Резервная копия сохранена в: {backup_file}")
    else:
        print(f"\n[3/5] Пропуск бэкапа в режиме dry-run.")

    # Checkpoint setup
    completed_ids = load_checkpoint(deck.id) if args.resume else set()
    if args.resume and completed_ids:
        print(f"  -> Найдено в чекпоинте: {len(completed_ids)} ранее готовых карточек.")

    start_idx = (args.start - 1) if args.start and args.start > 0 else 0
    end_idx = args.end if args.end else len(cards)
    target_cards = cards[start_idx:end_idx]

    cards_to_process = []
    for c in target_cards:
        if args.only_empty and c.back_text and c.context:
            continue
        if args.resume and c.id in completed_ids:
            continue
        cards_to_process.append(c)

    if args.limit:
        cards_to_process = cards_to_process[:args.limit]

    print(f"\n[4/5] Подготовка к генерации: {len(cards_to_process)} карточек (диапазон с {start_idx+1} по {min(end_idx, len(cards))}).")
    if not cards_to_process:
        print("Все карточки в указанном диапазоне уже обработаны!")
        return

    if not args.dry_run and not args.yes:
        confirm = input("\nНачать перегенерацию? [Y/n]: ").strip().lower()
        if confirm not in ('', 'y', 'yes', 'д', 'да'):
            print("Отменено пользователем.")
            return

    # 5. Execution Loop
    print("\n[5/5] Запуск поштучной генерации...")
    start_total_time = time.time()
    
    success_count = 0
    fail_count = 0
    level_counts = {}
    
    for idx, card in enumerate(cards_to_process, 1):
        front = (card.front_text or "").strip()
        if not front:
            print(f"[{idx}/{len(cards_to_process)}] Пропуск: пустая лицевая сторона (ID: {card.id})")
            continue

        pct = (idx / len(cards_to_process)) * 100
        t0 = time.time()
        
        res, is_ok = await generate_with_retry(
            user_id=deck.user_id,
            phrase=front,
            target_lang=target_lang,
            native_lang=native_lang,
            action_type="full_card",
            max_retries=args.max_retries,
            initial_backoff=args.initial_backoff
        )
        
        duration = time.time() - t0
        
        if not is_ok or "error" in res:
            err = res.get("error", "Неизвестная ошибка")
            print(f"[{idx:>3}/{len(cards_to_process)}] {pct:5.1f}% | ID: {card.id:<5} | ❌ Ошибка: {err}", flush=True)
            fail_count += 1
            continue

        new_front = res.get("front") or front
        new_back = res.get("back") or ""
        new_context = res.get("context") or ""
        new_level = res.get("level") or getattr(card, 'level', None)

        if new_level:
            level_counts[new_level] = level_counts.get(new_level, 0) + 1

        # Format short log
        short_front = (new_front[:25] + '...') if len(new_front) > 25 else new_front
        short_back = (new_back[:25] + '...') if len(new_back) > 25 else new_back
        lvl_str = f"[{new_level}]" if new_level else "[--]"

        if not args.dry_run:
            # Save card to DB
            card.front_text = new_front
            card.back_text = new_back
            card.context = new_context
            if new_level:
                curr_tags = card.tags or ""
                cleaned = ",".join([t for t in curr_tags.split(",") if t and t.upper() not in {"A1", "A2", "B1", "B2", "C1", "C2"}])
                card.tags = f"{cleaned},{new_level}".strip(",") if cleaned else new_level
            card.updated_at = datetime.datetime.now()
            card.save()

            # Trigger Audio if enabled
            if not args.no_audio:
                try:
                    await services.ensure_card_audio(card, deck.user_id)
                except Exception as e:
                    pass

            completed_ids.add(card.id)
            save_checkpoint(deck.id, completed_ids)

        success_count += 1
        print(f"[{idx:>3}/{len(cards_to_process)}] {pct:5.1f}% | ID: {card.id:<5} | {lvl_str} \"{short_front}\" -> \"{short_back}\" ({duration:.2f}s)", flush=True)

        # Rate-limit delay between cards
        if idx < len(cards_to_process):
            await asyncio.sleep(args.delay)

    total_duration = time.time() - start_total_time
    minutes = int(total_duration // 60)
    seconds = int(total_duration % 60)

    # Clear checkpoint on 100% success
    if fail_count == 0 and not args.dry_run:
        clear_checkpoint(deck.id)

    print("\n" + "=" * 70)
    print("🎉 ПЕРЕГЕНЕРАЦИЯ ЗАВЕРШЕНА!")
    print("=" * 70)
    print(f"  • Успешно обработано: {success_count} / {len(cards_to_process)}")
    print(f"  • С ошибками:         {fail_count}")
    print(f"  • Общее время:        {minutes} мин {seconds} сек")
    if level_counts:
        levels_str = ", ".join([f"{k}: {v}" for k, v in sorted(level_counts.items())])
        print(f"  • Разметка уровней:   {levels_str}")
    print("=" * 70 + "\n")

if __name__ == "__main__":
    asyncio.run(main())

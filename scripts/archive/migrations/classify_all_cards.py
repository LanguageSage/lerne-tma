import os, sys, json, argparse, asyncio, datetime
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
from api import models, ai_service

VALID_LEVELS = {'A1', 'A2', 'B1', 'B2', 'C1', 'C2'}
CHECKPOINT_FILE = os.path.join(project_root, 'api', 'data', 'classification_progress.json')

def extract_existing_level(tags_str: str):
    if not tags_str:
        return None
    for lvl in ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']:
        if lvl in str(tags_str).upper():
            return lvl
    return None

def load_checkpoint():
    if os.path.exists(CHECKPOINT_FILE):
        try:
            with open(CHECKPOINT_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
    return {}

def save_checkpoint(data):
    try:
        os.makedirs(os.path.dirname(CHECKPOINT_FILE), exist_ok=True)
        with open(CHECKPOINT_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f'Предупреждение сохранения чекпоинта: {e}', flush=True)

async def main():
    parser = argparse.ArgumentParser(description='Global Database CEFR Level Classifier')
    parser.add_argument('--overwrite', action='store_true', help='Re-classify cards even if they already have a CEFR level')
    parser.add_argument('--limit', type=int, default=None, help='Limit number of cards to process')
    parser.add_argument('--dry-run', action='store_true', help='Perform AI classification without saving to DB')
    parser.add_argument('--lang', type=str, default='de', help='Target language (default: de)')
    parser.add_argument('--clear-cache', action='store_true', help='Ignore and delete existing checkpoint cache')
    args = parser.parse_args()

    print('=' * 65, flush=True)
    print('🚀 ГЛОБАЛЬНАЯ РАЗМЕТКА УРОВНЕЙ СЛОЖНОСТИ (CEFR) ДЛЯ ВСЕЙ БАЗЫ', flush=True)
    print('=' * 65, flush=True)

    if args.clear_cache and os.path.exists(CHECKPOINT_FILE):
        os.remove(CHECKPOINT_FILE)
        print('  -> Чекпоинт-кэш очищен.', flush=True)

    print('\n[1/4] Подключение к базе данных...', flush=True)
    if not models.tma_db.obj:
        models.initialize_database()
    print('  -> База данных успешно подключена.', flush=True)

    print('\n[2/4] Сканирование карточек в базе данных...', flush=True)
    query = (
        models.TMA_Card
        .select(models.TMA_Card.id, models.TMA_Card.front_text, models.TMA_Card.tags)
        .where(models.TMA_Card.is_deleted == False)
        .order_by(models.TMA_Card.id.asc())
    )
    if args.limit:
        query = query.limit(args.limit)

    all_cards = list(query.dicts())
    total_cards = len(all_cards)
    if total_cards == 0:
        print('  -> В базе данных нет активных карточек для обработки.', flush=True)
        return

    cards_to_process = []
    cards_already_tagged = 0
    for card in all_cards:
        existing_lvl = extract_existing_level(card.get('tags'))
        if existing_lvl and not args.overwrite:
            cards_already_tagged += 1
        else:
            cards_to_process.append(card)

    print(f'  -> Всего карточек в базе: {total_cards}', flush=True)
    print(f'  -> Уже имеют уровень:      {cards_already_tagged}', flush=True)
    print(f'  -> Подлежат разметке:      {len(cards_to_process)} (флаг --overwrite={args.overwrite})', flush=True)

    if not cards_to_process:
        print('\n✅ Все карточки уже размечены! Используйте флаг --overwrite, если хотите переразметить заново.', flush=True)
        return

    # Deduplication: phrase -> list of card IDs
    phrase_to_card_ids = defaultdict(list)
    for card in cards_to_process:
        phrase = (card.get('front_text') or '').strip()
        if phrase:
            phrase_to_card_ids[phrase].append(card['id'])

    unique_phrases = list(phrase_to_card_ids.keys())
    saved_calls = len(cards_to_process) - len(unique_phrases)
    saving_pct = (saved_calls / len(cards_to_process) * 100) if cards_to_process else 0

    print('\n[3/4] Дедупликация и проверка чекпоинтов:', flush=True)
    print(f'  -> Карточек к обработке:  {len(cards_to_process)}', flush=True)
    print(f'  -> Уникальных фраз:       {len(unique_phrases)}', flush=True)
    print(f'  -> Сэкономлено дубликатов: {saved_calls} ({saving_pct:.1f}% экономии токенов и времени!)', flush=True)

    # Load previously cached classifications
    phrase_to_level = load_checkpoint()
    already_cached_count = sum(1 for p in unique_phrases if p in phrase_to_level)
    print(f'  -> Найдено в чекпоинте:   {already_cached_count} уже размеченных фраз', flush=True)

    phrases_to_fetch = [p for p in unique_phrases if p not in phrase_to_level]
    print(f'  -> Осталось запросить у ИИ: {len(phrases_to_fetch)} фраз', flush=True)

    CHUNK_SIZE = 30
    chunks = [phrases_to_fetch[i:i + CHUNK_SIZE] for i in range(0, len(phrases_to_fetch), CHUNK_SIZE)]

    if chunks:
        print(f'\n[4/4] Запуск ИИ-классификатора ({len(chunks)} пачек по {CHUNK_SIZE} фраз)...', flush=True)
        for idx, chunk in enumerate(chunks):
            print(f'  -> Пачка [{idx + 1}/{len(chunks)}] ({len(chunk)} фраз)... ', end='', flush=True)
            try:
                levels = await ai_service.classify_phrases_batch(chunk, target_language=args.lang)
                for phrase, lvl in zip(chunk, levels):
                    valid_lvl = lvl if lvl in VALID_LEVELS else 'A1'
                    phrase_to_level[phrase] = valid_lvl
                print(f'✅ Готово ({len(levels)} уровней)', flush=True)
            except Exception as err:
                print(f'❌ Ошибка ({err}), используем fallback A1', flush=True)
                for phrase in chunk:
                    phrase_to_level[phrase] = 'A1'

            save_checkpoint(phrase_to_level)

            if idx < len(chunks) - 1:
                await asyncio.sleep(1.2)
    else:
        print('\n[4/4] Все фразы уже классифицированы в чекпоинте! Пропускаем вызовы ИИ.', flush=True)

    # Fast Bulk Database Update
    print('\n💾 Применение разметки в базу данных...', flush=True)
    if args.dry_run:
        print('  -> [DRY-RUN] Режим симуляции: изменения НЕ сохранены в БД.', flush=True)
    else:
        level_to_card_ids = defaultdict(list)
        for phrase, card_ids in phrase_to_card_ids.items():
            lvl = phrase_to_level.get(phrase, 'A1')
            level_to_card_ids[lvl].extend(card_ids)

        now = datetime.datetime.now()
        updated_total = 0
        with models.tma_db.atomic():
            for lvl, c_ids in level_to_card_ids.items():
                ID_CHUNK = 500
                for i in range(0, len(c_ids), ID_CHUNK):
                    sub_ids = c_ids[i:i + ID_CHUNK]
                    updated_count = (
                        models.TMA_Card
                        .update(tags=lvl, updated_at=now)
                        .where(models.TMA_Card.id << sub_ids)
                        .execute()
                    )
                    updated_total += updated_count

        print(f'  -> Успешно обновлено карточек в базе: {updated_total}', flush=True)

        # Clean up checkpoint on full success
        if os.path.exists(CHECKPOINT_FILE):
            try:
                os.remove(CHECKPOINT_FILE)
            except Exception:
                pass

    # Summary
    level_counts = Counter()
    for phrase, card_ids in phrase_to_card_ids.items():
        lvl = phrase_to_level.get(phrase, 'A1')
        level_counts[lvl] += len(card_ids)

    print('\n' + '=' * 65, flush=True)
    print('📊 ИТОГОВЫЙ ОТЧЕТ РАЗМЕТКИ', flush=True)
    print('=' * 65, flush=True)
    print(f'Всего карточек обработано: {len(cards_to_process)}', flush=True)
    print('Распределение уровней:', flush=True)
    for lvl in ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']:
        count = level_counts.get(lvl, 0)
        bar = '█' * min(30, int(count / max(1, len(cards_to_process)) * 30))
        print(f'  • {lvl}: {count:5d} карточек {bar}', flush=True)
    print('=' * 65 + '\n', flush=True)

if __name__ == '__main__':
    asyncio.run(main())

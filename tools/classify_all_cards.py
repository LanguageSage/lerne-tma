#!/usr/bin/env python
"""
tools/classify_all_cards.py

Global Database CEFR Level Re-Classifier.
Uses local rule-based classifier first (0 API cost, < 1s for thousands of cards),
and falls back to AI for ambiguous phrases.

Usage:
    python tools/classify_all_cards.py --overwrite --clear-cache
"""

import os, sys, json, argparse, asyncio, datetime
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from api import models, ai_service
from api.services.classifier import classify_sentence_fast

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
        print(f'  ⚠️ Предупреждение сохранения чекпоинта: {e}', flush=True)


async def main():
    parser = argparse.ArgumentParser(description='Global Database CEFR Level Re-Classifier')
    parser.add_argument('--overwrite', action='store_true', help='Re-classify cards even if they already have a CEFR level')
    parser.add_argument('--limit', type=int, default=None, help='Limit number of cards to process')
    parser.add_argument('--dry-run', action='store_true', help='Perform classification without saving to DB')
    parser.add_argument('--lang', type=str, default='de', help='Target language (default: de)')
    parser.add_argument('--clear-cache', action='store_true', help='Ignore and delete existing checkpoint cache')
    args = parser.parse_args()

    print('=' * 70, flush=True)
    print('🚀 ГЛОБАЛЬНАЯ РАЗМЕТКА УРОВНЕЙ СЛОЖНОСТИ (CEFR) ДЛЯ ВСЕЙ БАЗЫ', flush=True)
    print('=' * 70, flush=True)

    if args.clear_cache and os.path.exists(CHECKPOINT_FILE):
        try:
            os.remove(CHECKPOINT_FILE)
            print('  -> Чекпоинт-кэш очищен.', flush=True)
        except Exception:
            pass

    print('\n[1/5] Подключение к базе данных...', flush=True)
    if not models.tma_db.obj:
        models.initialize_database()
    print('  -> База данных успешно подключена.', flush=True)

    print('\n[2/5] Сканирование карточек в базе данных...', flush=True)
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
    print(f'  -> Подлежат разметке:      {len(cards_to_process)} (флаг --overwrite={args.overwrite})', flush=True)

    if not cards_to_process:
        print('\n✅ Все карточки уже размечены! Используйте флаг --overwrite для полной переразметки.', flush=True)
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

    print('\n[3/5] Дедупликация и подготовка:', flush=True)
    print(f'  -> Карточек к обработке:   {len(cards_to_process)}', flush=True)
    print(f'  -> Уникальных фраз:        {len(unique_phrases)}', flush=True)
    print(f'  -> Сэкономлено дубликатов: {saved_calls} ({saving_pct:.1f}% экономии!)', flush=True)

    phrase_to_level = load_checkpoint()

    # Fast Local Rule Classification Pass
    print('\n[4/5] Шаг А: Быстрый локальный классификатор правил (< 1 сек)...', flush=True)
    local_hits = 0
    phrases_for_ai = []

    for phrase in unique_phrases:
        if phrase in phrase_to_level:
            continue

        if args.lang.lower() == 'de':
            res = classify_sentence_fast(phrase, 'de')
            if res.get('confidence', 0.0) >= 0.80:
                phrase_to_level[phrase] = res['level']
                local_hits += 1
                continue

        phrases_for_ai.append(phrase)

    print(f'  -> Размечено ЛОКАЛЬНО (0 API затрат): {local_hits} фраз', flush=True)
    print(f'  -> Отправляется в ИИ (неуверенные):   {len(phrases_for_ai)} фраз', flush=True)

    save_checkpoint(phrase_to_level)

    # AI Fallback Pass for remaining ambiguous phrases
    if phrases_for_ai:
        CHUNK_SIZE = 30
        chunks = [phrases_for_ai[i:i + CHUNK_SIZE] for i in range(0, len(phrases_for_ai), CHUNK_SIZE)]
        print(f'\n[4/5] Шаг Б: ИИ-классификация ({len(chunks)} пачек по {CHUNK_SIZE} фраз)...', flush=True)

        for idx, chunk in enumerate(chunks):
            print(f'  -> ИИ Пачка [{idx + 1}/{len(chunks)}] ({len(chunk)} фраз)... ', end='', flush=True)
            try:
                levels = await ai_service.classify_phrases_batch(chunk, target_language=args.lang)
                for phrase, lvl in zip(chunk, levels):
                    valid_lvl = lvl if lvl in VALID_LEVELS else 'A1'
                    phrase_to_level[phrase] = valid_lvl
                print(f'✅ Готово', flush=True)
            except Exception as err:
                print(f'❌ Ошибка ({err}), fallback A1', flush=True)
                for phrase in chunk:
                    phrase_to_level[phrase] = 'A1'

            save_checkpoint(phrase_to_level)
            if idx < len(chunks) - 1:
                await asyncio.sleep(1.0)
    else:
        print('\n[4/5] 🎉 ВСЕ фразы размечены локально! Вызовы ИИ не потребовались.', flush=True)

    # Database Update Pass
    print('\n[5/5] 💾 Сохранение новых уровней в базу данных...', flush=True)
    if args.dry_run:
        print('  -> [DRY-RUN] Симуляция: изменения НЕ внесены в БД.', flush=True)
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

        if os.path.exists(CHECKPOINT_FILE):
            try:
                os.remove(CHECKPOINT_FILE)
            except Exception:
                pass

    # Final Report
    level_counts = Counter()
    for phrase, card_ids in phrase_to_card_ids.items():
        lvl = phrase_to_level.get(phrase, 'A1')
        level_counts[lvl] += len(card_ids)

    print('\n' + '=' * 70, flush=True)
    print('📊 ИТОГОВЫЙ ОТЧЕТ РАЗМЕТКИ ВСЕЙ БАЗЫ', flush=True)
    print('=' * 70, flush=True)
    print(f'Всего карточек обработано: {len(cards_to_process)}', flush=True)
    print('Распределение уровней:', flush=True)
    for lvl in ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']:
        count = level_counts.get(lvl, 0)
        pct = (count / max(1, len(cards_to_process))) * 100
        bar = '█' * min(30, int(pct / 100 * 30))
        print(f'  • {lvl}: {count:5d} карточек ({pct:5.1f}%) {bar}', flush=True)
    print('=' * 70 + '\n', flush=True)


if __name__ == '__main__':
    asyncio.run(main())

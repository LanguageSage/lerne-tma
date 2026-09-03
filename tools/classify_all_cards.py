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
import re
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from api import models, ai_service
from api.services.cefr_metadata import (
    build_ai_cefr_payload,
    build_cleared_cefr_payload,
    build_local_cefr_payload,
    merge_cefr_metadata,
)
from api.services.classifier import classify_sentence_fast

VALID_LEVELS = {'A1', 'A2', 'B1', 'B2', 'C1', 'C2'}
CEFR_TAG_RE = re.compile(r'\b(A1|A2|B1|B2|C1|C2)\b', re.IGNORECASE)
CHECKPOINT_FILE = os.path.join(project_root, 'api', 'data', 'classification_progress.json')


def extract_existing_level(tags_str: str):
    if not tags_str:
        return None
    match = CEFR_TAG_RE.search(str(tags_str))
    if match:
        return match.group(1).upper()
    return None


def replace_cefr_level(tags_str: str, level: str) -> str:
    tags = str(tags_str or "")
    cleaned = CEFR_TAG_RE.sub("", tags)
    cleaned_parts = [part.strip() for part in cleaned.split(",") if part.strip()]
    return ",".join([*cleaned_parts, level]) if cleaned_parts else level


def remove_cefr_level(tags_str: str) -> str:
    tags = str(tags_str or "")
    cleaned = CEFR_TAG_RE.sub("", tags)
    return ",".join(part.strip() for part in cleaned.split(",") if part.strip())


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
    parser.add_argument('--audit-only', action='store_true', help='Only estimate local/AI workload; no AI calls and no DB writes')
    parser.add_argument(
        '--clear-uncertain-local',
        action='store_true',
        help='Remove CEFR tag when local classifier confidence is below 0.80 instead of sending phrase to AI',
    )
    parser.add_argument('--lang', type=str, default='de', help='Target language to process (default: de)')
    parser.add_argument(
        '--vocab-profile',
        choices=['base', 'medium', 'max'],
        default=os.environ.get('DE_VOCAB_PROFILE', 'base'),
        help='German local vocabulary profile for rule classification',
    )
    parser.add_argument('--clear-cache', action='store_true', help='Ignore and delete existing checkpoint cache')
    args = parser.parse_args()
    os.environ['DE_VOCAB_PROFILE'] = args.vocab_profile

    print('=' * 70, flush=True)
    print('🚀 ГЛОБАЛЬНАЯ РАЗМЕТКА УРОВНЕЙ СЛОЖНОСТИ (CEFR) ДЛЯ ВСЕЙ БАЗЫ', flush=True)
    print('=' * 70, flush=True)
    print(f'  -> Профиль немецкого словаря: {args.vocab_profile}', flush=True)
    if args.clear_uncertain_local:
        print('  -> Неуверенная локальная оценка будет ОЧИЩАТЬ CEFR-тег вместо AI fallback.', flush=True)

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
        .select(models.TMA_Card.id, models.TMA_Card.front_text, models.TMA_Card.tags, models.TMA_Card.metadata)
        .join(models.TMA_Deck)
        .where(models.TMA_Card.is_deleted == False)
        .order_by(models.TMA_Card.id.asc())
    )
    lang = args.lang.lower().strip()
    if lang == 'de':
        query = query.where(
            (models.TMA_Deck.target_language == 'de') |
            (models.TMA_Deck.target_language.is_null())
        )
    else:
        query = query.where(models.TMA_Deck.target_language == lang)

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
    phrase_to_cefr_payload = {}
    phrase_to_local_fallback = {}

    # Fast Local Rule Classification Pass
    print('\n[4/5] Шаг А: Быстрый локальный классификатор правил (< 1 сек)...', flush=True)
    local_hits = 0
    local_clears = 0
    phrases_for_ai = []
    local_level_counts = Counter()
    local_fallback_counts = Counter()
    local_clear_counts = Counter()

    for phrase in unique_phrases:
        if phrase in phrase_to_level:
            continue

        if args.lang.lower() == 'de':
            res = classify_sentence_fast(phrase, 'de')
            phrase_to_local_fallback[phrase] = res.get('level', 'A1')
            if res.get('confidence', 0.0) >= 0.80:
                phrase_to_level[phrase] = res['level']
                phrase_to_cefr_payload[phrase] = build_local_cefr_payload(res, source='local')
                local_level_counts[res['level']] += len(phrase_to_card_ids[phrase])
                local_hits += 1
                continue
            local_fallback_counts[res.get('level', 'A1')] += len(phrase_to_card_ids[phrase])
            if args.clear_uncertain_local:
                phrase_to_level[phrase] = None
                phrase_to_cefr_payload[phrase] = build_cleared_cefr_payload(res)
                local_clear_counts['NO_LEVEL'] += len(phrase_to_card_ids[phrase])
                local_clears += 1
                continue

        phrases_for_ai.append(phrase)

    print(f'  -> Размечено ЛОКАЛЬНО (0 API затрат): {local_hits} фраз', flush=True)
    if args.clear_uncertain_local:
        print(f'  -> CEFR будет очищен локально:          {local_clears} фраз', flush=True)
    print(f'  -> Отправляется в ИИ (неуверенные):   {len(phrases_for_ai)} фраз', flush=True)

    if args.audit_only:
        uncertain_cards = sum(len(phrase_to_card_ids[p]) for p in phrases_for_ai)
        print('\n[АУДИТ] Вызовы ИИ и запись в БД пропущены (--audit-only).', flush=True)
        print(f'  -> Уверенно локально:       {local_hits} уникальных фраз', flush=True)
        print(f'  -> Требуют AI-проверки:     {len(phrases_for_ai)} уникальных фраз / {uncertain_cards} карточек', flush=True)
        if args.clear_uncertain_local:
            print(f'  -> Будет очищен CEFR:       {local_clears} уникальных фраз / {local_clear_counts.get("NO_LEVEL", 0)} карточек', flush=True)
        print('  -> Распределение уверенной локальной разметки:', flush=True)
        for lvl in ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']:
            print(f'     {lvl}: {local_level_counts.get(lvl, 0)} карточек', flush=True)
        print('  -> Локальный fallback для неуверенных фраз:', flush=True)
        for lvl in ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']:
            print(f'     {lvl}: {local_fallback_counts.get(lvl, 0)} карточек', flush=True)
        return

    if not args.dry_run:
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
                    phrase_to_cefr_payload[phrase] = build_ai_cefr_payload(valid_lvl)
                print(f'✅ Готово', flush=True)
            except Exception as err:
                print(f'❌ Ошибка ({err}), используем локальный fallback', flush=True)
                for phrase in chunk:
                    fallback_level = phrase_to_local_fallback.get(phrase, 'A1')
                    phrase_to_level[phrase] = fallback_level
                    phrase_to_cefr_payload[phrase] = build_ai_cefr_payload(fallback_level, source='fallback')

            if not args.dry_run:
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
        card_tags_by_id = {card['id']: card.get('tags') for card in cards_to_process}
        card_metadata_by_id = {card['id']: card.get('metadata') for card in cards_to_process}
        card_update_groups = defaultdict(list)
        for phrase, card_ids in phrase_to_card_ids.items():
            lvl = phrase_to_level.get(phrase, 'A1')
            cefr_payload = phrase_to_cefr_payload.get(phrase)
            if not cefr_payload:
                cefr_payload = build_ai_cefr_payload(lvl, source='checkpoint') if lvl else build_cleared_cefr_payload()
            for card_id in card_ids:
                if lvl:
                    new_tags = replace_cefr_level(card_tags_by_id.get(card_id), lvl)
                else:
                    new_tags = remove_cefr_level(card_tags_by_id.get(card_id))
                new_metadata = merge_cefr_metadata(card_metadata_by_id.get(card_id), cefr_payload)
                card_update_groups[(new_tags, new_metadata)].append(card_id)

        now = datetime.datetime.now()
        updated_total = 0
        with models.tma_db.atomic():
            for (new_tags, new_metadata), c_ids in card_update_groups.items():
                ID_CHUNK = 500
                for i in range(0, len(c_ids), ID_CHUNK):
                    sub_ids = c_ids[i:i + ID_CHUNK]
                    updated_count = (
                        models.TMA_Card
                        .update(tags=new_tags, metadata=new_metadata, updated_at=now)
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
        level_counts[lvl or 'NO_LEVEL'] += len(card_ids)

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
    if args.clear_uncertain_local:
        count = level_counts.get('NO_LEVEL', 0)
        pct = (count / max(1, len(cards_to_process))) * 100
        bar = '█' * min(30, int(pct / 100 * 30))
        print(f'  • NO_LEVEL: {count:5d} карточек ({pct:5.1f}%) {bar}', flush=True)
    print('=' * 70 + '\n', flush=True)


if __name__ == '__main__':
    asyncio.run(main())

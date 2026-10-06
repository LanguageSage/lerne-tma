#!/usr/bin/env python3
"""
Скрипт безопасной миграции карточек уроков Lerne.

Исправляет 3 типичные проблемы:
1. Карточки выбора: перевод standalone {*.../...} в построчный Quiz (*правильный \n неправильный)
   с удалением бессодержательного ::task и переносом конкретного задания в ::exercise.
2. Неоднозначные карточки ввода: добавление подсказки скрываемого слова через официальный
   синтаксис Lerne ::source (маркер ::hint исключён).
3. Ошибочный @wordbank вместо @puzzle: преобразование карточек сборки фраз/предложений из частей
   со слэшами @wordbank ... / ... / ... в @puzzle ... с эталонным порядком слов.

Скрипт идемпотентен: повторный запуск не повреждает уже исправленные карточки.
По умолчанию работает в режиме DRY-RUN (только чтение).
Для применения в БД запустите с флагом --apply.
"""

import os
import sys
import re
import json
import argparse

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from api.database import initialize_database
from api.models import TMA_Folder, TMA_Deck, TMA_Card
from api.services.input_parser import detect_ai_input_type

# ============================================================================
# Словари и правила определения подсказок (Task 2)
# ============================================================================

ADJECTIVE_DICT = {
    'bequem': 'удобный',
    'bitter': 'горький',
    'lang': 'длинный',
    'kurz': 'короткий',
    'schwarz': 'чёрный',
    'weiß': 'белый',
    'weiss': 'белый',
    'blau': 'синий',
    'rot': 'красный',
    'gelb': 'жёлтый',
    'grün': 'зелёный',
    'gruen': 'зелёный',
    'grau': 'серый',
    'braun': 'коричневый',
    'kalt': 'холодный',
    'warm': 'тёплый',
    'heiß': 'горячий',
    'heiss': 'горячий',
    'alt': 'старый',
    'neu': 'новый',
    'groß': 'большой',
    'gross': 'большой',
    'klein': 'маленький',
    'süß': 'сладкий',
    'suess': 'сладкий',
    'sauer': 'кислый',
    'weich': 'мягкий',
    'hart': 'твёрдый',
    'laut': 'громкий',
    'leise': 'тихий',
    'hell': 'светлый, яркий',
    'dunkel': 'тёмный',
    'rund': 'круглый',
    'sauber': 'чистый',
    'schmutzig': 'грязный',
    'frisch': 'свежий',
    'trocken': 'сухой',
    'nass': 'мокрый',
    'einfach': 'простой',
    'schwer': 'тяжёлый',
    'schwierig': 'сложный',
    'voll': 'полный',
    'leer': 'пустой',
    'teuer': 'дорогой',
    'billig': 'дешёвый',
    'günstig': 'выгодный',
    'guenstig': 'выгодный',
    'schnell': 'быстрый',
    'langsam': 'медленный',
    'breit': 'широкий',
    'schmal': 'узкий',
    'tief': 'глубокий',
    'flach': 'мелкий',
    'gemütlich': 'уютный',
    'gemuetlich': 'уютный',
    'ruhig': 'тихий, спокойный',
    'modern': 'современный',
    'praktisch': 'практичный',
    'nützlich': 'полезный',
    'nuetzlich': 'полезный',
    'defekt': 'неисправный',
    'kaputt': 'сломанный',
    'stark': 'сильный',
    'schwach': 'слабый',
    'schön': 'красивый',
    'schoen': 'красивый',
    'interessant': 'интересный',
    'langweilig': 'скучный',
    'freundlich': 'дружелюбный',
    'geduldig': 'терпеливый',
    'spannend': 'захватывающий',
    'offen': 'открытый',
    'geschlossen': 'закрытый',
    'müde': 'уставший',
    'muede': 'уставший',
    'krank': 'больной',
    'gesund': 'здоровый',
    'hungrig': 'голодный',
    'durstig': 'испытывающий жажду',
    'fleißig': 'прилежный',
    'fleissig': 'прилежный',
    'faul': 'ленивый',
    'zentral': 'центральный',
    'angenehm': 'приятный',
    'wichtig': 'важный',
    'hilfsbereit': 'отзывчивый',
    'geräumig': 'просторный',
    'geraumig': 'просторный',
    'schlecht': 'плохой',
    'reif': 'спелый',
    'ernst': 'серьёзный',
}

# ============================================================================
# Задача №1: Исправление карточек выбора
# ============================================================================

def is_phrase(options):
    articles = {'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines', 'mein', 'dein', 'sein', 'ihr'}
    verbs = {'ist', 'sind', 'hat', 'haben', 'wird', 'werden', 'war', 'waren', 'bleibt', 'bleiben'}
    phrase_count = 0
    for opt in options:
        clean = opt.replace('*', '').strip()
        words = clean.split()
        if not words:
            continue
        first_word = words[0].lower()
        has_verb = any(w.lower() in verbs for w in words)
        if first_word in articles and not has_verb:
            phrase_count += 1
    return phrase_count >= max(1, len(options) - 1)

def is_sentence(options):
    verbs = {'ist', 'sind', 'hat', 'haben', 'wird', 'werden', 'war', 'waren', 'bleibt', 'bleiben'}
    for opt in options:
        clean = opt.replace('*', '').strip()
        words = clean.split()
        if any(w.lower() in verbs for w in words):
            return True
    return False

def transform_choice_card(front_text):
    if '{' not in front_text or '}' not in front_text:
        return None, None, "No curly braces"
        
    ex_match = re.search(r'(::exercise[ \t]*\r?\n)(.*)', front_text, re.DOTALL)
    if not ex_match:
        return None, None, "No ::exercise block"
        
    ex_body = ex_match.group(2).strip()
    
    # Standalone choice: either exact {*...} or the only non-empty line
    choice_m = re.fullmatch(r'\{([^{}]+)\}', ex_body)
    if not choice_m:
        lines = [l.strip() for l in ex_body.split('\n') if l.strip()]
        if len(lines) == 1 and lines[0].startswith('{') and lines[0].endswith('}'):
            choice_m = re.fullmatch(r'\{([^{}]+)\}', lines[0])
            
    if not choice_m:
        return None, None, "Not a standalone choice block in ::exercise"
        
    inner = choice_m.group(1).strip()
    if '/' not in inner and '|' not in inner:
        return None, None, "No / or | separator in choice"
        
    options = [o.strip() for o in re.split(r'[/|]', inner) if o.strip()]
    if len(options) < 2:
        return None, None, "Less than 2 options"
        
    star_opts = [o for o in options if '*' in o]
    if len(star_opts) != 1:
        return None, 'choice_manual_review', f"Expected exactly 1 starred option, found {len(star_opts)}"
        
    formatted_options = []
    for opt in options:
        if '*' in opt:
            clean = opt.replace('*', '').strip()
            formatted_options.append(f"*{clean}")
        else:
            clean = opt.strip()
            formatted_options.append(clean)
            
    options_text = '\n'.join(formatted_options)
    
    task_m = re.search(r'::task[ \t]*\r?\n(.*?)(?=\r?\n::|\Z)', front_text, re.DOTALL)
    task_text = task_m.group(1).strip() if task_m else ""
    
    generic_prompts = [
        'что правильно?', 'выбери правильный вариант', 'какая форма правильная?',
        'выбери правильную форму.', 'выбери форму.', 'как правильно?',
        'выбери правильную фразу.', 'какая фраза правильная?', 'выбери словосочетание.',
        'выбери правильное словосочетание.', 'найди правильный вариант.',
        'выбери правильный вариант.', 'что правильно', 'как правильно', 'выбери форму'
    ]
    is_generic = any(task_text.lower().strip('.?') == gp.strip('.?') for gp in generic_prompts)
    
    if is_phrase(options):
        target_prompt = "Выбери правильное словосочетание."
    elif is_sentence(options) and is_generic:
        target_prompt = "Выбери правильное предложение."
    elif task_text and not is_generic:
        target_prompt = task_text
    elif is_sentence(options):
        target_prompt = "Выбери правильное предложение."
    else:
        target_prompt = "Выбери правильное словосочетание."
        
    new_text = re.sub(r'::task[ \t]*\r?\n.*?(?=\r?\n::)', '', front_text, flags=re.DOTALL).strip()
    new_exercise = f"::exercise\n{target_prompt}\n\n{options_text}"
    new_text = re.sub(r'::exercise[ \t]*\r?\n.*', new_exercise, new_text, flags=re.DOTALL).strip()
    
    return new_text, 'choice_fixed', "OK"

# ============================================================================
# Задача №2: Исправление неоднозначных карточек ввода
# ============================================================================

def extract_adjective_stem(word):
    w = word.strip().lower()
    for ending in ['en', 'em', 'er', 'es', 'e']:
        if w.endswith(ending):
            stem = w[:-len(ending)]
            if stem in ADJECTIVE_DICT:
                return stem
    if w in ADJECTIVE_DICT:
        return w
    return None

def find_hint_from_back(word, back_text):
    if not back_text:
        return None
    stem = extract_adjective_stem(word) or word.lower()
    for search_term in [word, stem]:
        p = rf'\b{re.escape(search_term)}\s*[—–-]\s*([а-яА-ЯёЁ\s,]+?)(?=[.\n\r]|\Z)'
        m = re.search(p, back_text, re.IGNORECASE)
        if m:
            hint = m.group(1).strip().strip('.')
            if hint:
                return hint
    return None

def find_hint_from_task(task_text):
    if not task_text:
        return None, task_text
    m = re.search(r'\(\s*([а-яА-ЯёЁ\s,.]+?)\s*\)', task_text)
    if m:
        hint = m.group(1).strip().strip('.')
        cleaned_task = re.sub(r'\(\s*[а-яА-ЯёЁ\s,.]+?\s*\)', '', task_text).strip()
        cleaned_task = re.sub(r'\s+', ' ', cleaned_task).strip()
        return hint, cleaned_task
    m2 = re.search(r'([а-яА-ЯёЁ]{3,})\s*$', task_text)
    if m2 and not any(kw in m2.group(1).lower() for kw in ['форму', 'слово', 'пропуск', 'позиции']):
        hint = m2.group(1).strip()
        cleaned_task = task_text[:m2.start()].strip()
        return hint, cleaned_task
    return None, task_text

def is_target_ambiguous_input(front_text):
    ex_match = re.search(r'::exercise\s*\n(.*)', front_text, re.DOTALL)
    ex_body = ex_match.group(1).strip() if ex_match else front_text
    
    # 1. Article + [[gap]]
    article_re = re.search(r'\b(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\s+\[\[([^\]]+)\]\]', ex_body, re.IGNORECASE)
    if article_re:
        return True, article_re.group(2)
        
    # 2. Copula + [[gap]] (z.B. Der Sessel ist [[bequem]].)
    copula_re = re.search(r'\b(ist|sind|bleibt|wird|war|waren)\s+\[\[([^\]]+)\]\]', ex_body, re.IGNORECASE)
    if copula_re:
        return True, copula_re.group(2)
        
    # 3. Two-position adjective fill-in (Die Aufgabe ist [[einfach]]. ... [[einfache]] ...)
    gaps = re.findall(r'\[\[([^\]]+)\]\]', ex_body)
    if len(gaps) >= 1 and not all(g.strip().lower() in ['e', 'en', 'em', 'er', 'es'] for g in gaps):
        # Exclude cards where the word is already explicitly written in the sentence above
        lines = [l.strip() for l in ex_body.split('\n') if l.strip()]
        if len(lines) >= 2 and lines[-1].startswith('[[') and lines[-1].endswith(']]'):
            return False, None
        return True, gaps[0]
        
    return False, None

def transform_input_card(front_text, back_text):
    if '[[' not in front_text or ']]' not in front_text:
        return None, None, "Not an input card"
        
    if '::source' in front_text:
        return None, None, "Already has ::source"
        
    gaps = re.findall(r'\[\[([^\]]+)\]\]', front_text)
    if not gaps:
        return None, None, "No gaps found"
        
    # Skip cards where only the grammatical affix/suffix is hidden (stem is known)
    if all(g.strip().lower() in ['e', 'en', 'em', 'er', 'es'] for g in gaps):
        return None, None, "Only suffix/ending is hidden, stem is known"
        
    is_ambiguous, target_gap = is_target_ambiguous_input(front_text)
    if not is_ambiguous:
        return None, None, "Not an ambiguous input structure"
        
    target_gap = target_gap or gaps[0]
    stem = extract_adjective_stem(target_gap) or target_gap.strip().lower()
    
    task_m = re.search(r'::task[ \t]*\r?\n(.*?)(?=\r?\n::|\Z)', front_text, re.DOTALL)
    task_text = task_m.group(1).strip() if task_m else ""
    hint_from_task, cleaned_task = find_hint_from_task(task_text)
    
    # Priority: dictionary base form -> task hint -> back_text
    hint = None
    if stem in ADJECTIVE_DICT:
        hint = ADJECTIVE_DICT[stem]
    elif hint_from_task:
        hint = hint_from_task
    else:
        hint = find_hint_from_back(target_gap, back_text)
        
    if not hint:
        return None, 'input_manual_review', f"Cannot reliably determine Russian translation for [[{target_gap}]]"
        
    new_task = cleaned_task
    if '::task' in front_text and '::exercise' in front_text:
        res = re.sub(
            r'::task[ \t]*\r?\n.*?\r?\n[ \t]*::exercise',
            f"::task\n{new_task}\n\n::source\n{hint}\n\n::exercise",
            front_text,
            flags=re.DOTALL
        )
    elif '::exercise' in front_text:
        res = re.sub(r'::exercise', f"::source\n{hint}\n\n::exercise", front_text, count=1)
    else:
        res = f"::source\n{hint}\n\n::exercise\n{front_text}"
        
    return res, 'input_fixed', "OK"

# ============================================================================
# Задача №3: @wordbank ошибочно используется вместо @puzzle
# ============================================================================

def transform_wordbank_to_puzzle(front_text, back_text):
    if '@wordbank' not in front_text:
        return None, None, "Not a wordbank card"
    if '@options' in front_text or '<<' in front_text:
        return None, None, "True wordbank card with @options/gaps"
    if '/' not in front_text:
        return None, None, "No slashes found"

    m = re.search(r'(@wordbank[ \t]*\r?\n)([^\n]+)', front_text)
    if not m:
        return None, 'wordbank_manual_review', "Cannot find content line after @wordbank"
    
    header = m.group(1)
    slashed_line = m.group(2).strip()
    
    raw_tokens = [w.strip() for w in slashed_line.split('/') if w.strip()]
    raw_unslashed = ' '.join(raw_tokens)
    
    first_back_line = (back_text or '').strip().split('\n')[0].strip()
    
    def norm_tokens(s):
        return sorted([w.lower().strip('.,!?') for w in s.split() if w.strip()])
        
    canonical = raw_unslashed
    if norm_tokens(first_back_line) == norm_tokens(raw_unslashed):
        canonical = first_back_line
    
    new_front = front_text.replace(header + slashed_line, f"@puzzle\n{canonical}")
    return new_front, 'wordbank_fixed', "OK"

# ============================================================================
# Обработка одной карточки
# ============================================================================

def process_card(card):
    ft = card.front_text or ''
    bk = card.back_text or ''
    
    # Task 3 check: @wordbank with slashes
    if '@wordbank' in ft and '/' in ft and '@options' not in ft:
        new_ft, cat, reason = transform_wordbank_to_puzzle(ft, bk)
        if new_ft:
            new_type = detect_ai_input_type(new_ft)
            return new_ft, new_type, 'wordbank_fixed', reason
        elif cat == 'wordbank_manual_review':
            return None, None, 'needs_manual_review', reason

    # Task 1 check: standalone choice
    if '{' in ft and ('/' in ft or '|' in ft) and ('::exercise' in ft):
        new_ft, cat, reason = transform_choice_card(ft)
        if new_ft:
            new_type = detect_ai_input_type(new_ft)
            return new_ft, new_type, 'choice_fixed', reason
        elif cat == 'choice_manual_review':
            return None, None, 'needs_manual_review', reason

    # Task 2 check: ambiguous input
    if '[[' in ft:
        new_ft, cat, reason = transform_input_card(ft, bk)
        if new_ft:
            new_type = detect_ai_input_type(new_ft)
            return new_ft, new_type, 'input_fixed', reason
        elif cat == 'input_manual_review':
            return None, None, 'needs_manual_review', reason

    return None, None, 'unchanged', "No transformation applicable"

# ============================================================================
# Утилиты выборки колод и папок
# ============================================================================

def get_subfolder_ids(parent_id):
    res = [parent_id]
    for sf in TMA_Folder.select().where((TMA_Folder.parent == parent_id) & (TMA_Folder.is_deleted == False)):
        res.extend(get_subfolder_ids(sf.id))
    return res

# ============================================================================
# Основной CLI-раннер
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="Миграция карточек уроков Lerne (Choice, Input hints, Puzzle)")
    parser.add_argument("--folder-id", type=int, default=283, help="ID корневой папки уроков (по умолчанию 283: 'Lerne - уроки A1 A2 B1')")
    parser.add_argument("--deck-id", type=int, default=None, help="Ограничить миграцию одной конкретной колодой")
    parser.add_argument("--all-cards", action="store_true", help="Сканировать всю базу данных без фильтра по папке")
    parser.add_argument("--apply", action="store_true", help="Применить изменения в базе данных (без флага работает в режиме DRY-RUN)")
    parser.add_argument("--report", type=str, default="scripts/manual_review_report.json", help="Путь для сохранения отчёта needs_manual_review")
    args = parser.parse_args()
    
    if not initialize_database():
        print("FATAL: Не удалось подключиться к базе данных.")
        sys.exit(1)
        
    # Определение скоупа карточек
    if args.all_cards:
        cards_query = TMA_Card.select().where(TMA_Card.is_deleted == False)
        scope_desc = "Вся база данных (все активные карточки)"
    elif args.deck_id:
        cards_query = TMA_Card.select().where((TMA_Card.deck_id == args.deck_id) & (TMA_Card.is_deleted == False))
        deck = TMA_Deck.get_or_none(TMA_Deck.id == args.deck_id)
        dname = deck.name if deck else f"Deck {args.deck_id}"
        scope_desc = f"Колода ID {args.deck_id} ({dname})"
    else:
        folder_ids = get_subfolder_ids(args.folder_id)
        decks = list(TMA_Deck.select().where(TMA_Deck.folder_id.in_(folder_ids) & (TMA_Deck.is_deleted == False)))
        deck_ids = [d.id for d in decks]
        root_folder = TMA_Folder.get_or_none(TMA_Folder.id == args.folder_id)
        rf_name = root_folder.name if root_folder else "Unknown"
        cards_query = TMA_Card.select().where(TMA_Card.deck_id.in_(deck_ids) & (TMA_Card.is_deleted == False))
        scope_desc = f"Папка ID {args.folder_id} ('{rf_name}'), колод: {len(deck_ids)}"
        
    cards = list(cards_query.order_by(TMA_Card.deck_id, TMA_Card.position, TMA_Card.id))
    
    # Кэш названий колод
    deck_cache = {}
    for d in TMA_Deck.select():
        deck_cache[d.id] = d.name
        
    stats = {
        'total_scanned': len(cards),
        'choice_cards_fixed': 0,
        'input_hints_added': 0,
        'wordbank_to_puzzle_fixed': 0,
        'needs_manual_review': 0,
        'unchanged': 0,
    }
    
    examples = {
        'choice_fixed': [],
        'input_fixed': [],
        'wordbank_fixed': [],
    }
    
    manual_review_items = []
    to_update = []
    
    for c in cards:
        new_ft, new_type, category, reason = process_card(c)
        dname = deck_cache.get(c.deck_id, f"Deck {c.deck_id}")
        
        if category == 'choice_fixed':
            stats['choice_cards_fixed'] += 1
            if len(examples['choice_fixed']) < 6:
                examples['choice_fixed'].append((c.id, dname, c.front_text, new_ft))
            to_update.append((c, new_ft, new_type))
        elif category == 'input_fixed':
            stats['input_hints_added'] += 1
            if len(examples['input_fixed']) < 6:
                examples['input_fixed'].append((c.id, dname, c.front_text, new_ft))
            to_update.append((c, new_ft, new_type))
        elif category == 'wordbank_fixed':
            stats['wordbank_to_puzzle_fixed'] += 1
            if len(examples['wordbank_fixed']) < 6:
                examples['wordbank_fixed'].append((c.id, dname, c.front_text, new_ft))
            to_update.append((c, new_ft, new_type))
        elif category == 'needs_manual_review':
            stats['needs_manual_review'] += 1
            manual_review_items.append({
                'card_id': c.id,
                'deck_id': c.deck_id,
                'deck_name': dname,
                'reason': reason,
                'front_text': c.front_text,
                'back_text': c.back_text
            })
        else:
            stats['unchanged'] += 1

    total_will_change = stats['choice_cards_fixed'] + stats['input_hints_added'] + stats['wordbank_to_puzzle_fixed']

    print("=" * 70)
    print("LERNE MIGRATION SCRIPT: КАРТОЧКИ УРОКОВ (CHOICE, INPUT HINTS, PUZZLE)")
    print("=" * 70)
    print(f"Скоуп проверки: {scope_desc}")
    print(f"Режим запуска:  {'[APPLY] Применение изменений в БД' if args.apply else '[DRY-RUN] Тестовый прогон (БД не изменена)'}")
    print(f"Всего просканировано карточек: {stats['total_scanned']}")
    print("-" * 70)
    print("НАЙДЕНО И БУДЕТ ИЗМЕНЕНО:")
    print(f"  • Задача №1 (Choice -> Quiz):         {stats['choice_cards_fixed']}")
    print(f"  • Задача №2 (Input hints added):      {stats['input_hints_added']}")
    print(f"  • Задача №3 (Wordbank -> Puzzle):     {stats['wordbank_to_puzzle_fixed']}")
    print(f"  ИТОГО будет автоматически изменено:   {total_will_change}")
    print(f"  Отправлено в needs_manual_review:     {stats['needs_manual_review']}")
    print(f"  Без изменений (unchanged):            {stats['unchanged']}")
    print("=" * 70)
    
    # Примеры До -> После
    for cat_key, cat_title in [
        ('choice_fixed', 'ПРИМЕРЫ: Задача №1 (Choice -> Quiz)'),
        ('input_fixed', 'ПРИМЕРЫ: Задача №2 (Input Hints added)'),
        ('wordbank_fixed', 'ПРИМЕРЫ: Задача №3 (Wordbank -> Puzzle)'),
    ]:
        ex_list = examples[cat_key]
        if ex_list:
            print(f"\n{cat_title} ({len(ex_list)} шт.):")
            print("-" * 60)
            for cid, dname, before, after in ex_list:
                print(f"Карточка ID {cid} [{dname}]:")
                print("--- БЫЛО: ---")
                print(before)
                print("--- СТАЛО: ---")
                print(after)
                print("." * 60)

    # Сохранение отчёта manual_review
    os.makedirs(os.path.dirname(os.path.abspath(args.report)), exist_ok=True)
    with open(args.report, 'w', encoding='utf-8') as f:
        json.dump(manual_review_items, f, ensure_ascii=False, indent=2)
    print(f"\nОтчёт needs_manual_review ({len(manual_review_items)} карточек) сохранён в: {args.report}")

    if not args.apply:
        print("\n" + "=" * 70)
        print("ВНИМАНИЕ: Это был DRY-RUN. В базе данных ничего не изменено.")
        print("Чтобы применить эти изменения, запустите:")
        print(f"python scripts/migrate_lesson_cards.py --apply")
        print("=" * 70)
    else:
        print("\n" + "=" * 70)
        print("ПРИМЕНЕНИЕ ИЗМЕНЕНИЙ В БАЗЕ ДАННЫХ SUPABASE / POSTGRES...")
        applied_count = 0
        for c, new_ft, new_type in to_update:
            c.front_text = new_ft
            c.card_type = new_type
            c.save()
            applied_count += 1
        print(f"Успешно обновлено карточек в БД: {applied_count}")
        print("=" * 70)
        print("\nИТОГОВЫЙ ОТЧЕТ:")
        print(f"choice_cards_fixed: {stats['choice_cards_fixed']}")
        print(f"input_hints_added: {stats['input_hints_added']}")
        print(f"wordbank_to_puzzle_fixed: {stats['wordbank_to_puzzle_fixed']}")
        print(f"needs_manual_review: {stats['needs_manual_review']}")
        print(f"unchanged: {stats['unchanged']}")

if __name__ == '__main__':
    main()

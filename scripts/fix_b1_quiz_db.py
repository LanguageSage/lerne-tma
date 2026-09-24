import os
import sys
import re
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from api.database import initialize_database
from api.models import TMA_Folder, TMA_Deck, TMA_Card
from api.services.input_parser import detect_ai_input_type

TASK_EXERCISE_PATTERN = re.compile(
    r'::task[ \t]*\r?\n(.*?)\r?\n[ \t]*::exercise[ \t]*\r?\n(.*)', 
    re.DOTALL | re.IGNORECASE
)

BLOCK_PATTERN = re.compile(
    r'(^::exercise[ \t]*\r?\n)(.*?(?=^::|^BACK|^CONTEXT|^---|\Z))', 
    re.MULTILINE | re.DOTALL
)

def get_subfolder_ids(parent_id):
    res = [parent_id]
    for sf in TMA_Folder.select().where((TMA_Folder.parent == parent_id) & (TMA_Folder.is_deleted == False)):
        res.extend(get_subfolder_ids(sf.id))
    return res

def convert_card_text(text):
    skip_markers = ['[[', ']]', '@puzzle', '@wordbank', '@match', '@free']
    pattern = r'\{([^{}\n]+)\}'
    
    def replacer(match):
        prefix = match.group(1)
        block_text = match.group(2)
        
        if any(sm in block_text for sm in skip_markers):
            return match.group(0)
            
        lines = block_text.split('\n')
        
        groups = 0
        for l in lines:
            for m in re.finditer(pattern, l):
                inner = m.group(1)
                if '/' in inner or '|' in inner:
                    groups += 1
                    
        if groups != 1:
            return match.group(0)
            
        new_lines = []
        converted = False
        
        for line in lines:
            matches = list(re.finditer(pattern, line))
            choice_match = None
            for m in matches:
                inner = m.group(1)
                if '/' in inner or '|' in inner:
                    choice_match = m
                    break
                    
            if choice_match:
                inner = choice_match.group(1)
                options = re.split(r'[/|]', inner)
                
                if len([o for o in options if '*' in o]) != 1:
                    return match.group(0)
                    
                before = line[:choice_match.start()]
                after = line[choice_match.end():]
                
                for opt in options:
                    is_correct = '*' in opt
                    clean_opt = opt.replace('*', '')
                    full_line = before + clean_opt + after
                    if is_correct:
                        full_line = '*' + full_line.lstrip()
                    new_lines.append(full_line)
                converted = True
            else:
                new_lines.append(line)
                
        if converted:
            return prefix + '\n'.join(new_lines)
            
        return match.group(0)

    # 1. Конвертируем варианты {.../...} в Quiz полными строками
    res = BLOCK_PATTERN.sub(replacer, text)

    # 2. Если есть ::task перед ::exercise, объединяем их в единый ::exercise
    task_match = TASK_EXERCISE_PATTERN.search(res)
    if task_match:
        task_text = task_match.group(1).strip()
        exercise_text = task_match.group(2).strip()
        res = f"::exercise\n{task_text}\n\n{exercise_text}"

    return res

def main():
    parser = argparse.ArgumentParser(description="Обновление карточек B1 в БД (конвертация в Quiz + перенос ::task в ::exercise)")
    parser.add_argument("--folder-id", type=int, default=283, help="ID корневой папки 'B1 · уроки' в БД (по умолчанию 283)")
    parser.add_argument("--apply", action="store_true", help="Применить изменения в базе данных")
    args = parser.parse_args()
    
    if not initialize_database():
        print("FATAL: Не удалось подключиться к БД.")
        sys.exit(1)
        
    folder_ids = get_subfolder_ids(args.folder_id)
    folders = list(TMA_Folder.select().where(TMA_Folder.id.in_(folder_ids) & (TMA_Folder.is_deleted == False)))
    folder_names = {f.id: f.name for f in folders}
    
    decks = list(TMA_Deck.select().where(TMA_Deck.folder_id.in_(folder_ids) & (TMA_Deck.is_deleted == False)))
    deck_ids = [d.id for d in decks]
    deck_names = {d.id: d.name for d in decks}
    
    cards = list(TMA_Card.select().where(TMA_Card.deck_id.in_(deck_ids) & (TMA_Card.is_deleted == False)))
    
    stats = {
        'found': 0,
        'converted': 0,
        'deck_counts': {}
    }
    
    to_update = []
    
    for c in cards:
        text = c.front_text or ''
        new_text = convert_card_text(text)
        if new_text != text:
            stats['found'] += 1
            stats['converted'] += 1
            dname = deck_names.get(c.deck_id, f"Deck {c.deck_id}")
            stats['deck_counts'][dname] = stats['deck_counts'].get(dname, 0) + 1
            
            new_type = detect_ai_input_type(new_text)
            to_update.append((c, new_text, new_type))
            
    print("=" * 60)
    print("ОТЧЕТ ПО КАРТОЧКАМ В БАЗЕ ДАННЫХ (ОБНОВЛЕНИЕ ФОРМАТА ::exercise):")
    print(f"Корневая папка ID: {args.folder_id} ({folder_names.get(args.folder_id, 'Не найдена')})")
    print(f"Всего подпапок в иерархии: {len(folder_ids)}")
    print(f"Всего колод в папке: {len(decks)}")
    print(f"Всего карточек просканировано: {len(cards)}")
    print(f"Карточек для обновления формата: {stats['found']}")
    print("-" * 60)
    print("Распределение карточек по колодам:")
    for dname, count in stats['deck_counts'].items():
        print(f"  • {dname}: {count} карточек")
    print("=" * 60)
    
    if not args.apply:
        print("\n[DRY-RUN] Изменения НЕ применены в БД.")
        print("Запустите с флагом --apply для применения:")
        print("python scripts/fix_b1_quiz_db.py --apply")
    else:
        print("\nПрименение обновлений формата в базе данных Supabase / Postgres...")
        updated_count = 0
        quiz_verified_count = 0
        
        for c, new_text, new_type in to_update:
            c.front_text = new_text
            c.card_type = new_type
            c.save()
            updated_count += 1
            
            parsed_type = detect_ai_input_type(c.front_text)
            if parsed_type == 'quiz':
                quiz_verified_count += 1
                
        print(f"Успешно обновлено карточек в БД: {updated_count}")
        print(f"Проверено парсером input_parser (классифицировано как 'quiz'): {quiz_verified_count} из {updated_count}")

if __name__ == "__main__":
    main()

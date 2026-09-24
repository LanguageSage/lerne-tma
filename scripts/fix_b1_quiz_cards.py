import os
import sys
import re
import argparse

# Регулярное выражение для конвертации ::task + ::exercise в единый ::exercise с заглавным текстом задания
TASK_EXERCISE_PATTERN = re.compile(
    r'::task[ \t]*\r?\n(.*?)\r?\n[ \t]*::exercise[ \t]*\r?\n(.*)', 
    re.DOTALL | re.IGNORECASE
)

# Регулярное выражение для поиска и преобразования блоков ::exercise
BLOCK_PATTERN = re.compile(
    r'(^::exercise[ \t]*\r?\n)(.*?(?=^::|^BACK|^CONTEXT|^---|\Z))', 
    re.MULTILINE | re.DOTALL
)

def process_content(content, stats, file_path):
    def replacer(match):
        prefix = match.group(1)
        block_text = match.group(2)
        
        # Правило 7: Не изменять карточки со специализированными типами
        skip_markers = ['[[', ']]', '@puzzle', '@wordbank', '@match', '@free']
        if any(sm in block_text for sm in skip_markers):
            return match.group(0)
            
        pattern = r'\{([^{}\n]+)\}'
        lines = block_text.split('\n')
        
        total_choice_groups = 0
        for line in lines:
            for m in re.finditer(pattern, line):
                inner_content = m.group(1)
                if '/' in inner_content or '|' in inner_content:
                    total_choice_groups += 1
                    
        if total_choice_groups == 0:
            return match.group(0)
            
        stats['found'] += 1
        
        if total_choice_groups > 1:
            stats['manual'] += 1
            stats['manual_files'].append(file_path)
            return match.group(0)

        new_lines = []
        converted = False
        
        for line in lines:
            matches = list(re.finditer(pattern, line))
            choice_match = None
            for m in matches:
                inner_content = m.group(1)
                if '/' in inner_content or '|' in inner_content:
                    choice_match = m
                    break
                    
            if choice_match:
                inner_content = choice_match.group(1)
                options = re.split(r'[/|]', inner_content)
                
                asterisk_options = [opt for opt in options if '*' in opt]
                if len(asterisk_options) != 1:
                    stats['manual'] += 1
                    stats['manual_files'].append(file_path)
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
            stats['converted'] += 1
            return prefix + '\n'.join(new_lines)
            
        return match.group(0)

    # 1. Сначала конвертируем блоки выбора {.../...} в полные строки Quiz
    new_content, count = BLOCK_PATTERN.subn(replacer, content)

    # 2. Если есть ::task перед ::exercise, переношу текст из ::task внутрь ::exercise
    task_match = TASK_EXERCISE_PATTERN.search(new_content)
    if task_match:
        task_text = task_match.group(1).strip()
        exercise_text = task_match.group(2).strip()
        new_content = f"::exercise\n{task_text}\n\n{exercise_text}"

    return new_content

def main():
    parser = argparse.ArgumentParser(description="Исправление карточек новых уроков (Quiz вместо Trainer Choice с переносом ::task в ::exercise)")
    parser.add_argument("directory", nargs="?", default=".", help="Путь к директории 'B1 · уроки' (по умолчанию текущая)")
    parser.add_argument("--apply", action="store_true", help="Применить изменения (без флага работает в режиме dry-run)")
    args = parser.parse_args()
    
    target_dir = args.directory
    
    if not os.path.exists(target_dir):
        print(f"Ошибка: Директория '{target_dir}' не найдена.")
        sys.exit(1)
        
    stats = {
        'found': 0,
        'converted': 0,
        'manual': 0,
        'files_scanned': 0,
        'files_changed': 0,
        'manual_files': []
    }
    
    print(f"Сканирование директории: {target_dir}")
    print(f"Режим: {'ПРИМЕНЕНИЕ ИЗМЕНЕНИЙ' if args.apply else 'DRY-RUN (только чтение)'}\n")
    
    for root, _, files in os.walk(target_dir):
        for file in files:
            if not file.endswith(('.md', '.txt')):
                continue
                
            file_path = os.path.join(root, file)
            stats['files_scanned'] += 1
            
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
            except Exception as e:
                print(f"Ошибка чтения файла {file_path}: {e}")
                continue
                
            new_content = process_content(content, stats, file_path)
            
            if new_content != content:
                stats['files_changed'] += 1
                if args.apply:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(new_content)

    print("-" * 40)
    print("ОТЧЕТ О СКАНИРОВАНИИ:")
    print(f"Проверено файлов: {stats['files_scanned']}")
    print(f"Всего найдено целевых карточек ::exercise: {stats['found']}")
    print(f"Безопасно конвертируемых: {stats['converted']}")
    print(f"Требующих ручной проверки: {stats['manual']}")
    
    if stats['manual'] > 0:
        print("\nФайлы с карточками для ручной проверки:")
        for f in set(stats['manual_files']):
            print(f" - {f}")
            
    if not args.apply:
        print("\nЭто был тестовый запуск (dry-run).")
        print("Чтобы применить изменения, запустите скрипт с флагом --apply:")
        print(f"python {os.path.basename(__file__)} \"{target_dir}\" --apply")
    else:
        print(f"\nИзменения успешно применены к {stats['files_changed']} файлам.")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Lerne Author CLI — консольный инструмент для автора уроков и работы с AI-агентами.

Команды:
  export   — экспорт колоды или папки в канонический текстовый формат Lerne.
  update   — безопасное двухфазное обновление карточек из отредактированного файла
             через бэкенд-сервис (preview -> apply без мутации SRS).
  publish  — публикация новых уроков из файла (поддерживает мультиколодные файлы),
             выбор существующей папки или создание новой, создание колод и карточек.

Использование:
  python scripts/lerne_author_cli.py export --deck-id 7038 [--out exports/deck_7038.txt]
  python scripts/lerne_author_cli.py export --folder-id 297 [--out exports/folder_297.txt]
  python scripts/lerne_author_cli.py update exports/deck_7038.txt [--dry-run | --apply]
  python scripts/lerne_author_cli.py publish lesson.txt [--folder-id 297 | --new-folder "Название"] [--apply]
"""

import os
import sys
import argparse
from typing import Optional

sys.stdout.reconfigure(encoding='utf-8')
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from dotenv import load_dotenv
load_dotenv()

from api.database import initialize_database
from api.models import TMA_Folder
from api.services.author_service import (
    CARD_SEPARATOR,
    get_effective_user_id,
    serialize_card,
    serialize_deck,
    serialize_folder,
    parse_cards_text,
    export_deck_content,
    export_folder_content,
    preview_update_content,
    apply_update_content,
    preview_publish_content,
    apply_publish_content,
)


# ============================================================================
# Команда: EXPORT
# ============================================================================

def handle_export(args) -> int:
    """Выгружает колоду или папку в текстовый файл."""
    initialize_database()

    try:
        if args.deck_id:
            res = export_deck_content(args.deck_id, user_id=args.user_id)
            out_filename = args.out or f"exports/deck_{res['deck_id']}.txt"
            os.makedirs(os.path.dirname(os.path.abspath(out_filename)), exist_ok=True)
            with open(out_filename, 'w', encoding='utf-8') as f:
                f.write(res['text'])
            print(f"✅ Экспортирована колода: '{res['deck_name']}' (ID: {res['deck_id']})")
            print(f"   Карточек: {res['cards_count']}")
            print(f"   Файл: {out_filename}")
            return 0

        elif args.folder_id:
            res = export_folder_content(args.folder_id, user_id=args.user_id)
            out_filename = args.out or f"exports/folder_{res['folder_id']}.txt"
            os.makedirs(os.path.dirname(os.path.abspath(out_filename)), exist_ok=True)
            with open(out_filename, 'w', encoding='utf-8') as f:
                f.write(res['text'])
            print(f"✅ Экспортирована папка: '{res['folder_name']}' (ID: {res['folder_id']})")
            print(f"   Колод: {res['decks_count']}, всего карточек: {res['cards_count']}")
            print(f"   Файл: {out_filename}")
            return 0

        else:
            print("❌ Укажите --deck-id <ID> или --folder-id <ID> для экспорта.", file=sys.stderr)
            return 1

    except Exception as e:
        print(f"❌ Ошибка экспорта: {e}", file=sys.stderr)
        return 1


# ============================================================================
# Команда: UPDATE
# ============================================================================

def handle_update(args) -> int:
    """Обновляет существующие карточки из файла с двухфазной валидацией."""
    initialize_database()

    if not os.path.exists(args.file):
        print(f"❌ Файл не найден: {args.file}", file=sys.stderr)
        return 1

    with open(args.file, 'r', encoding='utf-8') as f:
        text = f.read()

    cards = parse_cards_text(text, default_deck_id=args.deck_id)
    if not cards:
        print("❌ В файле не найдено ни одной карточки для обновления.", file=sys.stderr)
        return 1

    deck_ids = {c['deck_id'] for c in cards if c.get('deck_id')}
    is_multi_deck = len(deck_ids) > 1 or bool(args.folder_id)

    # 1. Расчет предпросмотра через общий сервис
    try:
        preview = preview_update_content(
            cards=cards,
            deck_id=args.deck_id,
            folder_id=args.folder_id,
            user_id=args.user_id
        )
    except Exception as e:
        print(f"❌ Ошибка предпросмотра: {e}", file=sys.stderr)
        return 1

    print("=" * 60)
    print(f"🔍 ПРОВЕРКА ОБНОВЛЕНИЯ КАРТОЧЕК ({'ПАПКА' if is_multi_deck else 'КОЛОДА'})")
    print(f"   Файл: {args.file}")
    print(f"   Найдено карточек в файле: {len(cards)}")
    print(f"   ID пользователя: {preview.get('user_id')}")
    print(f"   Режим: {'[APPLY] Применение изменений' if args.apply else '[DRY-RUN] Только предпросмотр'}")
    print("=" * 60)

    print("\n📊 РЕЗУЛЬТАТ ПРЕДПРОСМОТРА:")
    print(f"   • Будет обновлено (изменено): {preview.get('updated', 0)}")
    print(f"   • Без изменений:              {preview.get('unchanged', 0)}")
    print(f"   • Новых карточек:             {preview.get('new', 0)}")
    errors = preview.get('errors', [])
    if errors:
        print(f"   ⚠️ Ошибок валидации:         {len(errors)}")
        for err in errors[:5]:
            print(f"      - {err}")
        return 1

    # Показываем детальный diff для изменённых карточек
    changed_cards = [c for c in preview.get('cards', []) if c.get('changed_fields')]
    if changed_cards:
        print(f"\n📝 ПРИМЕРЫ ИЗМЕНЕНИЙ (показано до 5 из {len(changed_cards)}):")
        for c in changed_cards[:5]:
            cid = c.get('card_id')
            fields = ", ".join(c.get('changed_fields', []))
            print(f"   Карточка ID {cid}: изменены поля [{fields}]")

    if not args.apply:
        print("\n" + "=" * 60)
        print("ℹ️ Это был режим DRY-RUN. В базе данных ничего не изменено.")
        print(f"Чтобы применить эти обновления, запустите:")
        print(f"python scripts/lerne_author_cli.py update {args.file} --apply")
        print("=" * 60)
        return 0

    # 2. Применение изменений через общий сервис
    preview_token = preview['preview_token']
    try:
        result = apply_update_content(
            cards=cards,
            preview_token=preview_token,
            deck_id=args.deck_id,
            folder_id=args.folder_id,
            user_id=args.user_id,
            include_new=args.include_new
        )

        print("\n" + "=" * 60)
        print("✅ УСПЕШНО ОБНОВЛЕНО В БАЗЕ ДАННЫХ:")
        print(f"   • Обновлено карточек: {result.get('updated', 0)}")
        print(f"   • Создано новых:      {result.get('created', 0)}")
        print("=" * 60)
        return 0
    except Exception as e:
        print(f"❌ Ошибка применения обновлений: {e}", file=sys.stderr)
        return 1


# ============================================================================
# Команда: PUBLISH
# ============================================================================

def handle_publish(args) -> int:
    """Публикует новый урок/колоды в базу данных через сервисный слой."""
    initialize_database()

    if not os.path.exists(args.file):
        print(f"❌ Файл не найден: {args.file}", file=sys.stderr)
        return 1

    with open(args.file, 'r', encoding='utf-8') as f:
        text = f.read()

    cards = parse_cards_text(text, default_deck_name=args.deck_name)
    if not cards:
        print("❌ В файле не найдено ни одной карточки для публикации.", file=sys.stderr)
        return 1

    # Анализ перед публикацией через общий сервис
    try:
        preview = preview_publish_content(cards, default_deck_name=args.deck_name)
    except Exception as e:
        print(f"❌ Ошибка анализа файла: {e}", file=sys.stderr)
        return 1

    print("=" * 60)
    print("📦 ПУБЛИКАЦИЯ УРОКА В LERNE")
    print(f"   Файл: {args.file}")
    print(f"   Обнаружено колод:    {preview['decks_count']}")
    print(f"   Всего карточек:      {preview['total_cards']}")
    for d in preview['decks']:
        print(f"     • '{d['deck_name']}': {d['cards_count']} карточек")
    print(f"   Режим: {'[APPLY] Запись в БД' if args.apply else '[DRY-RUN] Предпросмотр'}")
    print("=" * 60)

    # 1. Определение целевой папки
    target_folder_id = args.folder_id
    new_folder_name = args.new_folder

    if not target_folder_id and not new_folder_name:
        # Интерактивный режим (если доступен терминал)
        if sys.stdin.isatty():
            active_folders = list(TMA_Folder.select().where(TMA_Folder.is_deleted == False).order_by(TMA_Folder.name))
            print("\n📁 ВЫБЕРИТЕ ПАПКУ ДЛЯ УРОКА:")
            for idx, f in enumerate(active_folders[:15], 1):
                print(f"  [{idx}] {f.name} (ID: {f.id})")
            print("  [+] Создать НОВУЮ папку")

            choice = input("\nВаш выбор: ").strip()
            if choice == '+':
                new_folder_name = input("Введите название новой папки: ").strip()
                if not new_folder_name:
                    print("❌ Название папки не может быть пустым.", file=sys.stderr)
                    return 1
            elif choice.isdigit() and 1 <= int(choice) <= len(active_folders):
                selected = active_folders[int(choice) - 1]
                target_folder_id = selected.id
                print(f"✅ Выбрана папка: '{selected.name}' (ID: {selected.id})")
            else:
                print("❌ Некорректный выбор папки.", file=sys.stderr)
                return 1
        else:
            print("❌ Укажите --folder-id <ID> или --new-folder <Name>.", file=sys.stderr)
            return 1

    if not args.apply:
        print("\n" + "=" * 60)
        print("ℹ️ Это был режим DRY-RUN. В базе данных ничего не создано.")
        print(f"Чтобы опубликовать этот урок, запустите:")
        folder_flag = f"--folder-id {target_folder_id}" if target_folder_id else f"--new-folder \"{new_folder_name}\""
        print(f"python scripts/lerne_author_cli.py publish {args.file} {folder_flag} --apply")
        print("=" * 60)
        return 0

    # 2. Публикация через общий сервис
    try:
        result = apply_publish_content(
            cards=cards,
            target_folder_id=target_folder_id,
            new_folder_name=new_folder_name,
            default_deck_name=args.deck_name,
            force_new_deck=args.force_new_deck,
            user_id=args.user_id
        )

        print("\n" + "=" * 60)
        print("🎉 УРОК УСПЕШНО ОПУБЛИКОВАН В LERNE:")
        print(f"   Папка: '{result['folder_name']}' (ID: {result['folder_id']})")
        for d in result['published_decks']:
            status_desc = "Создана новая колода" if d['created_deck'] else "Использована существующая колода"
            print(f"   • {status_desc} '{d['deck_name']}' (ID: {d['deck_id']}): {d['cards_count']} карточек")
        print(f"   ИТОГО сохранено карточек: {result['total_saved_cards']}")
        print("=" * 60)
        return 0

    except Exception as e:
        print(f"❌ Ошибка публикации урока: {e}", file=sys.stderr)
        return 1


# ============================================================================
# Точка входа CLI
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        prog="lerne_author_cli",
        description="Lerne Author CLI — экспорт, обновление и публикация уроков."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Subcommand: export
    p_export = subparsers.add_parser("export", help="Экспорт колоды или папки в текстовый формат.")
    p_export.add_argument("--deck-id", type=int, help="ID колоды для экспорта.")
    p_export.add_argument("--folder-id", type=int, help="ID папки для экспорта.")
    p_export.add_argument("--out", type=str, help="Путь для сохранения файла (опционально).")
    p_export.add_argument("--user-id", type=int, default=None, help="ID пользователя (по умолчанию определяется автоматически).")

    # Subcommand: update
    p_update = subparsers.add_parser("update", help="Безопасное двухфазное обновление существующих карточек.")
    p_update.add_argument("file", type=str, help="Путь к отредактированному файлу карточек.")
    p_update.add_argument("--deck-id", type=int, help="ID колоды (если не указан в файле).")
    p_update.add_argument("--folder-id", type=int, help="ID папки (для мультиколодного файла).")
    p_update.add_argument("--user-id", type=int, default=None, help="ID пользователя (по умолчанию определяется автоматически).")
    p_update.add_argument("--include-new", action="store_true", help="Включить добавление новых карточек при обновлении.")
    mode_group = p_update.add_mutually_exclusive_group()
    mode_group.add_argument("--dry-run", action="store_true", default=True, help="Режим предпросмотра (по умолчанию).")
    mode_group.add_argument("--apply", action="store_true", help="Применить обновления в БД.")

    # Subcommand: publish
    p_publish = subparsers.add_parser("publish", help="Публикация нового урока/колод в базу данных.")
    p_publish.add_argument("file", type=str, help="Путь к файлу урока от агента.")
    p_publish.add_argument("--folder-id", type=int, help="ID целевой папки.")
    p_publish.add_argument("--new-folder", type=str, help="Создать новую папку с указанным именем.")
    p_publish.add_argument("--deck-name", type=str, help="Переопределить название колоды.")
    p_publish.add_argument("--force-new-deck", action="store_true", help="Создать новую колоду, даже если уже есть колода с таким именем.")
    p_publish.add_argument("--user-id", type=int, default=None, help="ID пользователя (по умолчанию определяется автоматически).")
    pub_mode_group = p_publish.add_mutually_exclusive_group()
    pub_mode_group.add_argument("--dry-run", action="store_true", default=True, help="Режим предпросмотра (по умолчанию).")
    pub_mode_group.add_argument("--apply", action="store_true", help="Записать карточки в БД.")

    args = parser.parse_args()

    if args.command == "export":
        sys.exit(handle_export(args))
    elif args.command == "update":
        sys.exit(handle_update(args))
    elif args.command == "publish":
        sys.exit(handle_publish(args))

if __name__ == "__main__":
    main()

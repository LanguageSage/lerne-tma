import os, sys, json, argparse, datetime
sys.stdout.reconfigure(encoding="utf-8")
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
from api import models


def check_environment_and_target(force: bool = False):
    from api.local_runtime import is_local
    if not is_local():
        raise RuntimeError(
            "ОТКАЗ БЕЗОПАСНОСТИ: tools/restore_database.py запрещено запускать вне LERNE_MODE=LOCAL.\n"
            "Скрипт выполняет частичный UPDATE и категорически запрещён для использования в production.\n"
            "Для штатного восстановления используйте:\n"
            "  1. В терминале: python scripts/local_dev.py restore <путь_к_дампу.dump>\n"
            "  2. В веб-интерфейсе: Lerne Admin -> Резервные копии"
        )
    if not force:
        raise RuntimeError(
            "ОТКАЗ БЕЗОПАСНОСТИ: tools/restore_database.py заблокирован по умолчанию.\n"
            "Этот устаревший скрипт выполняет частичный UPDATE полей карточек без восстановления\n"
            "структуры, колод, папок, SRS-прогресса, заметок и медиа, и может повредить данные V2.\n"
            "Штатные средства полного восстановления:\n"
            "  - Дамп базы: python scripts/local_dev.py restore <файл.dump>\n"
            "  - Полный архив: Панель Lerne Admin -> Резервные копии\n"
            "Для принудительного устаревшего восстановления укажите флаг: --force-unsafe-legacy-restore"
        )
    from local.runtime import validate_database_url, local_config
    config = local_config(create_dirs=False)
    validate_database_url(config.get("database_url", ""))


def restore_backup(backup_path: str, dry_run: bool = False, force: bool = False):
    check_environment_and_target(force=force)

    print("=" * 65)
    print("🔄 ВОССТАНОВЛЕНИЕ БАЗЫ ДАННЫХ ИЗ БЭКАПА (LEGACY PARTIAL UPDATE)")
    print("=" * 65)

    if not os.path.exists(backup_path):
        print(f"❌ Ошибка: файл бэкапа не найден: {backup_path}")
        return

    print("\n[1/3] Чтение файла бэкапа...")
    with open(backup_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    cards = data if isinstance(data, list) else data.get("cards", [])

    print(f"  -> Загружено записей карточек: {len(cards)}")
    print("\n[2/3] Подключение к базе данных...")
    if not models.tma_db.obj:
        models.initialize_database()
    print("  -> Подключено успешно.")

    print("\n[3/3] Восстановление данных...")
    if dry_run:
        print("  -> [DRY-RUN] Режим симуляции: изменения НЕ применены.")
        return

    # The explicit override is for old V1 databases only. It must never bypass
    # Native V2 validation, media recovery or the single-content-source contract.
    with models.tma_db.connection_context():
        if any(column.name == 'content_v2' for column in models.tma_db.get_columns('tma_card')):
            raise RuntimeError('Legacy partial restore is forbidden for a Native V2 schema; use the full backup or native importer.')
    if any(card.get('content_v2') is not None for card in cards):
        raise RuntimeError('Legacy partial restore cannot write content_v2; use the native importer.')

    updated_count = 0
    with models.tma_db.atomic():
        for c in cards:
            c_id = c.get("id")
            if not c_id:
                continue
            update_fields = {
                "tags": c.get("tags"),
                "context": c.get("context"),
                "updated_at": datetime.datetime.now(datetime.timezone.utc),
            }
            if "front_text" in c:
                update_fields["front_text"] = c.get("front_text")
            if "back_text" in c:
                update_fields["back_text"] = c.get("back_text")
            models.TMA_Card.update(**update_fields).where(models.TMA_Card.id == c_id).execute()
            updated_count += 1

    print(f"\n✅ Успешно обновлено карточек: {updated_count}")
    print("=" * 65)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Database Restore Utility (Legacy)")
    parser.add_argument("file", help="Path to backup JSON file")
    parser.add_argument("--dry-run", action="store_true", help="Test without writing to DB")
    parser.add_argument(
        "--force-unsafe-legacy-restore",
        action="store_true",
        help="Explicitly permit unsafe legacy partial update in LOCAL mode"
    )
    args = parser.parse_args()
    restore_backup(args.file, dry_run=args.dry_run, force=args.force_unsafe_legacy_restore)

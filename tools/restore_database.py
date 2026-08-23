import os, sys, json, argparse, datetime
sys.stdout.reconfigure(encoding="utf-8")
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
from api import models

def restore_backup(backup_path: str, dry_run: bool = False):
    print("=" * 65)
    print("🔄 ВОССТАНОВЛЕНИЕ БАЗЫ ДАННЫХ ИЗ БЭКАПА")
    print("=" * 65)

    if not os.path.exists(backup_path):
        print(f"❌ Ошибка: файл бэкапа не найден: {backup_path}")
        return

    print("\n[1/3] Чтение файла бэкапа...")
    with open(backup_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    cards = data.get("cards", [])
    if isinstance(data, list):
        cards = data

    print(f"  -> Загружено записей карточек: {len(cards)}")
    print("\n[2/3] Подключение к базе данных...")
    if not models.tma_db.obj:
        models.initialize_database()
    print("  -> Подключено успешно.")

    print("\n[3/3] Восстановление данных...")
    if dry_run:
        print("  -> [DRY-RUN] Режим симуляции: изменения НЕ применены.")
        return

    updated_count = 0
    with models.tma_db.atomic():
        for c in cards:
            c_id = c.get("id")
            if c_id:
                models.TMA_Card.update(
                    tags=c.get("tags"),
                    front_text=c.get("front_text"),
                    back_text=c.get("back_text"),
                    context=c.get("context"),
                    updated_at=datetime.datetime.now()
                ).where(models.TMA_Card.id == c_id).execute()
                updated_count += 1

    print(f"\n✅ Успешно восстановлено карточек: {updated_count}")
    print("=" * 65)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Database Restore Utility")
    parser.add_argument("file", help="Path to backup JSON file")
    parser.add_argument("--dry-run", action="store_true", help="Test without writing to DB")
    args = parser.parse_args()
    restore_backup(args.file, args.dry_run)

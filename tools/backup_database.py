import os, sys, json, datetime
sys.stdout.reconfigure(encoding="utf-8")
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
from api import models

def create_backup():
    print("=" * 65)
    print("📦 СОЗДАНИЕ РЕЗЕРВНОЙ КОПИИ БАЗЫ ДАННЫХ LERNE")
    print("=" * 65)
    print("\n[1/3] Подключение к базе данных...")
    if not models.tma_db.obj:
        models.initialize_database()
    print("  -> Подключено успешно.")

    backup_dir = os.path.join(project_root, "api", "data", "backups")
    os.makedirs(backup_dir, exist_ok=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = os.path.join(backup_dir, f"backup_full_{timestamp}.json")

    print("\n[2/3] Выгрузка данных...")
    cards = list(models.TMA_Card.select().dicts())
    decks = list(models.TMA_Deck.select().dicts())
    folders = list(models.TMA_Folder.select().dicts())
    users = list(models.TMAUser.select().dicts())
    settings = list(models.TMASetting.select().dicts())

    data = {
        "timestamp": datetime.datetime.now().isoformat(),
        "total_cards": len(cards),
        "cards": cards,
        "decks": decks,
        "folders": folders,
        "users": users,
        "settings": settings
    }

    print(f"  -> Карточек:   {len(cards)}")
    print(f"  -> Колод:      {len(decks)}")
    print(f"  -> Папок:      {len(folders)}")
    print(f"  -> Настроек:   {len(settings)}")

    print("\n[3/3] Сохранение на диск...")
    with open(backup_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)

    size_mb = os.path.getsize(backup_file) / (1024 * 1024)
    print(f"\n✅ БЭКАП УСПЕШНО СОЗДАН!")
    print(f"Файл: {backup_file} ({size_mb:.2f} MB)")
    print("=" * 65)

if __name__ == "__main__":
    create_backup()

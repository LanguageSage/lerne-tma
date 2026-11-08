import os, sys, json, datetime
sys.stdout.reconfigure(encoding="utf-8")
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
from api import models


def check_environment_and_target():
    from api.local_runtime import is_local
    if not is_local():
        raise RuntimeError(
            "ОТКАЗ БЕЗОПАСНОСТИ: tools/backup_database.py запрещено запускать вне LERNE_MODE=LOCAL.\n"
            "Скрипт производит частичную выгрузку и не предназначен для использования в production.\n"
            "Используйте штатные инструменты:\n"
            "  1. В терминале: python scripts/local_dev.py backup\n"
            "  2. В веб-интерфейсе: Lerne Admin -> Резервные копии (Full Database Bundle)"
        )
    from local.runtime import validate_database_url, local_config
    config = local_config(create_dirs=False)
    validate_database_url(config.get("database_url", ""))


def create_backup():
    check_environment_and_target()
    print("=" * 65)
    print("📦 СОЗДАНИЕ ЧАСТИЧНОЙ РЕЗЕРВНОЙ КОПИИ БАЗЫ ДАННЫХ LERNE (LEGACY)")
    print("=" * 65)
    print("⚠️  ПРЕДУПРЕЖДЕНИЕ: Этот скрипт сохраняет только таблицы tma_card, tma_deck,")
    print("    tma_folder, tma_user, tmasetting. SRS-прогресс, история повторений, заметки,")
    print("    рейтинги и медиафайлы НЕ сохраняются.")
    print("    Для полного бэкапа используйте: python scripts/local_dev.py backup\n")

    print("[1/3] Подключение к базе данных...")
    if not models.tma_db.obj:
        models.initialize_database()
    print("  -> Подключено успешно.")

    cfg_path = os.path.join(project_root, "tools", "admin", "admin_config.json")
    custom_dir = None
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                custom_dir = json.load(f).get("custom_backup_dir", "").strip()
        except Exception:
            pass
    backup_dir = custom_dir if (custom_dir and os.path.exists(custom_dir)) else os.path.join(project_root, "backups")
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

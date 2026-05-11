import os
import sys
from pathlib import Path

# Добавляем путь к корню проекта, чтобы импорты работали
sys.path.append(str(Path(__file__).resolve().parent.parent))

from api.models import tma_db, TMALinkedSession, TMAUser, create_all_tables

def main():
    print("Connecting to database...")
    try:
        # Пытаемся создать конкретно таблицу для сессий, если она отсутствует
        tma_db.create_tables([TMALinkedSession, TMAUser], safe=True)
        print("✅ Tables 'tma_linked_session' and 'tma_user' are ready.")
        
        # Запускаем общее создание таблиц для уверенности
        create_all_tables()
        print("✅ All other tables checked.")
        
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()

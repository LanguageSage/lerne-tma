import sqlite3
import sys

# Настройка кодировки для Windows консоли
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

db_path = r'C:\121\Lerne_projekt\Lerne\db\lerne.db'

def revert_decks():
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Проверяем наличие таблиц
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row[0] for row in cursor.fetchall()]
        
        target_topic = 'Новая Библиотека'
        
        # Обновляем основную таблицу deck
        if 'deck' in tables:
            cursor.execute("UPDATE deck SET topic = ? WHERE name LIKE '⭐%'", (target_topic,))
            print(f"✅ Updated {cursor.rowcount} decks in 'deck' table.")
            
        # Обновляем вспомогательную таблицу tma_deck_old (если она есть)
        if 'tma_deck_old' in tables:
            cursor.execute("UPDATE tma_deck_old SET topic = ? WHERE name LIKE '⭐%'", (target_topic,))
            print(f"✅ Updated {cursor.rowcount} decks in 'tma_deck_old' table.")
            
        conn.commit()
        conn.close()
        print(f"\n✨ Все колоды со звездочками успешно возвращены в '{target_topic}'.")
        
    except Exception as e:
        print(f"❌ Ошибка при возврате: {e}")

if __name__ == "__main__":
    revert_decks()

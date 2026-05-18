import sqlite3
from pathlib import Path

db_path = Path(r'C:\121\Lerne_projekt\Lerne\db\lerne.db')
out_path = Path(r'c:\121\Lerne_projekt\tma\scratch\db_deep_inspection.txt')

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

with open(out_path, 'w', encoding='utf-8') as f:
    f.write("--- 1. ТАБЛИЦЫ В БАЗЕ ДАННЫХ ---\n")
    cur.execute("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
    tables = cur.fetchall()
    for t in tables:
        f.write(f"{t['type'].upper()}: {t['name']}\n")

    f.write("\n--- 2. SQL ПРЕДСТАВЛЕНИЙ TMA_DECK И TMA_CARD ---\n")
    cur.execute("SELECT name, sql FROM sqlite_master WHERE name IN ('tma_deck', 'tma_card')")
    for v in cur.fetchall():
        f.write(f"\nVIEW {v['name']}:\n{v['sql']}\n")

    f.write("\n--- 3. ПОИСК ПОЛЬЗОВАТЕЛЕЙ 7187932783 и 642478257 ---\n")
    # Ищем таблицу пользователей
    user_tables = [t['name'] for t in tables if 'user' in t['name'].lower() or 'profile' in t['name'].lower() or 'account' in t['name'].lower() or 'client' in t['name'].lower() or 'student' in t['name'].lower()]
    f.write(f"Потенциальные таблицы пользователей: {user_tables}\n")
    for ut in user_tables:
        try:
            cur.execute(f"SELECT * FROM {ut} WHERE id IN (7187932783, 642478257) OR tg_id IN (7187932783, 642478257) OR user_id IN (7187932783, 642478257)")
            rows = cur.fetchall()
            f.write(f"\nТаблица {ut}: найдено {len(rows)} записей\n")
            for r in rows:
                row_dict = dict(r)
                f.write(f"  {row_dict}\n")
        except Exception as e:
            f.write(f"Таблица {ut} ошибка: {e}\n")

    # Если не нашли в таблицах с user, поищем во всех таблицах, где есть колонка с id/user_id
    f.write("\n--- 4. ПРЯМОЙ ЗАПРОС ИЗ TMA_DECK ДЛЯ 642478257 ---\n")
    cur.execute("SELECT id, name, is_deleted, user_id FROM tma_deck WHERE user_id = 642478257")
    rows = cur.fetchall()
    f.write(f"Найдено колод в tma_deck для 642478257: {len(rows)}\n")
    for r in rows:
        f.write(f"  ID={r['id']}, Name='{r['name']}', is_deleted={r['is_deleted']}\n")

    f.write("\n--- 5. ПРЯМОЙ ЗАПРОС ИЗ DECK ДЛЯ 642478257 ---\n")
    cur.execute("SELECT id, name, is_deleted, user_id FROM deck WHERE user_id = 642478257")
    rows = cur.fetchall()
    f.write(f"Найдено колод в deck для 642478257: {len(rows)}\n")
    for r in rows:
        f.write(f"  ID={r['id']}, Name='{r['name']}', is_deleted={r['is_deleted']}\n")

conn.close()
print("Done deep inspection.")

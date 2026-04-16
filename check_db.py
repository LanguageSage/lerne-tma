import sqlite3
conn = sqlite3.connect('api/data/tma.db')
cursor = conn.cursor()
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
for row in cursor.fetchall():
    print(row[0])
conn.close()

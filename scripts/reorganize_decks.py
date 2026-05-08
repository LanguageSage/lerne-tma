import sqlite3
import json
import asyncio
import os
import aiohttp
import datetime
from pathlib import Path
from dotenv import load_dotenv

# 1. Setup
load_dotenv()
DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")

# 2. Prompts
SYSTEM_PROMPT = """You are an expert German language teacher.
Your task is to reorganize a collection of flashcard decks.
I will give you a list of decks, each with an ID, name, and a few sample cards (Front/Back).

For each deck, you must:
1. Identify the CEFR level (A1, A2, B1, B2, C1).
2. Assign a broad topic category (e.g., Grammatik, Alltagsdeutsch, Kommunikation, Prüfungsvorbereitung, Briefe/E-Mails, Basis-Wortschatz).
3. Suggest a new, professional name for the deck in German/Russian, including the level in brackets like [B1].
   IMPORTANT: Group similar decks into the same new name if they belong together.

Output format: ONLY a JSON list of objects with 'id', 'level', 'topic', and 'new_name'.
Example:
[
  {"id": 14, "level": "B1", "topic": "Prüfungsvorbereitung", "new_name": "[B1] Bildbeschreibung"},
  {"id": 24, "level": "B1", "topic": "Prüfungsvorbereitung", "new_name": "[B1] Bildbeschreibung"}
]
"""

async def call_gemini(deck_data, retry_count=3):
    # Using gemini-flash-latest which was found in ListModels
    model = "gemini-flash-latest"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GOOGLE_API_KEY}"
    user_msg = json.dumps(deck_data, ensure_ascii=False)
    
    payload = {
        "contents": [{"parts": [{"text": f"System: {SYSTEM_PROMPT}\n\nDecks to categorize:\n{user_msg}"}]}]
    }
    
    async with aiohttp.ClientSession() as session:
        for attempt in range(retry_count):
            try:
                async with session.post(url, json=payload, timeout=60) as resp:
                    if resp.status == 429:
                        print(f"  Rate limited. Wait 10s...", flush=True)
                        await asyncio.sleep(10)
                        continue
                    if resp.status != 200:
                        print(f"  AI Error {resp.status}: {await resp.text()}", flush=True)
                        return None
                    data = await resp.json()
                    text = data["candidates"][0]["content"]["parts"][0]["text"]
                    text = text.replace("```json", "").replace("```", "").strip()
                    return json.loads(text)
            except Exception as e:
                print(f"  AI Exception: {e}", flush=True)
                await asyncio.sleep(2)
    return None

def get_decks():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, user_id FROM tma_deck WHERE is_deleted = 0")
    decks = [dict(row) for row in cursor.fetchall()]
    for d in decks:
        cursor.execute("SELECT front_text, back_text FROM tma_card WHERE deck_id = ? LIMIT 5", (d['id'],))
        d['samples'] = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return decks

async def main():
    print("Starting Reorganization...", flush=True)
    decks = get_decks()
    if not decks: return
    user_id = decks[0]['user_id']
    
    mapping = {}
    mapping_path = Path("scratch/reorg_mapping.json")
    if mapping_path.exists():
        print("Loading mapping from scratch/reorg_mapping.json...", flush=True)
        with open(mapping_path, "r", encoding="utf-8") as f:
            mapping = {int(k): v for k, v in json.load(f).items()}
            
    # Process remaining decks
    decks_to_ai = [d for d in decks if d['id'] not in mapping]
    if decks_to_ai:
        print(f"Analyzing {len(decks_to_ai)} new/remaining decks...", flush=True)
        for i in range(0, len(decks_to_ai), 10):
            batch = decks_to_ai[i:i+10]
            print(f"Batch {i//10 + 1}/{len(decks_to_ai)//10 + 1}...", flush=True)
            res = await call_gemini(batch)
            if res:
                for item in res:
                    mapping[item['id']] = item
                # Save progress
                os.makedirs("scratch", exist_ok=True)
                with open(mapping_path, "w", encoding="utf-8") as f:
                    json.dump(mapping, f, ensure_ascii=False, indent=2)
            await asyncio.sleep(1)
        
    # Apply to DB
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    new_decks = {}
    
    for d in decks:
        info = mapping.get(d['id'])
        if not info: continue
        
        new_name = info['new_name']
        if new_name not in new_decks:
            cursor.execute("SELECT id FROM tma_deck WHERE name = ? AND user_id = ? AND is_deleted = 0", (new_name, user_id))
            row = cursor.fetchone()
            if row:
                new_decks[new_name] = row[0]
                # Update level/topic just in case
                cursor.execute("UPDATE tma_deck SET level = ?, topic = ? WHERE id = ?", (info['level'], info['topic'], row[0]))
            else:
                cursor.execute("INSERT INTO tma_deck (user_id, name, level, topic, created_at, is_deleted) VALUES (?, ?, ?, ?, ?, 0)",
                             (user_id, new_name, info['level'], info['topic'], str(datetime.datetime.now())))
                new_decks[new_name] = cursor.lastrowid
        
        target_id = new_decks[new_name]
        if target_id != d['id']:
            cursor.execute("UPDATE tma_card SET deck_id = ? WHERE deck_id = ?", (target_id, d['id']))
            cursor.execute("UPDATE tma_deck SET is_deleted = 1 WHERE id = ?", (d['id'],))
            try:
                print(f"Merged {d['name']} -> {new_name}", flush=True)
            except UnicodeEncodeError:
                print(f"Merged deck ID {d['id']} -> {new_name.encode('ascii', 'replace').decode()}", flush=True)
            
    # Cleanup empty decks
    print("Cleaning up empty decks...", flush=True)
    cursor.execute("UPDATE tma_deck SET is_deleted = 1 WHERE id IN (SELECT d.id FROM tma_deck d LEFT JOIN tma_card c ON d.id = c.deck_id WHERE d.is_deleted = 0 GROUP BY d.id HAVING COUNT(c.id) = 0)")
    print(f"Removed {cursor.rowcount} empty decks.", flush=True)
            
    conn.commit()
    conn.close()
    print("Done!", flush=True)

if __name__ == "__main__":
    asyncio.run(main())

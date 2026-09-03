import os
import sys
import json
import asyncio
import io
import re

sys.stdout.reconfigure(encoding='utf-8')
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from api.database import initialize_database
if not initialize_database():
    print("❌ Failed to connect to DB", flush=True)
    sys.exit(1)

from api.ai_clients import AIService
from api import ai_service

JSON_PATH = os.path.join(project_root, 'app', 'src', 'data', 'lidQuestions.json')

SYSTEM_PROMPT = """Ты — высококвалифицированный профессиональный переводчик и преподаватель немецкого языка (эксперт по официальному экзамену BAMF "Leben in Deutschland" / "Einbürgerungstest").
Твоя задача — перевести предоставленные вопросы, варианты ответа и дать понятное краткое объяснение на русском языке.

ОБЯЗАТЕЛЬНЫЕ ТРЕБОВАНИЯ:
1. Ключи вариантов 'a', 'b', 'c', 'd' в ответе ДОЛЖНЫ СТРОГО И ТОЧНО соответствовать немецким вариантам 'a', 'b', 'c', 'd' из входных данных. НИ В КОЕМ СЛУЧАЕ НЕ ПЕРЕПУТЫВАЙ БУКВЫ!
2. Перевод должен быть точным, юридически и общественно грамотным для жизни в Германии:
   - "freie Wahlen" -> "свободные выборы" (НЕ "бесплатные")
   - "Rechtsstaat" -> "правовое государство"
   - "Meinungsfreiheit" -> "свобода мнений / слова"
   - "Religionsfreiheit" -> "свобода вероисповедания"
   - "Grundgesetz" -> "Основной закон (Конституция ФРГ)"
   - "etwas gegen die Regierung sagen" -> "высказываться с критикой правительства"
3. "context" — напиши краткое, емкое и понятное объяснение (1-2 предложения), почему правильный ответ именно такой.
4. Выводи ТОЛЬКО валидный JSON массив объектов следующего формата:
[
  {
    "id": "lid_1",
    "translationRu": {
      "question": "Русский перевод вопроса",
      "a": "Точный перевод немецкого варианта a",
      "b": "Точный перевод немецкого варианта b",
      "c": "Точный перевод немецкого варианта c",
      "d": "Точный перевод немецкого варианта d",
      "context": "Краткое понятное объяснение сути и правильного ответа на русском"
    }
  }
]
"""

def extract_json_array(text):
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    match = re.search(r"\[\s*\{.*\}\s*\]", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            pass
    try:
        return json.loads(text)
    except Exception:
        return None

async def process_batch(batch_qs, client, model, semaphore, progress_state, total):
    async with semaphore:
        batch_input = []
        for q in batch_qs:
            opts_dict = {opt['id']: opt['text'] for opt in q.get('options', [])}
            batch_input.append({
                "id": q['id'],
                "num": q.get('num'),
                "category": q.get('category'),
                "question": q['question'],
                "options": opts_dict,
                "correctOption": q.get('correctOption'),
                "context_de": q.get('context')
            })

        prompt = f"Переведи следующие {len(batch_input)} вопросов на русский язык:\n\n{json.dumps(batch_input, ensure_ascii=False, indent=2)}"

        for attempt in range(4):
            try:
                resp = await client.chat_completion(SYSTEM_PROMPT, prompt, model=model)
                text_resp = resp[0] if isinstance(resp, (tuple, list)) else str(resp)
                parsed = extract_json_array(text_resp)
                if parsed and isinstance(parsed, list):
                    for item in parsed:
                        qid = item.get('id')
                        tr = item.get('translationRu')
                        if qid and tr and 'question' in tr:
                            progress_state['results'][qid] = tr
                    progress_state['processed'] += len(batch_qs)
                    print(f"  [Progress: {progress_state['processed']}/{total}] ✅ Переведена пачка: {batch_qs[0]['num']}..{batch_qs[-1]['num']}", flush=True)
                    return
            except Exception as e:
                print(f"  ⚠️ Ошибка в попытке {attempt+1} для {batch_qs[0]['num']}: {e}", flush=True)
                await asyncio.sleep(2.0 * (attempt + 1))
        print(f"  ❌ Не удалось перевести пачку: {batch_qs[0]['num']}..{batch_qs[-1]['num']}", flush=True)

async def main():
    print("🚀 Запуск обновления переводов Leben in Deutschland...", flush=True)
    with open(JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    questions = data['questions']
    total = len(questions)
    print(f"Всего вопросов: {total}", flush=True)

    provider, api_key, model = ai_service.get_ai_config()
    client = AIService(provider=provider, api_key=api_key)
    print(f"Используется AI: {provider}, Модель: {model}", flush=True)

    batch_size = 10
    semaphore = asyncio.Semaphore(4)  # 4 concurrent workers
    progress_state = {'processed': 0, 'results': {}}

    tasks = []
    for i in range(0, total, batch_size):
        batch = questions[i:i+batch_size]
        tasks.append(process_batch(batch, client, model, semaphore, progress_state, total))

    await asyncio.gather(*tasks)

    # Save to JSON
    count_saved = 0
    for q in data['questions']:
        if q['id'] in progress_state['results']:
            q['translationRu'] = progress_state['results'][q['id']]
            count_saved += 1

    with open(JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"🎉 Сохранено {count_saved}/{total} обновленных переводов в {JSON_PATH}!", flush=True)

if __name__ == '__main__':
    asyncio.run(main())

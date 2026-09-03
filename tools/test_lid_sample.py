import sys
import os
import io
import json
import asyncio

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from api.database import initialize_database
if not initialize_database():
    print("Database init failed")
    sys.exit(1)

from api import models, ai_service
from api.ai_clients import AIService
from api.utils.audio import generate_audio

provider, ai_key, model = ai_service.get_ai_config()
print(f"AI Config: Provider={provider}, Model={model}, KeyPresent={bool(ai_key)}")

client = AIService(provider=provider, api_key=ai_key)

async def test_3():
    cards = list(models.TMA_Card.select().where(models.TMA_Card.id.in_([157959, 157960, 157961])))
    for c in cards:
        print("="*60)
        print(f"Card ID: {c.id}")
        
        lines = [line.strip() for line in c.front_text.strip().split('\n') if line.strip()]
        question_text = lines[0]
        options = lines[1:]
        correct_opt = next((o.replace('*', '').strip() for o in options if o.startswith('*')), '')
        
        print(f"German Question: {question_text}")
        print(f"Correct Answer: {correct_opt}")
        
        sys_prompt = "Ты эксперт по тесту 'Leben in Deutschland' (Einbürgerungstest). Отвечай строго в формате JSON."
        user_prompt = f"""Вопрос теста:
{question_text}

Варианты ответа:
{chr(10).join(options)}

Правильный ответ: {correct_opt}

Сформируй понятный и полезный обучающий контекст (пояснение) на русском языке:
- Почему именно этот ответ правильный?
- Какая статья Основного закона ФРГ (Grundgesetz) или исторический/правовой факт лежит в основе?
- Объем: 2-3 емких предложения.

Ответь СТРОГО в формате JSON:
{{
  "context": "Пояснение на русском языке с указанием законов/фактов",
  "translation_ru": "Качественный перевод вопроса и правильного ответа на русский язык"
}}
"""
        resp = await client.chat_completion(sys_prompt, user_prompt, model=model)
        text_resp = resp[0] if isinstance(resp, (tuple, list)) else str(resp)
        clean_json = ai_service.extract_json_from_text(text_resp, default_front="")
        
        print("\n--- Сгенерированный контекст и перевод ---")
        print("Контекст (пояснение):", clean_json.get("context"))
        print("Перевод на русский:", clean_json.get("translation_ru"))
        
        # Test TTS audio
        audio_res, _ = await generate_audio(question_text, voice="de-DE-KatjaNeural")
        print(f"Озвучка (TTS): сгенерировано {len(audio_res) if audio_res else 0} байт (Голос: Katja, Текст: '{question_text[:40]}...')")

if __name__ == "__main__":
    asyncio.run(test_3())

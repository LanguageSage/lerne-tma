import sys
import os
import io
import json
import asyncio
import datetime
import logging

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from api.database import initialize_database
if not initialize_database():
    print("❌ Failed to connect to database")
    sys.exit(1)

from api import models, ai_service
from api.ai_clients import AIService
from api.services.prompt_builders import build_quiz_prompt
from api.utils.audio import generate_audio

VOICE = "de-DE-SeraphinaMultilingualNeural"
CONCURRENCY = 3  # 3 concurrent cards for optimal speed

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("LiD_Generator")

def save_audio_to_media(res_audio: str) -> str:
    """Stores audio bytes in TMAMedia DB table and returns the filename."""
    if not res_audio:
        return ""
    if res_audio.startswith("http"):
        return res_audio
    
    filename = os.path.basename(res_audio)
    if os.path.exists(res_audio):
        try:
            with open(res_audio, "rb") as f:
                content = f.read()
            models.TMAMedia.get_or_create(
                filename=filename,
                folder='audio',
                defaults={'content': content}
            )
            try:
                os.remove(res_audio)
            except Exception:
                pass
        except Exception as e:
            logger.error(f"Error saving audio to TMAMedia: {e}")
    return filename

async def process_single_card(card, client, model, semaphore, progress_state):
    async with semaphore:
        card_id = card.id
        front_text = (card.front_text or "").strip()
        if not front_text:
            return
        
        # Check if already processed (has rich context starting with 🎯 and valid audio)
        has_rich_context = card.context and "🎯" in card.context
        has_audio = bool(card.audio_path and str(card.audio_path).strip())
        
        if has_rich_context and has_audio:
            progress_state["skipped"] += 1
            idx = progress_state["processed"] + progress_state["skipped"]
            total = progress_state["total"]
            print(f"[{idx}/{total}] ⏩ Пропущена (уже готова): #{card_id}")
            return

        # 1. AI Generation for Quiz Card
        new_back = card.back_text
        new_context = card.context
        new_level = "B1"
        
        if not has_rich_context:
            prompt = build_quiz_prompt(front_text, target_lang="de", native_lang="ru", is_batch=False)
            sys_prompt = "Ты — профессиональный преподаватель немецкого языка. Отвечай строго валидным JSON-объектом по заданной схеме без лишнего текста."
            
            for attempt in range(4):
                try:
                    resp = await client.chat_completion(sys_prompt, prompt, model=model)
                    text_resp = resp[0] if isinstance(resp, (tuple, list)) else str(resp)
                    data = ai_service.extract_json_from_text(text_resp, default_front=front_text)
                    
                    if data and isinstance(data, dict):
                        if data.get("back"):
                            new_back = data.get("back").strip()
                        if data.get("context"):
                            new_context = data.get("context").strip()
                        if data.get("level"):
                            new_level = data.get("level").strip()
                        break
                except Exception as ai_err:
                    if "429" in str(ai_err) or "ResourceExhausted" in str(ai_err):
                        await asyncio.sleep(2.0 * (attempt + 1))
                    else:
                        logger.warning(f"AI attempt {attempt+1} failed for card #{card_id}: {ai_err}")
                        await asyncio.sleep(1.0)
        
        # 2. TTS Generation for German Question
        saved_audio = card.audio_path
        if not has_audio:
            lines = [line.strip() for line in front_text.split('\n') if line.strip()]
            q_text = lines[0] if lines else front_text
            
            for attempt in range(3):
                try:
                    audio_res, _ = await generate_audio(q_text, voice=VOICE)
                    if isinstance(audio_res, tuple):
                        audio_res = audio_res[0]
                    if audio_res:
                        saved_audio = save_audio_to_media(audio_res)
                        break
                except Exception as tts_err:
                    logger.warning(f"TTS attempt {attempt+1} failed for card #{card_id}: {tts_err}")
                    await asyncio.sleep(1.0)

        # 3. Save to database
        card.back_text = new_back
        card.context = new_context
        curr_tags = card.tags or ""
        cleaned_tags = ",".join([t for t in curr_tags.split(",") if t and t.upper() not in {"A1","A2","B1","B2","C1","C2"}])
        card.tags = f"{cleaned_tags},{new_level}".strip(",") if cleaned_tags else new_level
        card.card_type = "quiz"
        if saved_audio:
            card.audio_path = saved_audio
        card.updated_at = datetime.datetime.now()
        card.save()

        progress_state["processed"] += 1
        idx = progress_state["processed"] + progress_state["skipped"]
        total = progress_state["total"]
        first_line = front_text.split('\n')[0][:35]
        print(f"[{idx}/{total}] ✅ Готово #{card_id} | {first_line}... | 🎙️ Серафина | 💡 Контекст")

async def run_lid_generation():
    folder_name = 'Leben in Deutschland'
    folder = models.TMA_Folder.get_or_none(
        models.TMA_Folder.name == folder_name,
        models.TMA_Folder.is_deleted == False
    )
    if not folder:
        print(f"❌ Folder '{folder_name}' not found!")
        return

    decks = list(models.TMA_Deck.select().where(
        models.TMA_Deck.folder == folder,
        models.TMA_Deck.is_deleted == False
    ).order_by(models.TMA_Deck.id))

    print(f"📂 Найдено колод в папке '{folder_name}': {len(decks)}")

    all_cards = []
    for d in decks:
        c_list = list(models.TMA_Card.select().where(
            models.TMA_Card.deck_id == d.id,
            models.TMA_Card.is_deleted == False
        ).order_by(models.TMA_Card.id))
        all_cards.extend(c_list)
        print(f"  • Колода #{d.id} «{d.name}»: {len(c_list)} карточек")

    total_cards = len(all_cards)
    print(f"\n🚀 Всего карточек к обработке: {total_cards}")
    print(f"🎙️ Голос озвучки: {VOICE} (Серафина)")
    print(f"🤖 Промпт: build_quiz_prompt (полный разбор: перевод вариантов с ✅, объяснение, словарь, грамматика)")
    print(f"⚡ Конкурентность: {CONCURRENCY} потока\n" + "="*70)

    provider, ai_key, model = ai_service.get_ai_config()
    print(f"Конфигурация ИИ: Провайдер = {provider}, Модель = {model}\n")

    client = AIService(provider=provider, api_key=ai_key)
    semaphore = asyncio.Semaphore(CONCURRENCY)
    progress_state = {"processed": 0, "skipped": 0, "total": total_cards}

    start_time = datetime.datetime.now()

    # Process in chunks of 15
    chunk_size = 15
    for i in range(0, len(all_cards), chunk_size):
        chunk = all_cards[i:i + chunk_size]
        tasks = [process_single_card(card, client, model, semaphore, progress_state) for card in chunk]
        await asyncio.gather(*tasks)
        await asyncio.sleep(0.5)

    duration = (datetime.datetime.now() - start_time).total_seconds()
    print("\n" + "="*70)
    print(f"🎉 ВСЕ КАРТОЧКИ УСПЕШНО ОБРАБОТАНЫ!")
    print(f"📊 Всего: {total_cards} | Обработано: {progress_state['processed']} | Пропущено: {progress_state['skipped']}")
    print(f"⏱️ Затраченное время: {duration:.1f} сек ({duration/60:.1f} мин)")
    print("="*70)

if __name__ == "__main__":
    asyncio.run(run_lid_generation())

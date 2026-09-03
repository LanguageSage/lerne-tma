import sys
import os
import io
import json
import asyncio
import datetime
import logging

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from api.database import initialize_database
if not initialize_database():
    print("❌ Failed to connect to database", flush=True)
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

        # 1. AI Generation for Quiz Card (using prompt on line 157: is_batch=True)
        new_back = card.back_text
        new_context = card.context
        new_level = "B1"
        
        prompt = build_quiz_prompt(front_text, target_lang="de", native_lang="ru", is_batch=True)
        sys_prompt = "Ты — профессиональный преподаватель немецкого языка. Отвечай строго валидным JSON-объектом по заданной схеме без лишнего текста."
        
        for attempt in range(4):
            try:
                resp = await client.chat_completion(sys_prompt, prompt, model=model)
                text_resp = resp[0] if isinstance(resp, (tuple, list)) else str(resp)
                data = ai_service.extract_json_from_text(text_resp, default_front=front_text)
                
                if data and isinstance(data, (dict, list)):
                    item = data[0] if isinstance(data, list) else data
                    if item.get("back"):
                        new_back = item.get("back").strip()
                    if item.get("context"):
                        new_context = item.get("context").strip()
                    if item.get("level"):
                        new_level = item.get("level").strip()
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
        print(f"[{idx}/{total}] ✅ Готово #{card_id} | {first_line}... | 🎙️ Серафина | 💡 Контекст", flush=True)

async def sync_all_other_users_lid(master_cards):
    """Syncs the generated context, back, audio and card_type to all other LiD folders in DB."""
    print("\n🔄 Синхронизация сгенерированных 460 карточек во ВСЕ остальные аккаунты пользователей...", flush=True)
    
    # Build lookup by clean question text
    q_map = {}
    for c in master_cards:
        q_text = (c.front_text or "").split('\n')[0].strip()
        if q_text:
            q_map[q_text] = c
            if len(q_text) >= 25:
                q_map[q_text[:25]] = c

    # Find all other LiD folders
    other_folders = list(models.TMA_Folder.select().where(
        models.TMA_Folder.name == 'Leben in Deutschland',
        models.TMA_Folder.user_id != 642478257,
        models.TMA_Folder.is_deleted == False
    ))
    
    synced_folders = 0
    synced_cards = 0
    now = datetime.datetime.now()

    for f in other_folders:
        f_decks = list(models.TMA_Deck.select().where(models.TMA_Deck.folder == f, models.TMA_Deck.is_deleted == False))
        for d in f_decks:
            d_cards = list(models.TMA_Card.select().where(models.TMA_Card.deck == d, models.TMA_Card.is_deleted == False))
            for card in d_cards:
                c_front = (card.front_text or "").split('\n')[0].strip()
                matched = q_map.get(c_front) or (q_map.get(c_front[:25]) if len(c_front) >= 25 else None)
                if matched:
                    card.back_text = matched.back_text
                    card.context = matched.context
                    card.audio_path = matched.audio_path
                    card.tags = matched.tags
                    card.card_type = "quiz"
                    card.updated_at = now
                    card.save()
                    synced_cards += 1
        synced_folders += 1

    print(f"✅ Синхронизация завершена: обновлено {synced_cards} карточек в {synced_folders} папках других пользователей!\n", flush=True)

async def run_lid_generation():
    target_user_id = 642478257  # @Aruna27
    folder_name = 'Leben in Deutschland'
    
    folder = models.TMA_Folder.get_or_none(
        models.TMA_Folder.user_id == target_user_id,
        models.TMA_Folder.name == folder_name,
        models.TMA_Folder.is_deleted == False
    )
    if not folder:
        print(f"❌ Папка '{folder_name}' для пользователя {target_user_id} не найдена!", flush=True)
        return

    decks = list(models.TMA_Deck.select().where(
        models.TMA_Deck.folder == folder,
        models.TMA_Deck.is_deleted == False
    ).order_by(models.TMA_Deck.id))

    print(f"📂 Папка #{folder.id} '{folder_name}' (Аккаунт @Aruna27, ID {target_user_id})", flush=True)
    print(f"📂 Найдено колод в папке: {len(decks)}", flush=True)

    all_cards = []
    for d in decks:
        c_list = list(models.TMA_Card.select().where(
            models.TMA_Card.deck_id == d.id,
            models.TMA_Card.is_deleted == False
        ).order_by(models.TMA_Card.id))
        all_cards.extend(c_list)
        print(f"  • Колода #{d.id} «{d.name}»: {len(c_list)} карточек", flush=True)

    total_cards = len(all_cards)
    print(f"\n🚀 Всего карточек к генерации: {total_cards}", flush=True)
    print(f"🎙️ Голос озвучки: {VOICE} (Серафина)", flush=True)
    print(f"🤖 Промпт: build_quiz_prompt (строка 157: 🎯 Объяснение + 📖 Словарный запас, card_type: quiz)", flush=True)
    print(f"⚡ Конкурентность: {CONCURRENCY} потока\n" + "="*70, flush=True)

    provider, ai_key, model = ai_service.get_ai_config()
    print(f"Конфигурация ИИ: Провайдер = {provider}, Модель = {model}\n", flush=True)

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
    print("\n" + "="*70, flush=True)
    print(f"🎉 ВСЕ КАРТОЧКИ УСПЕШНО СГЕНЕРИРОВАНЫ В АККАУНТЕ @Aruna27!", flush=True)
    print(f"📊 Всего: {total_cards} | Обработано: {progress_state['processed']} | Пропущено: {progress_state['skipped']}", flush=True)
    print(f"⏱️ Затраченное время: {duration:.1f} сек ({duration/60:.1f} мин)", flush=True)
    print("="*70, flush=True)

    # Sync to all other users
    await sync_all_other_users_lid(all_cards)

if __name__ == "__main__":
    asyncio.run(run_lid_generation())

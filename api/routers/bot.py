import os
import logging
import datetime
import urllib.parse
from fastapi import APIRouter, Request, Header, Depends, HTTPException
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application

from api.dependencies.auth import get_user_id
from api import services

router = APIRouter()
logger = logging.getLogger(__name__)

# --- CONFIG ---
TOKEN = os.getenv("BOT_TOKEN")
# Извлекаем имя канала (убираем @ если есть для ссылки)
RAW_CHANNEL = os.getenv("REQUIRED_CHANNEL", "LerneDeutsch287").replace("@", "")
CHANNEL_ID = f"@{RAW_CHANNEL}"
# Всегда используем продакшн URL для ссылок в боте, локальная переменная TMA_LINK для разработки
TMA_URL = "https://tma-amber.vercel.app"

def make_browser_url(base_url: str, user, extra_param: str = None) -> str:
    """Генерирует надежный URL для открытия в браузере с сохранением профиля."""
    uid = getattr(user, "id", None) or getattr(user, "user_id", None)
    params = {"user_id": uid}
    if getattr(user, "first_name", None):
        params["first_name"] = user.first_name
    if getattr(user, "last_name", None):
        params["last_name"] = user.last_name
    if getattr(user, "username", None):
        params["username"] = user.username
    if extra_param:
        params["tgWebAppStartParam"] = extra_param
    return f"{base_url}/?{urllib.parse.urlencode(params)}"

# Инициализация приложения PTB (без запуска polling)
ptb_app = Application.builder().token(TOKEN).build() if TOKEN else None

async def check_user_sub(context, user_id: int):
    """Фоновая проверка подписки через бота."""
    try:
        member = await context.bot.get_chat_member(chat_id=CHANNEL_ID, user_id=user_id)
        return member.status in ["member", "administrator", "creator"]
    except Exception as e:
        logger.error(f"Ошибка при проверке подписки: {e}")
        return False

async def save_tma_user(user):
    """Helper to save or update TMA user profile in DB."""
    try:
        from api.models import TMAUser
        tma_user, created = TMAUser.get_or_create(user_id=user.id)
        tma_user.first_name = user.first_name
        tma_user.last_name = user.last_name
        tma_user.username = user.username
        tma_user.updated_at = datetime.datetime.now()
        # Interaction with bot means user is verified/not a guest
        tma_user.is_guest = False
        tma_user.save()
        logger.info(f"User profile synced via bot: {user.id} ({user.first_name})")
        return tma_user
    except Exception as e:
        logger.error(f"Error saving user in bot: {e}")
        return None

# --- Handlers ---

import html

async def safe_send_reply(update: Update, text_html: str, reply_markup=None):
    """Отправляет сообщение пользователю с HTML-разметкой, с автоматическим фоллбэком при ошибке."""
    if not update.message:
        return
    try:
        await update.message.reply_text(text_html, reply_markup=reply_markup, parse_mode="HTML")
    except Exception as e:
        logger.warning(f"Failed to reply with HTML parse_mode: {e}. Retrying plain text.")
        plain_text = text_html.replace("<b>", "").replace("</b>", "").replace("<i>", "").replace("</i>", "")
        try:
            await update.message.reply_text(plain_text, reply_markup=reply_markup)
        except Exception as e2:
            logger.error(f"Failed to send plain text reply: {e2}")

# --- Handlers ---

async def start_handler(update: Update, context):
    try:
        user = update.effective_user
        if not user:
            return
            
        # Always ensure user profile is in DB
        await save_tma_user(user)
        
        first_name = html.escape(user.first_name or "Пользователь")
        
        # Проверяем наличие аргументов в команде /start (например, /start link_12345)
        args = context.args
        
        if args and args[0].startswith("link_"):
            try:
                guest_id = int(args[0].replace("link_", ""))
                from api.models import TMALinkedSession
                session = TMALinkedSession.get_or_none(TMALinkedSession.guest_id == guest_id)
                if session:
                    session.telegram_id = user.id
                    session.is_confirmed = True
                    session.save()
                    
                    from api import services
                    services.merge_guest_data(guest_id, user.id)
                    
                    logger.info(f"Auth Session Linked: guest={guest_id} -> user={user.id} ({user.first_name})")
                    
                    text = (
                        f"✅ <b>Вход в аккаунт подтвержден!</b>\n\n"
                        f"Привет, {first_name}! Мы связали твой профиль.\n\n"
                        "Теперь можешь вернуться в браузер — твой прогресс уже перенесен! 🚀"
                    )
                    keyboard = InlineKeyboardMarkup([
                        [InlineKeyboardButton("🌍 Открыть в браузере", url=make_browser_url(TMA_URL, user))]
                    ])
                    await safe_send_reply(update, text, reply_markup=keyboard)
                    return
            except Exception as e:
                logger.error(f"Error linking session: {e}")
                
            # Fallback if session not found or error
            text = (
                f"🔗 <b>Вход в аккаунт подтвержден!</b>\n\n"
                f"Привет, {first_name}! Мы нашли твой Telegram-профиль.\n\n"
                "Нажми на кнопку ниже, чтобы войти в приложение в браузере:"
            )
            keyboard = InlineKeyboardMarkup([
                [InlineKeyboardButton("🌍 Открыть в браузере", url=make_browser_url(TMA_URL, user))]
            ])
            await safe_send_reply(update, text, reply_markup=keyboard)
            return

        if args and (args[0].startswith("c_") or args[0].startswith("d_") or args[0].startswith("f_") or args[0].startswith("collab_")):
            share_id = args[0]
            clean_id = share_id.replace("collab_", "").strip()
            item_desc = "материалы"
            try:
                from api.models import TMA_Deck, TMAFolder, TMA_Card
                from api.services.reminder_service import plural_cards

                if clean_id.startswith("d_"):
                    # 1. Поиск по share_id (например, d_a1b2c3d4e5f6)
                    d = TMA_Deck.get_or_none((TMA_Deck.share_id == clean_id) & (TMA_Deck.is_deleted == False))
                    # 2. Если не найдено, проверка числового id (d_36)
                    if not d:
                        num_part = clean_id.replace("d_", "")
                        if num_part.isdigit():
                            d = TMA_Deck.get_or_none((TMA_Deck.id == int(num_part)) & (TMA_Deck.is_deleted == False))
                    
                    if d:
                        total_c = TMA_Card.select().where((TMA_Card.deck_id == d.id) & (TMA_Card.is_deleted == False)).count()
                        c_info = f" ({plural_cards(total_c)})" if total_c > 0 else ""
                        item_desc = f"колоду «<b>{html.escape(d.name)}</b>»{c_info}"
                    else:
                        item_desc = "колоду"

                elif clean_id.startswith("f_"):
                    f = TMAFolder.get_or_none((TMAFolder.share_id == clean_id) & (TMAFolder.is_deleted == False))
                    if not f:
                        num_part = clean_id.replace("f_", "")
                        if num_part.isdigit():
                            f = TMAFolder.get_or_none((TMAFolder.id == int(num_part)) & (TMAFolder.is_deleted == False))
                    
                    if f:
                        item_desc = f"папку «<b>{html.escape(f.name)}</b>»"
                    else:
                        item_desc = "папку с колодами"

                elif clean_id.startswith("c_"):
                    c = TMA_Card.get_or_none((TMA_Card.share_id == clean_id) & (TMA_Card.is_deleted == False))
                    if not c:
                        num_part = clean_id.replace("c_", "")
                        if num_part.isdigit():
                            c = TMA_Card.get_or_none((TMA_Card.id == int(num_part)) & (TMA_Card.is_deleted == False))
                    
                    if c:
                        card_preview = c.front_text[:30] + ("..." if len(c.front_text) > 30 else "")
                        item_desc = f"карточку «<b>{html.escape(card_preview)}</b>»"
                    else:
                        item_desc = "карточку"
            except Exception as e:
                logger.error(f"Error resolving share details for {share_id}: {e}", exc_info=True)

            text = (
                f"💌 <b>Здравствуйте, {first_name}!</b>\n\n"
                f"Вам отправили {item_desc}.\n\n"
                "Нажмите кнопку ниже, чтобы открыть её и начать учить! 👇"
            )
            browser_url = make_browser_url(TMA_URL, user, extra_param=share_id)
            keyboard = InlineKeyboardMarkup([
                [InlineKeyboardButton("🚀 Открыть колоду", url=browser_url)],
                [InlineKeyboardButton("📢 Наш Telegram-канал", url=f"https://t.me/{RAW_CHANNEL}")]
            ])
            await safe_send_reply(update, text, reply_markup=keyboard)
            return

        text = (
            f"🌟 <b>Здравствуйте, {first_name}! Добро пожаловать в Lerne!</b>\n\n"
            "Это пространство для эффективного изучения немецкого языка с помощью ИИ. 🇩🇪\n\n"
            "Нажмите кнопку ниже, чтобы начать обучение в браузере! 👇"
        )
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🚀 Начать учить в браузере", url=make_browser_url(TMA_URL, user))],
            [InlineKeyboardButton("📢 Наш Telegram-канал", url=f"https://t.me/{RAW_CHANNEL}")]
        ])
        
        await safe_send_reply(update, text, reply_markup=keyboard)
    except Exception as e:
        logger.error(f"Error handling /start command: {e}", exc_info=True)

async def callback_handler(update: Update, context):
    try:
        query = update.callback_query
        user = update.effective_user
        if query:
            await query.answer()
        
        if user:
            await save_tma_user(user)
        
        if query and query.data == "check_and_open":
            try:
                await query.edit_message_text(
                    "✅ <b>Добро пожаловать!</b>\n\nТебе доступен полный функционал приложения. Удачи в обучении! 🚀",
                    reply_markup=InlineKeyboardMarkup([
                        [InlineKeyboardButton("🚀 Начать учить в браузере", url=f"{TMA_URL}/?user_id={user.id}")]
                    ]),
                    parse_mode="HTML"
                )
            except Exception as e:
                logger.error(f"Error editing message in callback: {e}")
    except Exception as e:
        logger.error(f"Error in callback_handler: {e}", exc_info=True)

# Регистрируем хендлеры
if ptb_app:
    from telegram.ext import CommandHandler, CallbackQueryHandler
    ptb_app.add_handler(CommandHandler("start", start_handler))
    ptb_app.add_handler(CallbackQueryHandler(callback_handler))

# --- Webhook Endpoint ---

@router.post("/bot_webhook")
async def bot_webhook(request: Request):
    """Основной эндпоинт для приема обновлений от Telegram."""
    if not ptb_app:
        return {"status": "bot_token_missing"}

    try:
        data = await request.json()
        update = Update.de_json(data, ptb_app.bot)
        
        # В Vercel (serverless) мы должны инициализировать и запустить приложение для обработки одного обновления
        async with ptb_app:
            await ptb_app.process_update(update)
            
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Webhook error: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}

@router.get("/bot_setup")
async def bot_setup(request: Request):
    """Вспомогательный эндпоинт для установки вебхука и инициализации таблиц."""
    if not TOKEN:
        return {"error": "BOT_TOKEN missing"}
    
    # Инициализация таблиц
    try:
        from api.models import TMALinkedSession, TMAUser, TMA_Deck, TMA_Card, TMAProgress
        TMALinkedSession.create_table(safe=True)
        TMAUser.create_table(safe=True)
        # На всякий случай проверяем основные таблицы
        TMA_Deck.create_table(safe=True)
        TMA_Card.create_table(safe=True)
        TMAProgress.create_table(safe=True)
        db_status = "Tables initialized"
    except Exception as e:
        db_status = f"DB Error: {e}"
    
    host = request.headers.get("host")
    # Vercel всегда использует https в продакшене
    protocol = "https" if "vercel" in host or "render" in host else "http"
    webhook_url = f"{protocol}://{host}/api/bot_webhook"
    
    async with ptb_app:
        success = await ptb_app.bot.set_webhook(url=webhook_url)
    
    return {
        "webhook_url": webhook_url,
        "success": success,
        "db_status": db_status
    }

@router.post("/bot/test-reminder")
async def test_bot_reminder(user_id: int = Depends(get_user_id)):
    """Отправляет тестовое напоминание текущему пользователю."""
    if not ptb_app:
        raise HTTPException(status_code=503, detail="Бот не настроен (BOT_TOKEN отсутствует)")
    
    async with ptb_app:
        result = await services.send_reminder_to_user(ptb_app, user_id, force=True)
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Не удалось отправить сообщение в Telegram"))
    return result

@router.get("/bot/cron-reminders")
@router.post("/bot/cron-reminders")
async def trigger_cron_reminders():
    """Эндпоинт для запуска крона рассылки напоминаний."""
    if not ptb_app:
        return {"status": "skipped", "message": "Bot not configured"}
    async with ptb_app:
        return await services.check_and_send_all_reminders(ptb_app)


import os
import logging
import datetime
from fastapi import APIRouter, Request, Header
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application

router = APIRouter()
logger = logging.getLogger(__name__)

# --- CONFIG ---
TOKEN = os.getenv("BOT_TOKEN")
# Извлекаем имя канала (убираем @ если есть для ссылки)
RAW_CHANNEL = os.getenv("REQUIRED_CHANNEL", "LerneDeutsch287").replace("@", "")
CHANNEL_ID = f"@{RAW_CHANNEL}"
# Всегда используем продакшн URL для ссылок в боте, локальная переменная TMA_LINK для разработки
TMA_URL = "https://tma-amber.vercel.app"

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
                        [InlineKeyboardButton("🌍 Открыть в браузере", url=f"{TMA_URL}/?user_id={user.id}")]
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
                [InlineKeyboardButton("🌍 Открыть в браузере", url=f"{TMA_URL}/?user_id={user.id}")]
            ])
            await safe_send_reply(update, text, reply_markup=keyboard)
            return

        if args and (args[0].startswith("c_") or args[0].startswith("d_")):
            share_id = args[0]
            item_type = "колоду" if share_id.startswith("d_") else "карточку"
            text = (
                f"💌 <b>Вам отправили {item_type} для изучения!</b>\n\n"
                f"Привет, {first_name}!\n"
                f"Нажми кнопку ниже, чтобы открыть Lerne и добавить {item_type} себе 👇"
            )
            custom_url = f"{TMA_URL}?tgWebAppStartParam={share_id}"
            keyboard = InlineKeyboardMarkup([
                [InlineKeyboardButton("🚀 Открыть и добавить", web_app=WebAppInfo(url=custom_url))],
                [InlineKeyboardButton("🌍 Открыть в браузере", url=f"{TMA_URL}?tgWebAppStartParam={share_id}")]
            ])
            await safe_send_reply(update, text, reply_markup=keyboard)
            return

        text = (
            f"🌟 <b>Привет, {first_name}! Добро пожаловать в Lerne App!</b>\n\n"
            "Это пространство для эффективного изучения немецкого языка с помощью ИИ. 🇩🇪\n\n"
            "Нажми кнопку ниже, чтобы начать обучение! 👇"
        )
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🚀 Учить в Telegram", web_app=WebAppInfo(url=TMA_URL))],
            [InlineKeyboardButton("🌍 Открыть в браузере", url=f"{TMA_URL}/?user_id={user.id}")],
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
                        [InlineKeyboardButton("🚀 Учить с помощью Lerne TMA", web_app=WebAppInfo(url=TMA_URL))]
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

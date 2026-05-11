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

async def start_handler(update: Update, context):
    user = update.effective_user
    if not user:
        return
        
    # Always ensure user profile is in DB
    await save_tma_user(user)
    
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
                
                logger.info(f"Auth Session Linked: guest={guest_id} -> user={user.id} ({user.first_name})")
                
                text = (
                    f"✅ **Вход в аккаунт подтвержден!**\n\n"
                    f"Привет, {user.first_name}! Мы связали твой профиль.\n\n"
                    "Теперь можешь вернуться в браузер — твой прогресс уже перенесен! 🚀"
                )
                
                keyboard = InlineKeyboardMarkup([
                    [InlineKeyboardButton("🌍 Открыть в браузере", url=f"{TMA_URL}/?user_id={user.id}")]
                ])
                
                await update.message.reply_text(text, reply_markup=keyboard, parse_mode="Markdown")
                return
        except Exception as e:
            logger.error(f"Error linking session: {e}")
            
        # Fallback if session not found or error
        text = (
            f"🔗 **Вход в аккаунт подтвержден!**\n\n"
            f"Привет, {user.first_name}! Мы нашли твой Telegram-профиль.\n\n"
            "Нажми на кнопку ниже, чтобы войти в приложение в браузере:"
        )
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🌍 Открыть в браузере", url=f"{TMA_URL}/?user_id={user.id}")]
        ])
        await update.message.reply_text(text, reply_markup=keyboard, parse_mode="Markdown")
        return

    if args and (args[0].startswith("c_") or args[0].startswith("d_")):
        share_id = args[0]
        item_type = "колоду" if share_id.startswith("d_") else "карточку"
        text = (
            f"💌 **Вам отправили {item_type} для изучения!**\n\n"
            f"Привет, {user.first_name}!\n"
            f"Нажми кнопку ниже, чтобы открыть Lerne и добавить {item_type} себе 👇"
        )
        # Параметр передаём через URL нашего приложения — наиболее надёжный способ
        custom_url = f"{TMA_URL}?tgWebAppStartParam={share_id}"
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🚀 Открыть и добавить", web_app=WebAppInfo(url=custom_url))],
            [InlineKeyboardButton("🌍 Открыть в браузере", url=f"{TMA_URL}?tgWebAppStartParam={share_id}")]
        ])
        await update.message.reply_text(text, reply_markup=keyboard, parse_mode="Markdown")
        return


    is_subscribed = await check_user_sub(context, user.id)
    
    if is_subscribed:
        text = (
            f"🌟 **Привет, {user.first_name}! Рады твоему возвращению!**\n\n"
            "Ниже ссылка на Lerne TMA, удачной учебы! 🇩🇪"
        )
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("📢 Перейти в канал", url=f"https://t.me/{RAW_CHANNEL}")],
            [InlineKeyboardButton("🚀 Учить в Telegram", web_app=WebAppInfo(url=TMA_URL))],
            [InlineKeyboardButton("🌍 Открыть в браузере", url=f"{TMA_URL}/?user_id={user.id}")]
        ])
    else:
        text = (
            f"🌟 **Привет, {user.first_name}! Добро пожаловать в Lerne App!**\n\n"
            "Это пространство для эффективного изучения немецкого языка с помощью ИИ. 🇩🇪\n\n"
            "Подпишись на наш канал, чтобы получить доступ к приложению! 👇"
        )
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("📢 Зайти в канал", url=f"https://t.me/{RAW_CHANNEL}")],
            [InlineKeyboardButton("✅ Я подписался, открыть TMA", callback_data="check_and_open")],
            [InlineKeyboardButton("🌍 Открыть в браузере", url=f"{TMA_URL}/?user_id={user.id}")]
        ])
    
    await update.message.reply_text(text, reply_markup=keyboard, parse_mode="Markdown")

async def callback_handler(update: Update, context):
    query = update.callback_query
    user = update.effective_user
    await query.answer()
    
    if user:
        await save_tma_user(user)
    
    if query.data == "check_and_open":
        is_subscribed = await check_user_sub(context, update.effective_user.id)
        
        if is_subscribed:
            await query.edit_message_text(
                "✅ **Спасибо за подписку!**\n\nТеперь тебе доступен полный функционал приложения. Удачи в обучении! 🚀",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("🚀 Учить с помощью Lerne TMA", web_app=WebAppInfo(url=TMA_URL))]
                ]),
                parse_mode="Markdown"
            )
        else:
            await query.answer("Хмм, похоже подписка еще не оформлена. Попробуй еще раз после вступления в канал! 😊", show_alert=True)

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
        logger.error(f"Webhook error: {e}")
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

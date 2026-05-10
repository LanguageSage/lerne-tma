import os
import logging
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
TMA_URL = os.getenv("TMA_LINK", "https://tma-amber.vercel.app/")

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

# --- Handlers ---

async def start_handler(update: Update, context):
    user = update.effective_user
    # Проверяем наличие аргументов в команде /start (например, /start link_12345)
    args = context.args
    
    if args and args[0].startswith("link_"):
        # Это запрос на авторизацию браузерной сессии
        text = (
            f"🔗 **Вход в аккаунт подтвержден!**\n\n"
            f"Привет, {user.first_name}! Мы нашли твой Telegram-профиль.\n\n"
            f"Чтобы войти в это приложение в браузере, нажми на ссылку ниже:\n"
            f"👉 {TMA_URL}/?user_id={user.id}\n\n"
            "⚠️ *Внимание:* Не пересылай эту ссылку другим, она дает доступ к твоему прогрессу."
        )
        await update.message.reply_text(text, parse_mode="Markdown")
        return

    is_subscribed = await check_user_sub(context, user.id)
    
    if is_subscribed:
        text = (
            f"🌟 **Привет, {user.first_name}! Рады твоему возвращению!**\n\n"
            "Ниже ссылка на Lerne TMA, удачной учебы! 🇩🇪"
        )
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("📢 Перейти в канал", url=f"https://t.me/{RAW_CHANNEL}")],
            [InlineKeyboardButton("🚀 Учить с помощью Lerne TMA", web_app=WebAppInfo(url=TMA_URL))]
        ])
    else:
        text = (
            f"🌟 **Привет, {user.first_name}! Добро пожаловать в Lerne App!**\n\n"
            "Это пространство для эффективного изучения немецкого языка с помощью ИИ. 🇩🇪\n\n"
            "Подпишись на наш канал, чтобы получить доступ к приложению! 👇"
        )
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("📢 Зайти в канал", url=f"https://t.me/{RAW_CHANNEL}")],
            [InlineKeyboardButton("✅ Я подписался, открыть TMA", callback_data="check_and_open")]
        ])
    
    await update.message.reply_text(text, reply_markup=keyboard, parse_mode="Markdown")

async def callback_handler(update: Update, context):
    query = update.callback_query
    await query.answer()
    
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
    """Вспомогательный эндпоинт для установки вебхука."""
    if not TOKEN:
        return {"error": "BOT_TOKEN missing"}
    
    host = request.headers.get("host")
    # Vercel всегда использует https в продакшене
    protocol = "https" if "vercel" in host or "render" in host else "http"
    webhook_url = f"{protocol}://{host}/api/bot_webhook"
    
    async with ptb_app:
        success = await ptb_app.bot.set_webhook(url=webhook_url)
    
    return {
        "webhook_url": webhook_url,
        "success": success
    }

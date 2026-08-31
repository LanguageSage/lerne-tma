import os
import json
import logging
import datetime
import html
try:
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
except ImportError:
    InlineKeyboardButton = None
    InlineKeyboardMarkup = None
    WebAppInfo = None

from ..models import TMA_Deck, TMA_Card, TMAProgress, TMAUser, TMASetting, tma_db

logger = logging.getLogger(__name__)

TMA_URL = "https://tma-amber.vercel.app"

def get_user_reminder_settings(user_id: int) -> dict:
    """Возвращает настройки напоминаний пользователя."""
    default_settings = {
        "enabled": True,
        "times": ["10:00", "19:00"],
        "frequency": "twice_daily",  # 'twice_daily', 'daily', 'on_due_only'
        "timezone_offset": 3  # UTC+3 по умолчанию
    }
    try:
        setting = TMASetting.get_or_none(TMASetting.key == f"REMINDER_SETTINGS_{user_id}")
        if setting and setting.value:
            loaded = json.loads(setting.value)
            default_settings.update(loaded)
    except Exception as e:
        logger.error(f"Error reading reminder settings for user {user_id}: {e}")
    return default_settings

def save_user_reminder_settings(user_id: int, settings: dict) -> bool:
    """Сохраняет настройки напоминаний пользователя."""
    try:
        current = get_user_reminder_settings(user_id)
        current.update(settings)
        setting, created = TMASetting.get_or_create(key=f"REMINDER_SETTINGS_{user_id}")
        setting.value = json.dumps(current)
        setting.updated_at = datetime.datetime.now()
        setting.save()
        logger.info(f"Saved reminder settings for user {user_id}: {current}")
        return True
    except Exception as e:
        logger.error(f"Error saving reminder settings for user {user_id}: {e}")
        return False

def get_user_due_summary(user_id: int) -> dict:
    """
    Рассчитывает количество карточек к повторению по SRS только для активных колод (is_learning == True).
    """
    now = datetime.datetime.now()
    summary = {
        "total_due": 0,
        "total_new": 0,
        "total_active_decks": 0,
        "deck_details": []
    }

    try:
        decks = list(TMA_Deck.select().where(
            (TMA_Deck.user_id == user_id) & 
            (TMA_Deck.is_deleted == False)
        ))

        active_decks = []
        for d in decks:
            meta = {}
            if d.metadata:
                try:
                    meta = json.loads(d.metadata)
                except Exception:
                    meta = {}
            if meta.get("is_learning", False):
                active_decks.append(d)

        summary["total_active_decks"] = len(active_decks)
        if not active_decks:
            return summary

        active_deck_ids = [d.id for d in active_decks]

        # 1. Считаем созревшие карточки к повторению (queue in learning/review/relearning and next_review <= now)
        due_query = (TMAProgress
                     .select(TMA_Card.deck_id, fn.COUNT(TMAProgress.id).alias('due_count'))
                     .join(TMA_Card, on=(TMAProgress.card_id == TMA_Card.id))
                     .where(
                         (TMAProgress.user_id == user_id) &
                         (TMA_Card.deck_id << active_deck_ids) &
                         (TMA_Card.is_deleted == False) &
                         (TMAProgress.queue != 'new') &
                         (TMAProgress.next_review <= now)
                     )
                     .group_by(TMA_Card.deck_id))

        due_map = {row.tma_card.deck_id: row.due_count for row in due_query}

        # 2. Считаем общее количество карточек в каждой колоде
        cards_query = (TMA_Card
                       .select(TMA_Card.deck_id, fn.COUNT(TMA_Card.id).alias('total_cards'))
                       .where(
                           (TMA_Card.deck_id << active_deck_ids) &
                           (TMA_Card.is_deleted == False)
                       )
                       .group_by(TMA_Card.deck_id))

        total_cards_map = {row.deck_id: row.total_cards for row in cards_query}

        # 3. Считаем уже изученные карточки
        tracked_query = (TMAProgress
                         .select(TMA_Card.deck_id, fn.COUNT(TMAProgress.id).alias('tracked_count'))
                         .join(TMA_Card, on=(TMAProgress.card_id == TMA_Card.id))
                         .where(
                             (TMAProgress.user_id == user_id) &
                             (TMA_Card.deck_id << active_deck_ids) &
                             (TMA_Card.is_deleted == False) &
                             (TMAProgress.queue != 'new')
                         )
                         .group_by(TMA_Card.deck_id))

        tracked_map = {row.tma_card.deck_id: row.tracked_count for row in tracked_query}

        for d in active_decks:
            due = due_map.get(d.id, 0)
            total = total_cards_map.get(d.id, 0)
            tracked = tracked_map.get(d.id, 0)
            new_cards = max(0, total - tracked)

            summary["total_due"] += due
            summary["total_new"] += new_cards

            if due > 0 or new_cards > 0:
                summary["deck_details"].append({
                    "id": d.id,
                    "name": d.name,
                    "due": due,
                    "new": new_cards,
                    "total": total
                })

        return summary
    except Exception as e:
        logger.error(f"Error calculating due summary for user {user_id}: {e}", exc_info=True)
        return summary


def plural_cards(n: int) -> str:
    """Склонение слова 'карточка' для русского языка."""
    if n % 10 == 1 and n % 100 != 11:
        return f"{n} карточка"
    elif 2 <= n % 10 <= 4 and (n % 100 < 10 or n % 100 >= 20):
        return f"{n} карточки"
    else:
        return f"{n} карточек"


def format_reminder_message(first_name: str, summary: dict, is_test: bool = False) -> str:
    """Формирует понятный текст уведомления для Telegram."""
    safe_name = html.escape(first_name or "друг")
    total_due = summary.get("total_due", 0)
    total_new = summary.get("total_new", 0)
    deck_details = summary.get("deck_details", [])

    prefix = "⚡ <b>Тестовое напоминание Lerne</b>\n\n" if is_test else ""

    if total_due > 0:
        text = prefix
        text += f"Привет, {safe_name}! В колодах, которые вы учите, сегодня нужно повторить:\n\n"
        for item in deck_details:
            if item["due"] > 0:
                text += f"📚 <b>{html.escape(item['name'])}</b>\n"
                text += f"└ {plural_cards(item['due'])} к повторению\n\n"
        text += "Нажмите кнопку ниже, чтобы запустить тренировку! 🚀"
    elif total_new > 0:
        text = prefix
        text += f"Привет, {safe_name}! В колодах, которые вы учите, сегодня доступно:\n\n"
        for item in deck_details:
            if item["new"] > 0:
                text += f"📚 <b>{html.escape(item['name'])}</b>\n"
                text += f"└ {plural_cards(item['new'])} новых для изучения\n\n"
        text += "Хотите пройти новые карточки прямо сейчас? 👇"
    else:
        text = prefix
        text += f"Привет, {safe_name}! В ваших изучаемых колодах все карточки на сегодня успешно пройдены. Отличный прогресс! 🎉\n\n"
        text += "Возвращайтесь в любое удобное время! 🚀"

    return text


async def send_reminder_to_user(bot_app, user_id: int, force: bool = False) -> dict:
    """Отправляет персональное напоминание пользователю в Telegram."""
    if not bot_app or not bot_app.bot:
        return {"status": "error", "message": "Bot not initialized"}

    try:
        user = TMAUser.get_or_none(TMAUser.user_id == user_id)
        if not user or user.is_guest:
            return {"status": "skipped", "message": "Guest user"}

        settings = get_user_reminder_settings(user_id)
        if not settings.get("enabled", True) and not force:
            return {"status": "skipped", "message": "Notifications disabled by user"}

        summary = get_user_due_summary(user_id)
        
        # Если не принудительный тест и нет карточек для повторения и новых карточек — не спамим
        if not force and summary["total_due"] == 0 and summary["total_new"] == 0:
            return {"status": "skipped", "message": "No due or new cards"}

        first_name = user.first_name or user.username or "Пользователь"
        msg_text = format_reminder_message(first_name, summary, is_test=force)

        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🚀 Учить в браузере", url=f"{TMA_URL}/?user_id={user_id}")]
        ])

        await bot_app.bot.send_message(
            chat_id=user_id,
            text=msg_text,
            parse_mode="HTML",
            reply_markup=keyboard
        )

        logger.info(f"Sent SRS reminder to user {user_id} (due={summary['total_due']}, new={summary['total_new']})")
        return {"status": "success", "user_id": user_id, "total_due": summary["total_due"]}

    except Exception as e:
        logger.error(f"Failed to send reminder to user {user_id}: {e}")
        return {"status": "error", "message": str(e)}


async def check_and_send_all_reminders(bot_app) -> dict:
    """
    Проверяет всех пользователей и рассылает напоминания согласно их расписанию и часовому поясу.
    """
    if not bot_app or not bot_app.bot:
        return {"status": "error", "message": "Bot not configured"}

    results = {"sent": 0, "skipped": 0, "errors": 0}
    now_utc = datetime.datetime.utcnow()

    try:
        users = list(TMAUser.select().where(TMAUser.is_guest == False))
        for u in users:
            try:
                settings = get_user_reminder_settings(u.user_id)
                if not settings.get("enabled", True):
                    results["skipped"] += 1
                    continue

                tz_offset = int(settings.get("timezone_offset", 3))
                user_local_time = now_utc + datetime.timedelta(hours=tz_offset)
                current_hour = user_local_time.hour
                current_minute = user_local_time.minute

                scheduled_times = settings.get("times", ["10:00", "19:00"])
                
                # Проверяем, попадает ли текущий час в расписание (в пределах текущего часового окна)
                should_send = False
                for t_str in scheduled_times:
                    try:
                        sh_hour = int(t_str.split(":")[0])
                        if current_hour == sh_hour and current_minute < 45:
                            should_send = True
                            break
                    except Exception:
                        pass

                if should_send:
                    res = await send_reminder_to_user(bot_app, u.user_id, force=False)
                    if res.get("status") == "success":
                        results["sent"] += 1
                    else:
                        results["skipped"] += 1
                else:
                    results["skipped"] += 1
            except Exception as user_err:
                logger.error(f"Error processing user {u.user_id} in cron: {user_err}")
                results["errors"] += 1

        return {"status": "ok", "results": results}
    except Exception as e:
        logger.error(f"Error in check_and_send_all_reminders: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}

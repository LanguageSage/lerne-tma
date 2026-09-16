import os
import json
import logging
import datetime
import html
from zoneinfo import ZoneInfo

try:
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
except ImportError:
    InlineKeyboardButton = None
    InlineKeyboardMarkup = None
    WebAppInfo = None

from peewee import fn, Case, JOIN
from ..models import TMA_Deck, TMA_Card, TMAProgress, TMAUser, TMASetting, TMAAuthIdentity, tma_db

logger = logging.getLogger(__name__)

TMA_URL = "https://tma-amber.vercel.app"

OFFSET_TO_IANA = {
    0: "UTC",
    1: "Europe/Berlin",
    2: "Europe/Kyiv",
    3: "Europe/Moscow",
    4: "Asia/Dubai",
    5: "Asia/Tashkent",
    6: "Asia/Almaty",
    7: "Asia/Bangkok",
    8: "Asia/Singapore",
    9: "Asia/Tokyo",
    -5: "America/New_York",
    -8: "America/Los_Angeles",
}

def resolve_user_tzinfo(settings: dict):
    """Возвращает tzinfo (ZoneInfo) и строку IANA названию часового пояса."""
    tz_str = settings.get("timezone")
    if not tz_str:
        offset = settings.get("timezone_offset", 3)
        try:
            offset_int = int(offset)
            tz_str = OFFSET_TO_IANA.get(offset_int, "Europe/Berlin")
        except Exception:
            tz_str = "Europe/Berlin"
    try:
        return ZoneInfo(str(tz_str)), str(tz_str)
    except Exception:
        return ZoneInfo("Europe/Berlin"), "Europe/Berlin"

def get_user_reminder_settings(user_id: int) -> dict:
    """Возвращает настройки напоминаний пользователя."""
    default_settings = {
        "enabled": True,
        "times": ["09:00", "19:00"],
        "frequency": "twice_daily",  # 'hourly', 'five_times', 'three_times', 'twice_daily', 'daily', 'custom'
        "hourly_start": "08:00",
        "hourly_end": "22:00",
        "only_due": False,
        "quiet_enabled": False,
        "quiet_start": "23:00",
        "quiet_end": "07:00",
        "timezone": "Europe/Berlin",
        "timezone_offset": 3
    }
    try:
        setting = TMASetting.get_or_none(TMASetting.key == f"REMINDER_SETTINGS_{user_id}")
        if setting and setting.value:
            loaded = json.loads(setting.value)
            default_settings.update(loaded)
    except Exception as e:
        logger.error(f"Error reading reminder settings for user {user_id}: {e}")

    # Обратная совместимость: если timezone нет, конвертируем из timezone_offset
    if "timezone" not in default_settings or not default_settings["timezone"]:
        _, tz_str = resolve_user_tzinfo(default_settings)
        default_settings["timezone"] = tz_str

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
    Разбивает на 3 категории:
    🔴 due: срочные к повторению сегодня (queue == 'review' and next_review <= now)
    🟡 learning: на закреплении в текущем цикле (queue in ['learning', 'relearning'])
    🔵 new: новые карточки, которые ни разу не запускались
    """
    now = datetime.datetime.now()
    summary = {
        "total_due": 0,
        "total_learning": 0,
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

        # Подсчет статистики через оптимизированный Case / Join
        tracked_case = Case(None, [(TMAProgress.queue != 'new', 1)], None)
        learning_case = Case(None, [(TMAProgress.queue << ['learning', 'relearning'], 1)], None)
        due_case = Case(None, [((TMAProgress.queue == 'review') & (TMAProgress.next_review <= now), 1)], None)

        counts_query = (TMA_Card
                        .select(
                            TMA_Card.deck_id,
                            fn.COUNT(TMA_Card.id).alias('total'),
                            fn.COUNT(tracked_case).alias('tracked'),
                            fn.COUNT(learning_case).alias('learning'),
                            fn.COUNT(due_case).alias('due')
                        )
                        .join(TMAProgress, JOIN.LEFT_OUTER, on=(
                            (TMAProgress.card_id == TMA_Card.id) & (TMAProgress.user_id == user_id)
                        ))
                        .where(
                            (TMA_Card.deck_id << active_deck_ids) &
                            (TMA_Card.is_deleted == False)
                        )
                        .group_by(TMA_Card.deck_id)
                        .dicts())

        counts_map = {row['deck_id']: row for row in counts_query}

        for d in active_decks:
            c = counts_map.get(d.id, {})
            total = int(c.get('total') or 0)
            tracked = int(c.get('tracked') or 0)
            learning = int(c.get('learning') or 0)
            due = int(c.get('due') or 0)
            new_cards = max(0, total - tracked)

            summary["total_due"] += due
            summary["total_learning"] += learning
            summary["total_new"] += new_cards

            if due > 0 or learning > 0 or new_cards > 0:
                summary["deck_details"].append({
                    "id": d.id,
                    "name": d.name,
                    "due": due,
                    "learning": learning,
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
    """Формирует понятный текст уведомления для Telegram с ярлыками и 3 цветами."""
    safe_name = html.escape(first_name or "друг")
    total_due = summary.get("total_due", 0)
    total_learning = summary.get("total_learning", 0)
    total_new = summary.get("total_new", 0)
    deck_details = summary.get("deck_details", [])

    prefix = "⚡ <b>Тестовое напоминание Lerne</b>\n\n" if is_test else ""

    text = prefix
    text += f"Привет, {safe_name}! Напоминание по колодам, за которыми вы следите:\n\n"

    if deck_details:
        has_any_work = (total_due + total_learning + total_new) > 0
        for item in deck_details:
            name = html.escape(item.get("name", "Колода"))
            due = item.get("due", 0)
            learning = item.get("learning", 0)
            new_cards = item.get("new", 0)

            text += f"📚 <b>{name}</b>\n"
            if due > 0 or learning > 0 or new_cards > 0:
                text += f"   🔴 {due} повторить | 🟡 {learning} закрепить | 🔵 {new_cards} новых\n\n"
            else:
                text += "   ✅ Все карточки пройдены!\n\n"

        if has_any_work:
            text += (
                f"<b>Итого на сегодня:</b>\n"
                f"🔴 Повторить: <b>{total_due}</b> | 🟡 Закрепить: <b>{total_learning}</b> | 🔵 Новых: <b>{total_new}</b>\n\n"
                f"Нажмите кнопку ниже, чтобы начать! 🚀"
            )
        else:
            text += "Все карточки на сегодня успешно пройдены. Отличный прогресс! 🎉\n\nВозвращайтесь в любое удобное время! 🚀"
    else:
        text += "В ваших изучаемых колодах все карточки на сегодня успешно пройдены. Отличный прогресс! 🎉\n\n"
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

        target_chat_id = None
        identity = TMAAuthIdentity.get_or_none(
            (TMAAuthIdentity.account == user_id) & (TMAAuthIdentity.provider == 'telegram'))
        if identity and identity.subject.isdigit() and int(identity.subject) > 0:
            target_chat_id = int(identity.subject)
        elif isinstance(user_id, int) and user_id > 0:
            target_chat_id = user_id
            try:
                from ..models import TMAAuthAccount
                if TMAAuthAccount.get_or_none(TMAAuthAccount.user_id == user_id):
                    TMAAuthIdentity.get_or_create(
                        account=user_id,
                        provider='telegram',
                        defaults={'subject': str(user_id)}
                    )
            except Exception as sync_err:
                logger.debug(f"Identity backfill skipped for {user_id}: {sync_err}")

        if not target_chat_id:
            return {"status": "skipped", "message": "Telegram not linked"}

        settings = get_user_reminder_settings(user_id)
        if not settings.get("enabled", True) and not force:
            return {"status": "skipped", "message": "Notifications disabled by user"}

        summary = get_user_due_summary(user_id)
        
        # Если не принудительный тест и нет карточек для повторения/закрепления/новых — не спамим
        if not force and summary["total_due"] == 0 and summary["total_learning"] == 0 and summary["total_new"] == 0:
            return {"status": "skipped", "message": "No due or new cards"}

        first_name = user.first_name or user.username or "Пользователь"
        msg_text = format_reminder_message(first_name, summary, is_test=force)

        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🚀 Учить в браузере", url=TMA_URL)]
        ])

        await bot_app.bot.send_message(
            chat_id=target_chat_id,
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
    Использует устойчивую Catch-up логику с отслеживанием отправленных слотов за текущие сутки.
    """
    if not bot_app or not bot_app.bot:
        return {"status": "error", "message": "Bot not configured"}

    results = {"sent": 0, "skipped": 0, "errors": 0}
    details = []
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    try:
        users = list(TMAUser.select().where(TMAUser.is_guest == False))
        for u in users:
            try:
                settings = get_user_reminder_settings(u.user_id)
                if not settings.get("enabled", True):
                    results["skipped"] += 1
                    details.append({"user_id": u.user_id, "status": "skipped", "reason": "disabled"})
                    continue

                tzinfo, tz_name = resolve_user_tzinfo(settings)
                user_local_now = now_utc.astimezone(tzinfo)
                user_today = user_local_now.date()

                # Считываем ранее отправленные слоты
                last_slots_key = f"LAST_REMINDER_SLOTS_{u.user_id}"
                setting_obj = TMASetting.get_or_none(TMASetting.key == last_slots_key)
                sent_slots = []
                if setting_obj and setting_obj.value:
                    try:
                        sent_slots = json.loads(setting_obj.value)
                        if not isinstance(sent_slots, list):
                            sent_slots = []
                    except Exception:
                        sent_slots = []

                # Формируем список запланированных слотов на сегодня
                frequency = settings.get("frequency", "twice_daily")
                time_strings = []
                if frequency == "hourly":
                    h_start = int(settings.get("hourly_start", "08:00").split(":")[0])
                    h_end = int(settings.get("hourly_end", "22:00").split(":")[0])
                    for h in range(h_start, h_end + 1):
                        time_strings.append(f"{h:02d}:00")
                else:
                    time_strings = settings.get("times", ["09:00", "19:00"])

                # Вычисляем слоты, которые уже наступили для пользователя на сегодня
                due_slots = []
                for t_str in time_strings:
                    try:
                        parts = t_str.split(":")
                        sh_h, sh_m = int(parts[0]), int(parts[1]) if len(parts) > 1 else 0
                        slot_naive = datetime.datetime.combine(user_today, datetime.time(sh_h, sh_m))
                        slot_dt = slot_naive.replace(tzinfo=tzinfo)

                        # Проверка тихого режима
                        if settings.get("quiet_enabled", False):
                            q_start = int(settings.get("quiet_start", "23:00").split(":")[0])
                            q_end = int(settings.get("quiet_end", "07:00").split(":")[0])
                            is_quiet = (sh_h >= q_start or sh_h < q_end) if q_start > q_end else (q_start <= sh_h < q_end)
                            if is_quiet:
                                continue

                        slot_key = f"{user_today.isoformat()}_{sh_h:02d}:{sh_m:02d}"

                        # Слот наступил и укладывается в окно catch-up (до 12 часов)
                        if slot_dt <= user_local_now:
                            elapsed_sec = (user_local_now - slot_dt).total_seconds()
                            if elapsed_sec <= 12 * 3600 and slot_key not in sent_slots:
                                due_slots.append((slot_key, slot_dt))
                    except Exception as t_err:
                        logger.warning(f"Error parsing time slot {t_str} for user {u.user_id}: {t_err}")

                if not due_slots:
                    results["skipped"] += 1
                    details.append({"user_id": u.user_id, "status": "skipped", "reason": "no_due_unsent_slots"})
                    continue

                # Проверка фильтра "только созревшие"
                if settings.get("only_due", False):
                    due_check = get_user_due_summary(u.user_id)
                    if due_check.get("total_due", 0) == 0:
                        results["skipped"] += 1
                        details.append({"user_id": u.user_id, "status": "skipped", "reason": "only_due_enabled_but_no_due_cards"})
                        for s_key, _ in due_slots:
                            if s_key not in sent_slots:
                                sent_slots.append(s_key)
                        s_obj, _ = TMASetting.get_or_create(key=last_slots_key)
                        s_obj.value = json.dumps(sent_slots[-15:])
                        s_obj.updated_at = datetime.datetime.now()
                        s_obj.save()
                        continue

                latest_slot_key, latest_slot_dt = due_slots[-1]

                res = await send_reminder_to_user(bot_app, u.user_id, force=False)
                if res.get("status") == "success":
                    results["sent"] += 1
                    details.append({"user_id": u.user_id, "status": "sent", "due": res.get("total_due", 0), "slot": latest_slot_key})

                    for s_key, _ in due_slots:
                        if s_key not in sent_slots:
                            sent_slots.append(s_key)

                    s_obj, _ = TMASetting.get_or_create(key=last_slots_key)
                    s_obj.value = json.dumps(sent_slots[-15:])
                    s_obj.updated_at = datetime.datetime.now()
                    s_obj.save()
                else:
                    results["skipped"] += 1
                    details.append({"user_id": u.user_id, "status": "skipped", "reason": res.get("message")})
            except Exception as user_err:
                logger.error(f"Error processing user {u.user_id} in cron: {user_err}", exc_info=True)
                results["errors"] += 1
                details.append({"user_id": u.user_id, "status": "error", "error": str(user_err)})

        results["details"] = details
        logger.info(f"Cron reminder summary: sent={results['sent']}, skipped={results['skipped']}, errors={results['errors']}")
        return {"status": "ok", "results": results}
    except Exception as e:
        logger.error(f"Error in check_and_send_all_reminders: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}


def get_user_reminder_diagnostics(user_id: int) -> dict:
    """Возвращает полную диагностику состояния напоминаний пользователя."""
    settings = get_user_reminder_settings(user_id)
    summary = get_user_due_summary(user_id)
    tzinfo, tz_name = resolve_user_tzinfo(settings)
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    user_local_now = now_utc.astimezone(tzinfo)
    user_today = user_local_now.date()

    # Telegram Link status
    target_chat_id = None
    identity = TMAAuthIdentity.get_or_none(
        (TMAAuthIdentity.account == user_id) & (TMAAuthIdentity.provider == 'telegram'))
    if identity and identity.subject.isdigit() and int(identity.subject) > 0:
        target_chat_id = int(identity.subject)
    elif isinstance(user_id, int) and user_id > 0:
        target_chat_id = user_id

    # Next scheduled slot
    frequency = settings.get("frequency", "twice_daily")
    time_strings = []
    if frequency == "hourly":
        h_start = int(settings.get("hourly_start", "08:00").split(":")[0])
        h_end = int(settings.get("hourly_end", "22:00").split(":")[0])
        for h in range(h_start, h_end + 1):
            time_strings.append(f"{h:02d}:00")
    else:
        time_strings = settings.get("times", ["09:00", "19:00"])

    next_slot_str = None
    for day_offset in range(2):
        target_date = user_today + datetime.timedelta(days=day_offset)
        for t_str in time_strings:
            try:
                parts = t_str.split(":")
                sh_h, sh_m = int(parts[0]), int(parts[1]) if len(parts) > 1 else 0
                slot_dt = datetime.datetime.combine(target_date, datetime.time(sh_h, sh_m)).replace(tzinfo=tzinfo)
                if slot_dt > user_local_now:
                    day_label = "Сегодня" if day_offset == 0 else "Завтра"
                    next_slot_str = f"{day_label} в {t_str}"
                    break
            except Exception:
                pass
        if next_slot_str:
            break

    # Last sent slot
    last_slots_key = f"LAST_REMINDER_SLOTS_{user_id}"
    setting_obj = TMASetting.get_or_none(TMASetting.key == last_slots_key)
    last_sent_slot = None
    if setting_obj and setting_obj.value:
        try:
            slots = json.loads(setting_obj.value)
            if isinstance(slots, list) and slots:
                last_sent_slot = slots[-1]
        except Exception:
            pass

    return {
        "enabled": settings.get("enabled", True),
        "timezone": tz_name,
        "telegram_linked": bool(target_chat_id),
        "telegram_chat_id": target_chat_id,
        "active_decks": summary.get("total_active_decks", 0),
        "total_due": summary.get("total_due", 0),
        "total_learning": summary.get("total_learning", 0),
        "total_new": summary.get("total_new", 0),
        "next_reminder_slot": next_slot_str or "Не запланировано",
        "last_sent_slot": last_sent_slot or "—"
    }


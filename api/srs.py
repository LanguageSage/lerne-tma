import datetime
import math
import random

# Константы (синхронизированы с основным приложением Lerne)
INITIAL_EASE_FACTOR = 2.5
MINIMUM_EASE_FACTOR = 1.3
MAXIMUM_EASE_FACTOR = 3.0
LEARNING_STEPS = [5, 10]  # в минутах
RELEARN_STEPS = [5]       # в минутах
GRADUATING_INTERVAL_GOOD = 1  # дни
GRADUATING_INTERVAL_EASY = 3  # дни

HARD_MULTIPLIER = 1.15
EASY_MULTIPLIER = 1.3
LEECH_LAPSE_THRESHOLD = 5

def is_leech(lapses: int) -> bool:
    """Определяет, является ли карточка сложной/проблемной (Leech)."""
    return bool(lapses is not None and lapses >= LEECH_LAPSE_THRESHOLD)

def apply_fuzz(interval: int) -> int:
    """
    Размытие интервала (Fuzzing) для предотвращения пиков повторений.
    Для коротких интервалов (< 3 дней) размытие не применяется.
    """
    if interval < 3:
        return max(1, interval)
    elif interval <= 7:
        # Для 3-7 дней: сдвиг на -1, 0 или +1 день
        fuzz = random.choice([-1, 0, 1])
        return max(2, interval + fuzz)
    elif interval <= 30:
        # Для 8-30 дней: сдвиг на +-10% (минимум +-1 день)
        delta = max(1, round(interval * 0.10))
        fuzz = random.randint(-delta, delta)
        return max(7, interval + fuzz)
    else:
        # Для интервалов > 30 дней: сдвиг на +-5%
        delta = max(2, round(interval * 0.05))
        fuzz = random.randint(-delta, delta)
        return max(28, interval + fuzz)

class _DummyProgress:
    queue = 'new'
    step_index = 0
    interval = 0
    ease_factor = INITIAL_EASE_FACTOR
    lapses = 0
    next_review = None

def _get_learning_8_states(progress):
    steps = LEARNING_STEPS if progress.queue != 'relearning' else RELEARN_STEPS
    step_idx = progress.step_index if progress.step_index is not None else 0
    next_queue = 'learning' if progress.queue == 'new' else progress.queue
    hard_int = steps[1] if len(steps) > 1 else steps[0] * 2

    return [
        (next_queue, steps[0], 0, False),
        (next_queue, round((steps[0] + hard_int) / 2), 0, False),
        (next_queue, hard_int, step_idx, False),
        ('review', 1, None, True),
        ('review', GRADUATING_INTERVAL_GOOD, None, True),
        ('review', 2, None, True),
        ('review', GRADUATING_INTERVAL_EASY, None, True),
        ('review', max(4, round(GRADUATING_INTERVAL_EASY * 1.6)), None, True)
    ]

def _get_review_8_states(progress, now, apply_fuzz_flag=False):
    interval = progress.interval or 1
    ef = progress.ease_factor or INITIAL_EASE_FACTOR
    lapses = progress.lapses or 0

    days_since_due = (now - progress.next_review).days if (progress.next_review and progress.next_review < now) else 0

    ef_again = max(MINIMUM_EASE_FACTOR, ef - (0.15 if days_since_due > 7 else 0.20))
    int_hard = 1 if interval <= 1 else max(interval, round(interval * HARD_MULTIPLIER))
    int_good = max(int_hard + 1, math.ceil((interval + min(days_since_due / 2, interval * 0.5)) * ef))
    int_easy = max(int_good + 1, math.ceil((interval + min(float(days_since_due), interval)) * ef * EASY_MULTIPLIER))

    if apply_fuzz_flag:
        if int_hard >= 3: int_hard = apply_fuzz(int_hard)
        if int_good >= 3: int_good = apply_fuzz(int_good)
        if int_easy >= 3: int_easy = apply_fuzz(int_easy)

    def mid(low, high):
        return max(low + 1, min(high - 1, round((low + high) / 2)))

    return [
        ('relearning', RELEARN_STEPS[0], 0, ef_again, lapses + 1, False),
        ('review', max(1, round(int_hard / 2)), None, max(MINIMUM_EASE_FACTOR, ef - 0.18), lapses + 1, True),
        ('review', int_hard, None, max(MINIMUM_EASE_FACTOR, ef - 0.15), lapses, True),
        ('review', mid(int_hard, int_good), None, max(MINIMUM_EASE_FACTOR, ef - 0.06), lapses, True),
        ('review', int_good, None, min(MAXIMUM_EASE_FACTOR, ef + (0.02 if ef < INITIAL_EASE_FACTOR else 0)), lapses, True),
        ('review', mid(int_good, int_easy), None, min(MAXIMUM_EASE_FACTOR, ef + 0.08), lapses, True),
        ('review', int_easy, None, min(MAXIMUM_EASE_FACTOR, ef + 0.15), lapses, True),
        ('review', max(int_easy + 2, round(int_easy * 1.45)), None, min(MAXIMUM_EASE_FACTOR, ef + 0.22), lapses, True)
    ]


def get_next_intervals(progress) -> dict:
    """Возвращает текстовые описания следующих детерминированных интервалов для 4 и 8 кнопок."""
    p = progress if progress is not None else _DummyProgress()
    now = datetime.datetime.now()
    if p.queue in ['new', 'learning', 'relearning']:
        eight = _get_learning_8_states(p)
        # eight item: (queue, interval, step, is_days)
        ext = [format_interval(s[1], s[3]) for s in eight]
    else:
        eight = _get_review_8_states(p, now, apply_fuzz_flag=False)
        # eight item: (queue, interval, step, ef, lapses, is_days)
        ext = [format_interval(s[1], s[5]) for s in eight]

    return {
        0: ext[0],
        1: ext[2],
        2: ext[4],
        3: ext[6],
        "extended": ext
    }

def format_interval(value, is_days=False):
    if not is_days:
        if value < 60: 
            if value != int(value): return f"{round(value, 1)} мин"
            return f"{int(value)} мин"
        hours = value / 60
        if hours < 24: return f"{int(hours)} ч"
        return f"{int(hours/24)} дн"
    else:
        if value < 1: return "<1 дн"
        if value < 30: return f"{int(value)} дн"
        months = value / 30.0
        if months < 12: 
            return f"{months:.1f} мес" if months % 1 != 0 else f"{int(months)} мес"
        return f"{value/365.0:.1f} г."

def review_card(progress, grade: int, is_extended: bool = False):
    """Обновляет объект progress на основе оценки с поддержкой 4- и 8-балльной шкал."""
    now = datetime.datetime.now()
    
    if progress.queue in ['new', 'learning', 'relearning']:
        eight = _get_learning_8_states(progress)
        if is_extended:
            idx = min(max(0, grade), 7)
        else:
            anchor_map = [0, 2, 4, 6]
            idx = anchor_map[min(max(0, grade), 3)]
        
        new_queue, new_interval, new_step, is_days = eight[idx]
        progress.queue = new_queue
        progress.interval = new_interval
        progress.step_index = new_step
        if new_queue == 'review':
            progress.next_review = now + datetime.timedelta(days=new_interval)
            progress.repetitions = (progress.repetitions or 0) + 1
        else:
            progress.next_review = now + datetime.timedelta(minutes=new_interval)
    else:
        eight = _get_review_8_states(progress, now, apply_fuzz_flag=True)
        if is_extended:
            idx = min(max(0, grade), 7)
        else:
            anchor_map = [0, 2, 4, 6]
            idx = anchor_map[min(max(0, grade), 3)]
            
        new_queue, new_interval, new_step, new_ease, new_lapses, is_days = eight[idx]
        progress.queue = new_queue
        progress.interval = new_interval
        progress.step_index = new_step
        progress.ease_factor = new_ease
        progress.lapses = new_lapses
        
        if new_queue == 'relearning':
            progress.next_review = now + datetime.timedelta(minutes=new_interval)
        else:
            progress.next_review = now + datetime.timedelta(days=new_interval)
            progress.repetitions = (progress.repetitions or 0) + 1
            
    progress.last_reviewed = now
    progress.updated_at = now
    progress.save()
    return progress.next_review



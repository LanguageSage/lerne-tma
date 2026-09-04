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

def get_next_intervals(progress) -> dict[int, str]:
    """Возвращает текстовые описания следующих детерминированных интервалов для кнопок."""
    p = progress if progress is not None else _DummyProgress()
    res = {}
    now = datetime.datetime.now()
    for grade in range(4):
        if p.queue in ['new', 'learning', 'relearning']:
            new_queue, val, _ = _calc_learning_next_state(p, grade, now)
            is_days = (new_queue == 'review')
        else:
            # Для превью на кнопках fuzzing не применяется, чтобы значения были стабильными
            new_queue, val, _, _, _ = _calc_review_next_state(p, grade, now, apply_fuzz_flag=False)
            is_days = (new_queue != 'relearning')
            
        res[grade] = format_interval(val, is_days)
    return res

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

def review_card(progress, grade: int):
    """Обновляет объект progress на основе оценки с применением fuzzing и защиты от ease hell."""
    now = datetime.datetime.now()
    
    if progress.queue in ['new', 'learning', 'relearning']:
        new_queue, new_interval, new_step = _calc_learning_next_state(progress, grade, now)
        progress.queue = new_queue
        progress.interval = new_interval
        progress.step_index = new_step
        if new_queue == 'review':
            progress.next_review = now + datetime.timedelta(days=new_interval)
            progress.repetitions = (progress.repetitions or 0) + 1
        else:
            progress.next_review = now + datetime.timedelta(minutes=new_interval)
    else:
        new_queue, new_interval, new_step, new_ease, new_lapses = _calc_review_next_state(progress, grade, now, apply_fuzz_flag=True)
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

def _calc_learning_next_state(progress, grade, now):
    steps = LEARNING_STEPS if progress.queue != 'relearning' else RELEARN_STEPS
    step_idx = progress.step_index if progress.step_index is not None else 0
    next_queue = 'learning' if progress.queue == 'new' else progress.queue
    
    if grade == 0: # Again
        return (next_queue, steps[0], 0)
    elif grade == 1: # Hard
        hard_interval = steps[1] if len(steps) > 1 else steps[0] * 2
        return (next_queue, hard_interval, step_idx)
    elif grade == 2: # Good
        return ('review', GRADUATING_INTERVAL_GOOD, None)
    else: # Easy
        return ('review', GRADUATING_INTERVAL_EASY, None)

def _calc_review_next_state(progress, grade, now, apply_fuzz_flag=False):
    interval = progress.interval or 1
    ef = progress.ease_factor or INITIAL_EASE_FACTOR
    lapses = progress.lapses or 0
    
    # Расчет задержки (days_since_due)
    days_since_due = 0
    if progress.next_review and progress.next_review < now:
        days_since_due = (now - progress.next_review).days
    
    if grade == 0: # Again
        # Anti Ease-Hell: если карточка была сильно просрочена, штраф меньше
        ease_penalty = 0.15 if days_since_due > 7 else 0.20
        new_ef = max(MINIMUM_EASE_FACTOR, ef - ease_penalty)
        return ('relearning', RELEARN_STEPS[0], 0, new_ef, lapses + 1)
        
    elif grade == 1: # Hard
        new_ef = max(MINIMUM_EASE_FACTOR, ef - 0.15)
        # Для карточек с интервалом 1 день Hard = 1 день (повтор завтра), без неоправданного скачка
        if interval <= 1:
            new_int = 1
        else:
            new_int = max(interval, round(interval * HARD_MULTIPLIER))
        if apply_fuzz_flag and new_int >= 3:
            new_int = apply_fuzz(new_int)
        return ('review', new_int, None, new_ef, lapses)
        
    elif grade == 2: # Good
        # Учет задержки (days_since_due/2) с защитой от взрывного роста
        due_bonus = min(days_since_due / 2, interval * 0.5)
        # Определение базового интервала Hard для гарантии строгого неравенства
        base_hard = 1 if interval <= 1 else max(interval, round(interval * HARD_MULTIPLIER))
        # Округление вверх (math.ceil) исключает коллизию banker's rounding 2.5 -> 2
        calculated_int = math.ceil((interval + due_bonus) * ef)
        new_int = max(base_hard + 1, calculated_int)
        # Небольшое восстановление Ease Factor при хороших ответах если он был занижен
        new_ef = min(MAXIMUM_EASE_FACTOR, ef + 0.02) if ef < INITIAL_EASE_FACTOR else ef
        if apply_fuzz_flag and new_int >= 3:
            new_int = apply_fuzz(new_int)
        return ('review', new_int, None, new_ef, lapses)
        
    else: # Easy
        due_bonus = min(float(days_since_due), interval * 1.0)
        base_hard = 1 if interval <= 1 else max(interval, round(interval * HARD_MULTIPLIER))
        base_good = max(base_hard + 1, math.ceil((interval + (min(days_since_due / 2, interval * 0.5))) * ef))
        calculated_int = math.ceil((interval + due_bonus) * ef * EASY_MULTIPLIER)
        new_int = max(base_good + 1, calculated_int)
        new_ef = min(MAXIMUM_EASE_FACTOR, ef + 0.15)
        if apply_fuzz_flag and new_int >= 3:
            new_int = apply_fuzz(new_int)
        return ('review', new_int, None, new_ef, lapses)


import datetime
import math

# Константы (синхронизированы с основным приложением Lerne)
INITIAL_EASE_FACTOR = 2.5
MINIMUM_EASE_FACTOR = 1.3
LEARNING_STEPS = [1, 10]  # в минутах
RELEARN_STEPS = [10]      # в минутах
GRADUATING_INTERVAL_GOOD = 1  # дни
GRADUATING_INTERVAL_EASY = 4  # дни

HARD_MULTIPLIER = 1.1 # В lerne/logic/srs_manager.py используется 1.1
EASY_MULTIPLIER = 1.3

def get_next_intervals(progress) -> dict[int, str]:
    """Возвращает текстовые описания следующих интервалов для кнопок."""
    res = {}
    now = datetime.datetime.now()
    for grade in range(4):
        if progress.queue in ['new', 'learning', 'relearning']:
            new_queue, val, _ = _calc_learning_next_state(progress, grade, now)
            is_days = (new_queue == 'review')
        else:
            new_queue, val, _, _, _ = _calc_review_next_state(progress, grade, now)
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
    """Обновляет объект progress на основе оценки."""
    now = datetime.datetime.now()
    
    if progress.queue in ['new', 'learning', 'relearning']:
        new_queue, new_interval, new_step = _calc_learning_next_state(progress, grade, now)
        progress.queue = new_queue
        progress.interval = new_interval
        progress.step_index = new_step
        if new_queue == 'review':
            progress.next_review = now + datetime.timedelta(days=new_interval)
            progress.repetitions += 1
        else:
            progress.next_review = now + datetime.timedelta(minutes=new_interval)
    else:
        new_queue, new_interval, new_step, new_ease, new_lapses = _calc_review_next_state(progress, grade, now)
        progress.queue = new_queue
        progress.interval = new_interval
        progress.step_index = new_step
        progress.ease_factor = new_ease
        progress.lapses = new_lapses
        
        if new_queue == 'relearning':
            progress.next_review = now + datetime.timedelta(minutes=new_interval)
        else:
            progress.next_review = now + datetime.timedelta(days=new_interval)
            progress.repetitions += 1
            
    progress.last_reviewed = now
    progress.updated_at = now
    progress.save()
    return progress.next_review

def _calc_learning_next_state(progress, grade, now):
    steps = LEARNING_STEPS if progress.queue != 'relearning' else RELEARN_STEPS
    step_idx = progress.step_index if progress.step_index is not None else 0
    
    if grade == 0: # Again
        return ('learning' if progress.queue == 'new' else progress.queue, steps[0], 0)
    elif grade == 1: # Hard
        return (progress.queue, steps[step_idx] * 1.5, step_idx)
    elif grade == 2: # Good
        if step_idx + 1 < len(steps):
            return ('learning', steps[step_idx + 1], step_idx + 1)
        else:
            return ('review', GRADUATING_INTERVAL_GOOD, None)
    else: # Easy
        return ('review', GRADUATING_INTERVAL_EASY, None)

def _calc_review_next_state(progress, grade, now):
    interval = progress.interval or 1
    ef = progress.ease_factor
    
    # Расчет задержки (days_since_due)
    days_since_due = 0
    if progress.next_review and progress.next_review < now:
        days_since_due = (now - progress.next_review).days
    
    if grade == 0: # Again
        return ('relearning', RELEARN_STEPS[0], 0, max(MINIMUM_EASE_FACTOR, ef - 0.2), progress.lapses + 1)
    elif grade == 1: # Hard
        # Множитель 1.1 как в lerne/logic/srs_manager.py:246
        new_int = round(max(interval, interval * 1.1))
        return ('review', new_int, None, max(MINIMUM_EASE_FACTOR, ef - 0.15), progress.lapses)
    elif grade == 2: # Good
        # Учет задержки (days_since_due/2) как в lerne/logic/srs_manager.py:252
        new_int = round(max(interval + 1, (interval + days_since_due/2) * ef))
        return ('review', new_int, None, ef, progress.lapses)
    else: # Easy
        # Учет задержки (days_since_due) как в lerne/logic/srs_manager.py:258
        new_int = round(max(interval + 1, (interval + days_since_due) * ef * EASY_MULTIPLIER))
        return ('review', new_int, None, ef + 0.15, progress.lapses)

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
    state0 = (next_queue, steps[0], 0, False) # 1: Again
    state1 = (next_queue, round((steps[0] + hard_int) / 2), 0, False) # 2: ~8m
    state2 = (next_queue, hard_int, step_idx, False) # 3: Hard
    state3 = ('review', 1, None, True) # 4: 1d
    state4 = ('review', GRADUATING_INTERVAL_GOOD, None, True) # 5: Good
    state5 = ('review', 2, None, True) # 6: 2d
    state6 = ('review', GRADUATING_INTERVAL_EASY, None, True) # 7: Easy
    state7 = ('review', max(4, round(GRADUATING_INTERVAL_EASY * 1.6)), None, True) # 8: 5d

    return [state0, state1, state2, state3, state4, state5, state6, state7]

def _get_review_8_states(progress, now, apply_fuzz_flag=False):
    interval = progress.interval or 1
    ef = progress.ease_factor or INITIAL_EASE_FACTOR
    lapses = progress.lapses or 0

    days_since_due = 0
    if progress.next_review and progress.next_review < now:
        days_since_due = (now - progress.next_review).days

    # 1. Base Again (Btn 1)
    ease_penalty = 0.15 if days_since_due > 7 else 0.20
    ef_again = max(MINIMUM_EASE_FACTOR, ef - ease_penalty)
    state0 = ('relearning', RELEARN_STEPS[0], 0, ef_again, lapses + 1, False)

    # 2. Base Hard (Btn 3)
    ef_hard = max(MINIMUM_EASE_FACTOR, ef - 0.15)
    int_hard = 1 if interval <= 1 else max(interval, round(interval * HARD_MULTIPLIER))
    if apply_fuzz_flag and int_hard >= 3:
        int_hard = apply_fuzz(int_hard)
    state2 = ('review', int_hard, None, ef_hard, lapses, True)

    # 3. Base Good (Btn 5)
    due_bonus = min(days_since_due / 2, interval * 0.5)
    base_hard = 1 if interval <= 1 else max(interval, round(interval * HARD_MULTIPLIER))
    calculated_int = math.ceil((interval + due_bonus) * ef)
    int_good = max(base_hard + 1, calculated_int)
    ef_good = min(MAXIMUM_EASE_FACTOR, ef + 0.02) if ef < INITIAL_EASE_FACTOR else ef
    if apply_fuzz_flag and int_good >= 3:
        int_good = apply_fuzz(int_good)
    state4 = ('review', int_good, None, ef_good, lapses, True)

    # 4. Base Easy (Btn 7)
    due_bonus_easy = min(float(days_since_due), interval * 1.0)
    calculated_int_easy = math.ceil((interval + due_bonus_easy) * ef * EASY_MULTIPLIER)
    int_easy = max(int_good + 1, calculated_int_easy)
    ef_easy = min(MAXIMUM_EASE_FACTOR, ef + 0.15)
    if apply_fuzz_flag and int_easy >= 3:
        int_easy = apply_fuzz(int_easy)
    state6 = ('review', int_easy, None, ef_easy, lapses, True)

    # Intermediate states:
    # Btn 2: Between Again and Hard
    int_between_again_hard = max(1, round(int_hard / 2))
    ef_between_again_hard = max(MINIMUM_EASE_FACTOR, ef - 0.18)
    state1 = ('review', int_between_again_hard, None, ef_between_again_hard, lapses + 1, True)

    # Btn 4: Between Hard and Good
    int_between_hard_good = round((int_hard + int_good) / 2)
    if int_between_hard_good <= int_hard:
        int_between_hard_good = int_hard + 1
    if int_between_hard_good >= int_good and int_good > int_hard + 1:
        int_between_hard_good = int_good - 1
    ef_between_hard_good = max(MINIMUM_EASE_FACTOR, ef - 0.06)
    state3 = ('review', int_between_hard_good, None, ef_between_hard_good, lapses, True)

    # Btn 6: Between Good and Easy
    int_between_good_easy = round((int_good + int_easy) / 2)
    if int_between_good_easy <= int_good:
        int_between_good_easy = int_good + 1
    if int_between_good_easy >= int_easy and int_easy > int_good + 1:
        int_between_good_easy = int_easy - 1
    ef_between_good_easy = min(MAXIMUM_EASE_FACTOR, ef + 0.08)
    state5 = ('review', int_between_good_easy, None, ef_between_good_easy, lapses, True)

    # Btn 8: Beyond Easy (Mastery)
    int_super_easy = max(int_easy + 2, round(int_easy * 1.45))
    ef_super_easy = min(MAXIMUM_EASE_FACTOR, ef + 0.22)
    state7 = ('review', int_super_easy, None, ef_super_easy, lapses, True)

    return [state0, state1, state2, state3, state4, state5, state6, state7]

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



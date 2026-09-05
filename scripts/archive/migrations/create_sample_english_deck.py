import os
import sys
import datetime

# Ensure root directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.stdout.reconfigure(encoding='utf-8')

from api.models import initialize_database, TMA_Deck, TMA_Card, TMAUser, Deck, Card

def create_sample_english_deck():
    initialize_database()

    print("--- Creating Sample English Deck for Library & All Users ---")

    cards_data = [
        {
            "front": "available",
            "back": "доступный, имеющийся в наличии",
            "context": "доступный, имеющийся в наличии\n\nГрамматика: Прилагательное. Часто используется с предлогами for (доступен для) или to (доступен кому-то).\n\nПримеры:\n1. This room is available for booking. — Эта комната доступна для бронирования.\n2. He is available to talk right now. — Он свободен для разговора прямо сейчас.\n3. The new feature is available to all members. — Новая функция доступна всем участникам."
        },
        {
            "front": "improve",
            "back": "улучшать, совершенствовать",
            "context": "улучшать, совершенствовать\n\nГрамматика: Глагол. Формы: improve (наст.) / improved (прош.) / improved (прич.). Наречие: significantly (значительно).\n\nПримеры:\n1. I want to improve my English skills. — Я хочу улучшить свои навыки английского.\n2. Practice will help you improve. — Практика поможет тебе усовершенствоваться.\n3. Regular reading improved her vocabulary. — Регулярное чтение улучшило её словарный запас."
        },
        {
            "front": "opportunity",
            "back": "возможность, благоприятный случай",
            "context": "возможность, благоприятный случай\n\nГрамматика: Исчисляемое существительное (мн. ч. opportunities). Часто используется с глаголом take / miss an opportunity.\n\nПримеры:\n1. Don't miss this great opportunity. — Не упусти эту отличную возможность.\n2. Travel gives us opportunities to learn. — Путешествия дают нам возможности учиться.\n3. It was a perfect opportunity to ask questions. — Это была идеальная возможность задать вопросы."
        },
        {
            "front": "convenient",
            "back": "удобный, подходящий",
            "context": "удобный, подходящий\n\nГрамматика: Прилагательное. Описывает удобство по времени или расположению (в отличие от comfortable - удобный для тела).\n\nПримеры:\n1. What time is convenient for you? — Какое время вам удобно?\n2. Living near the station is very convenient. — Жить рядом со станцией очень удобно.\n3. Online courses are fast and convenient. — Онлайн-курсы — это быстро и удобно."
        },
        {
            "front": "essential",
            "back": "существенный, необходимый, важнейший",
            "context": "существенный, необходимый, важнейший\n\nГрамматика: Прилагательное. Синонимы: vital, crucial, necessary. Конструкция: essential for / to.\n\nПримеры:\n1. Water is essential for all living things. — Вода необходима для всего живого.\n2. Good communication is essential in teamwork. — Хорошая коммуникация важна в командной работе.\n3. Sleep is essential for good health. — Сон жизненно необходим для хорошего здоровья."
        },
        {
            "front": "look forward to",
            "back": "ждать с нетерпением",
            "context": "ждать с нетерпением\n\nГрамматика: Фразовый глагол. Требует после себя герундий (глагол с -ing) или существительное.\n\nПримеры:\n1. I look forward to meeting you. — Я с нетерпением жду встречи с вами.\n2. We look forward to the weekend. — Мы с нетерпением ждём выходных.\n3. She looks forward to her vacation. — Она с нетерпением ждёт своего отпуска."
        },
        {
            "front": "make progress",
            "back": "делать успехи, прогрессировать",
            "context": "делать успехи, прогрессировать\n\nГрамматика: Устойчивое выражение с глаголом make (не do!). Существительное progress — неисчисляемое.\n\nПримеры:\n1. You are making great progress in grammar. — Ты делаешь отличные успехи в грамматике.\n2. Every small step helps to make progress. — Каждый маленький шаг помогает прогрессировать.\n3. We made steady progress this month. — В этом месяце мы добились стабильного прогресса."
        },
        {
            "front": "decision",
            "back": "решение",
            "context": "решение\n\nГрамматика: Существительное от глагола decide. Выражение: make a decision (принять решение).\n\nПримеры:\n1. It was a tough decision for him. — Это было трудное решение для него.\n2. Think twice before making a decision. — Подумай дважды перед принятием решения.\n3. Their decision surprised everyone. — Их решение удивило всех."
        },
        {
            "front": "environment",
            "back": "окружающая среда, обстановка",
            "context": "окружающая среда, обстановка\n\nГрамматика: Существительное. Обычно используется с определенным артиклем the environment (природа) или a work environment (рабочая атмосфера).\n\nПримеры:\n1. We must protect the environment. — Мы должны защищать окружающую среду.\n2. A friendly environment helps students learn. — Дружелюбная атмосфера помогает студентам учиться.\n3. They work in a stressful environment. — Они работают в стрессовой обстановке."
        },
        {
            "front": "take responsibility for",
            "back": "брать на себя ответственность за",
            "context": "брать на себя ответственность за\n\nГрамматика: Устойчивая конструкция. Глагол take + существительное responsibility + предлог for.\n\nПримеры:\n1. He took full responsibility for the mistake. — Он взял на себя полную ответственность за ошибку.\n2. Leaders should take responsibility for their team. — Лидеры должны брать ответственность за свою команду.\n3. Are you ready to take responsibility? — Ты готов взять на себя ответственность?"
        }
    ]

    deck_name = "🇬🇧 [A1-A2] 10 Базовых английских слов и фраз"

    # 1. Create in Public Library Table (Deck and Card)
    lib_deck, created = Deck.get_or_create(
        name=deck_name,
        defaults={
            "target_language": "en",
            "is_default": True,
            "level": "A1-A2",
            "topic": "Разговорный словарный запас",
            "created_at": datetime.datetime.now(),
            "updated_at": datetime.datetime.now()
        }
    )
    lib_deck.target_language = "en"
    lib_deck.is_default = True
    lib_deck.save()

    Card.delete().where(Card.deck_id == lib_deck.id).execute()
    for idx, c in enumerate(cards_data):
        Card.create(
            deck_id=lib_deck.id,
            front_text=c["front"],
            back_text=c["back"],
            context=c["context"],
            source='preset',
            position=idx + 1,
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now()
        )
    print(f"[LIBRARY DECK OK] ID={lib_deck.id} Name='{lib_deck.name}' (TargetLang: en)")

    # 2. Add to ALL active users in TMA_User
    users = list(TMAUser.select())
    print(f"Adding deck to {len(users)} users...")
    for u in users:
        tma_deck, d_created = TMA_Deck.get_or_create(
            user_id=u.user_id,
            name=deck_name,
            defaults={
                "target_language": "en",
                "is_pinned": True,
                "created_at": datetime.datetime.now(),
                "updated_at": datetime.datetime.now()
            }
        )
        tma_deck.target_language = "en"
        tma_deck.save()

        TMA_Card.delete().where(TMA_Card.deck_id == tma_deck.id).execute()
        for idx, c in enumerate(cards_data):
            TMA_Card.create(
                deck=tma_deck,
                user_id=u.user_id,
                front_text=c["front"],
                back_text=c["back"],
                context=c["context"],
                source='preset',
                position=idx + 1,
                created_at=datetime.datetime.now(),
                updated_at=datetime.datetime.now()
            )
        print(f"  + Added for User {u.user_id} ({u.first_name})")

    print("--- SUCCESS: English deck seeded globally for ALL users & Public Library! ---")

if __name__ == '__main__':
    create_sample_english_deck()

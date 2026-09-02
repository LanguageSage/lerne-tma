# 🛠️ Справочник инструментов, утилит и API эндпоинтов (Lerne TMA & Lerne UA)

В этой директории (`tools/`) собраны проверенные production-утилиты для обслуживания базы данных, пакетной разметки уровней сложности (CEFR), резервного копирования и интеграции с **Lerne UA**.

---

## 📑 Содержание
1. [Утилиты и скрипты (`tools/`)](#-утилиты-и-скрипты)
   - [`classify_all_cards.py` — Глобальная классификация CEFR](#1-classify_all_cardspy--глобальный-классификатор-базы)
   - [`classify_deck_cli.py` — Разметка отдельной колоды](#2-classify_deck_clipy--разметка-отдельной-колоды)
   - [`backup_database.py` — Полный бэкап базы данных](#3-backup_databasepy--полный-бэкап-базы-данных)
   - [`restore_database.py` — Восстановление из бэкапа](#4-restore_databasepy--восстановление-из-бэкапа)
   - [`test_ai_endpoints.py` — Интеграционные тесты ИИ](#5-test_ai_endpointspy--тестирование-эндпоинтов-ии)
2. [Справочник REST API эндпоинтов](#-справочник-rest-api-эндпоинтов-для-lerne-ua)
   - [`POST /api/cards/classify-batch` — Пакетная разметка CEFR](#1-post-apicardsclassify-batch)
   - [`POST /api/cards/ai-generate-batch` — Пакетная генерация карточек](#2-post-apicardsai-generate-batch)
   - [`POST /api/cards/generate-card` — Одиночная генерация](#3-post-apicardsgenerate-card)
   - [`GET /api/settings/models` — Список доступных моделей ИИ](#4-get-apisettingsmodels)
   - [`POST /api/admin/settings` — Настройки провайдера и ключей](#5-post-apiadminsettings)
3. [Модули промптов и языковые рубрики (DE, EN, NO)](#-модули-промптов-и-языковые-рубрики)

---

## 💻 Утилиты и скрипты

### 1. `classify_all_cards.py` — Глобальный классификатор базы
Глобально размечает уровни сложности (A1–C2) для всех карточек всех пользователей в базе данных.

* **Особенности**:
  * 🧠 **Дедупликация**: находит уникальные фразы и отправляет каждую фразу в ИИ только 1 раз (экономит до 87% токенов).
  * ⚡ **Чекпоинты (`api/data/classification_progress.json`)**: сохраняет прогресс каждой пачки на диск. При перезапуске продолжает с места остановки.
  * ⏱️ **Безопасный таймаут (35с)**: защищает от зависаний при сбоях сети у провайдера ИИ.
  * 💾 **Сверхбыстрая запись (`Bulk UPDATE`)**: обновляет 50 000+ карточек в базе за 2 секунды.
* **Примеры использования**:
  ```bash
  # Разметить только карточки без уровней (по умолчанию Немецкий язык)
  python tools/classify_all_cards.py

  # Разметить карточки для Английского языка
  python tools/classify_all_cards.py --lang en

  # Разметить карточки для Норвежского языка
  python tools/classify_all_cards.py --lang no

  # Принудительно переразметить ВСЮ базу (даже если уровни уже есть)
  python tools/classify_all_cards.py --overwrite

  # Оценить масштаб переразметки без вызовов ИИ и без записи в БД
  python tools/classify_all_cards.py --audit-only --overwrite --lang de

  # То же, но с расширенным немецким словарем
  python tools/classify_all_cards.py --audit-only --overwrite --lang de --vocab-profile medium
  python tools/classify_all_cards.py --audit-only --overwrite --lang de --vocab-profile max

  # Безопасный тестовый прогон без записи в базу (симуляция)
  python tools/classify_all_cards.py --dry-run --limit 30

  # Найти карточки, где локальный немецкий классификатор не уверен, без AI и без записи
  python tools/classify_all_cards.py --audit-only --overwrite --lang de --vocab-profile medium --clear-uncertain-local

  # Удалить A1-C2 у карточек, где локальный классификатор не уверен; остальные теги сохраняются
  python tools/classify_all_cards.py --overwrite --lang de --vocab-profile medium --clear-uncertain-local
  ```

* **Профили немецкого словаря**:
  * `base` — текущий маленький словарь.
  * `medium` — расширенный словарь частотных слов из текущей базы.
  * `max` — `medium` + дополнительные формы частых глаголов и прилагательных.
  * Backend/CLI: `--vocab-profile medium|max`.
  * Frontend/Vite: переменная сборки `VITE_DE_VOCAB_PROFILE=medium` или `VITE_DE_VOCAB_PROFILE=max`.
  * Перегенерация файлов профилей: `python tools/build_de_vocab_profiles.py`.

---

### 2. `classify_deck_cli.py` — Разметка отдельной колоды
Утилита для быстрой разметки конкретной колоды по её числовому ID.

* **Примеры использования**:
  ```bash
  # Разметить колоду с ID 42 (Немецкий)
  python tools/classify_deck_cli.py 42

  # Разметить колоду с ID 15 (Английский)
  python tools/classify_deck_cli.py 15 --lang en

  # Разметить колоду с ID 8 (Норвежский)
  python tools/classify_deck_cli.py 8 --lang no
  ```

---

### 3. `backup_database.py` — Полный бэкап базы данных
Выгружает полный снимок всех таблиц (`TMA_Card`, `TMA_Deck`, `TMA_Folder`, `TMAUser`, `TMASetting`) в форматированный JSON-файл с временной меткой в `api/data/backups/`.

* **Пример запуска**:
  ```bash
  python tools/backup_database.py
  ```
* **Результат**: Файл `api/data/backups/backup_full_YYYYMMDD_HHMMSS.json`.

---

### 4. `restore_database.py` — Восстановление из бэкапа
Восстанавливает карточки, теги и содержимое из указанного JSON-файла резервной копии.

* **Примеры использования**:
  ```bash
  # Симуляция восстановления (проверка файла без записи в БД)
  python tools/restore_database.py api/data/backups/backup_full_20260821_204258.json --dry-run

  # Реальное восстановление данных
  python tools/restore_database.py api/data/backups/backup_full_20260821_204258.json
  ```

---

### 5. `test_ai_endpoints.py` — Тестирование эндпоинтов ИИ
Комплексный интеграционный тест для проверки классификатора CEFR (DE, EN, NO) и эндпоинта `/cards/classify-batch` в изолированной виртуальной БД.

* **Пример запуска**:
  ```bash
  python tools/test_ai_endpoints.py
  ```

---

## 📡 Справочник REST API эндпоинтов (для Lerne UA)

Все эндпоинты работают через протокол HTTP/HTTPS с JSON-телом и заголовком `X-User-ID`.

* **Базовый URL (локально)**: `http://127.0.0.1:8000/api`
* **Базовый URL (сервер)**: `https://<ваш_домен>/api`
* **Обязательные заголовки (Headers)**:
  * `Content-Type: application/json`
  * `X-User-ID: 642478257` *(или Telegram ID пользователя)*

---

### 1. `POST /api/cards/classify-batch`
**Назначение**: Пакетная разметка уровней сложности CEFR (A1–C2) для колоды или списка карточек за 1 запрос.

* **Вариант А: Разметить всю колоду целиком**
  ```json
  POST /api/cards/classify-batch
  {
    "deck_id": 42,
    "target_language": "de"
  }
  ```

* **Вариант Б: Разметить список карточек по их ID**
  ```json
  POST /api/cards/classify-batch
  {
    "card_ids": [101, 102, 103],
    "target_language": "de"
  }
  ```

* **Ответ сервера (200 OK)**:
  ```json
  {
    "status": "ok",
    "updated_count": 3,
    "cards": [
      {
        "id": 101,
        "deck_id": 42,
        "front": "Ich gehe heute nicht zur Arbeit, weil ich Geburtstag habe.",
        "level": "A2",
        "tags": "A2"
      },
      {
        "id": 102,
        "deck_id": 42,
        "front": "Das ist ein Paradigmenwechsel.",
        "level": "C1",
        "tags": "C1"
      }
    ]
  }
  ```

---

### 2. `POST /api/cards/ai-generate-batch`
**Назначение**: Пакетная генерация карточек по двухпроходному конвейеру (генерация карточек + автоматическая расстановка уровней вторым проходом).

* **Тело запроса**:
  ```json
  POST /api/cards/ai-generate-batch
  {
    "text": "Der Hund\nDie Katze\nIch bleibe zu Hause, weil es regnet.",
    "target_language": "de",
    "native_language": "ru",
    "deck_id": 42
  }
  ```

* **Ответ сервера (200 OK)**:
  ```json
  {
    "status": "success",
    "total_requested": 3,
    "generated_count": 3,
    "cards": [
      {
        "front": "Der Hund",
        "back": "собака",
        "context": "📖 **Словарь**:\n• der Hund — собака\n\n💡 **Грамматика**:\nИмя существительное мужского рода...\n\n✨ **Примеры**:\n1. ...",
        "level": "A1"
      }
    ],
    "saved_cards": [...]
  }
  ```

---

### 3. `POST /api/cards/generate-card`
**Назначение**: Одиночная генерация карточки с подробным словарем, грамматикой, 3 примерами и автоопределением CEFR.

* **Тело запроса**:
  ```json
  POST /api/cards/generate-card
  {
    "phrase": "Ich gehe heute nicht zur Arbeit, weil ich Geburtstag habe.",
    "target_language": "de",
    "native_language": "ru"
  }
  ```

* **Ответ сервера (200 OK)**:
  ```json
  {
    "front": "Ich gehe heute nicht zur Arbeit, weil ich Geburtstag habe.",
    "back": "Я сегодня не иду на работу, потому что у меня день рождения.",
    "context": "📖 **Словарь**:\n• gehen — идти\n• die Arbeit — работа\n• weil — потому что\n\n💡 **Грамматика**:\nПридаточное предложение причины с союзом weil (глагол в конце)...\n\n✨ **Примеры**:\n1. ...",
    "level": "A2"
  }
  ```

---

### 4. `GET /api/settings/models`
**Назначение**: Получить список всех доступных моделей ИИ для выбранного провайдера.

* **Параметры URL**: `?provider=google` *(или `groq`, `openrouter`)*
* **Ответ сервера (200 OK)**:
  ```json
  [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-pro"
  ]
  ```

---

### 5. `POST /api/admin/settings`
**Назначение**: Сохранение настроек ИИ (провайдер, модель, API-ключи, тумблер `AI_DETECT_LEVEL`).

* **Тело запроса**:
  ```json
  POST /api/admin/settings
  {
    "AI_PROVIDER": "google",
    "DEFAULT_MODEL": "gemini-2.0-flash",
    "GOOGLE_API_KEY": "AIzaSy...",
    "AI_DETECT_LEVEL": "true"
  }
  ```

---

## 🧠 Модули промптов и языковые рубрики

Все промпты централизованы и легко редактируются в файле:  
👉 [`api/services/language_service.py`](file:///c:/121/Lerne_projekt/tma/api/services/language_service.py)

| Функция в коде | Назначение |
|---|---|
| `get_cefr_rubric(target_language)` | Грамматические и лексические критерии CEFR для **Немецкого (`de`)**, **Английского (`en`)** и **Норвежского (`no`)** |
| `build_card_prompt(...)` | Сборка системного промпта для генерации одиночной карточки |
| `build_rule_explanation_prompt(...)` | Разбор грамматического правила для пропусков `{...}` |
| `get_system_presets(...)` | Пресеты стилей (A2, B1, B2, Тренажёр, Экзамен) |

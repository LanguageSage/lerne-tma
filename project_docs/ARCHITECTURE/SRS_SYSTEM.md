# Архитектура и Руководство: Система Интервального Повторения (SRS SM-2 PRO)

## 1. Обзор архитектуры

В **Lerne TMA** реализована гибридная система интервального повторения (**Spaced Repetition System — SRS**) на базе модифицированного алгоритма **SuperMemo-2 (SM-2 PRO)**.

Система построена по принципу **Dual-Engine (Двойного движка)**:
1. **Серверный движок (Python / FastAPI):** [`api/srs.py`](file:///C:/121/Lerne_projekt/tma/api/srs.py) — рассчитывает интервалы и обновляет состояние в базе данных PostgreSQL (Supabase) при обычном онлайн-изучении.
2. **Клиентский офлайн-движок (JavaScript / Dexie):** [`app/src/utils/srsEngine.js`](file:///C:/121/Lerne_projekt/tma/app/src/utils/srsEngine.js) — полностью зеркалирует математику сервера в браузере (IndexedDB) и в Android-приложении (Capacitor) при отсутствии связи.

---

## 2. Модели данных

### База данных сервера (`TMAProgress` & `TMAReviewHistory` в `models.py`)

```python
class TMAProgress(BaseModel):
    id = AutoField()
    card_id = IntegerField(index=True)      # ID карточки
    user_id = BigIntegerField(index=True)   # Telegram ID пользователя
    queue = CharField(default='new')        # Очередь: 'new', 'learning', 'review', 'relearning'
    interval = IntegerField(default=0)      # Текущий интервал (в минутах для learning, в днях для review)
    ease_factor = FloatField(default=2.5)   # Фактор легкости (множитель SM-2, диапазон: 1.3 - 3.0)
    repetitions = IntegerField(default=0)   # Общее число успешных повторений
    lapses = IntegerField(default=0)        # Количество ошибок (нажатий "Снова")
    step_index = IntegerField(default=0)    # Индекс текущего шага в очереди learning
    next_review = DateTimeField(null=True)  # Дата и время следующего повторения
    last_reviewed = DateTimeField(null=True)# Дата последнего ответа
```

Каждая оценка фиксируется в `TMAReviewHistory` для построения аналитики:
```python
class TMAReviewHistory(BaseModel):
    id = AutoField()
    card_id = IntegerField(index=True)
    user_id = BigIntegerField(index=True)
    rating = IntegerField()                 # 0: Again, 1: Hard, 2: Good, 3: Easy
    review_time = DateTimeField()           # Время ответа
    scheduled_interval = IntegerField()     # Назначенный интервал
```

---

## 3. Фазы жизненного цикла карточки (Queues)

```mermaid
stateDiagram-v2
    [*] --> New: Создание карточки
    New --> Learning: Нажата оценка (0, 1, 2, 3)
    Learning --> Learning: Grade 0 (Again) -> 5 мин\nGrade 1 (Hard) -> 10 мин
    Learning --> Review: Grade 2 (Good) -> 1 дн\nGrade 3 (Easy) -> 3 дн
    Review --> Review: Grade 1, 2, 3 -> Рост интервала (дни)
    Review --> Relearning: Grade 0 (Again) -> 5 мин\nlapses + 1
    Relearning --> Review: Успешное повторение -> 1 дн
```

1. **`new` (Новая):** Карточка создана, но пользователь еще ни разу ее не учил.
2. **`learning` (Первичное изучение):** Шаги `[5 мин, 10 мин]`. Карточка остается в пределах текущей сессии.
3. **`review` (Интервальное повторение):** Карточка выпущена в долговременную память (интервал измеряется в днях).
4. **`relearning` (Переучивание после ошибки):** Шаг `[5 мин]`. Если пользователь забыл карточку из `review`, она возвращается на краткий повтор.

---

## 4. Математика и алгоритмы SM-2 PRO

### Константы
* `INITIAL_EASE_FACTOR = 2.5` (Начальный фактор легкости)
* `MINIMUM_EASE_FACTOR = 1.3` (Минимальный порог легкости)
* `MAXIMUM_EASE_FACTOR = 3.0` (Максимальный порог легкости)
* `HARD_MULTIPLIER = 1.15` (Множитель для оценки "Трудно")
* `EASY_MULTIPLIER = 1.30` (Множитель бонуса для оценки "Легко")
* `LEECH_LAPSE_THRESHOLD = 5` (Порог ошибок для сложных карточек)

---

### Обработка оценок в очереди `review`:

#### 1. Оценка 0: `Again` (Снова)
* **Очередь:** переходит в `relearning` с шагом 5 минут.
* **Счетчик ошибок:** `lapses += 1`.
* **Защита от ловушки сложности (Anti Ease-Hell):**
  * Если карточка была просрочена более чем на 7 дней: штраф `ease_factor -= 0.15` (забывание после долгой паузы естественно).
  * Если повторение было вовремя: `ease_factor -= 0.20`.
  * `ease_factor = max(1.3, ease_factor)`.

#### 2. Оценка 1: `Hard` (Трудно)
* **Интервал:**
  * Для 1-дневной карточки (`interval <= 1`): `new_interval = 1` день (повтор завтра, без неоправданного перескока).
  * Для остальных: `new_interval = max(interval, round(interval * HARD_MULTIPLIER))`.
* **Ease factor:** `ease_factor = max(1.3, ease_factor - 0.15)`.
* Применяется Fuzzing (только для интервалов $\ge 3$ дней).

#### 3. Оценка 2: `Good` (Хорошо)
* **Учет задержки:** `due_bonus = min(days_since_due / 2, interval * 0.5)`.
* **Интервал:** `new_interval = max(hard_interval + 1, math.ceil((interval + due_bonus) * ease_factor))`.
  * *Округление вверх (`math.ceil`)* устраняет коллизию banker's rounding `round(2.5) -> 2`.
  * Строго гарантируется, что `good_interval > hard_interval` (для 1-дневной карточки: `Hard = 1 день`, `Good = 3 дня`).
* **Ease Recovery:** Если `ease_factor < 2.5`, он слегка восстанавливается: `ease_factor = min(3.0, ease_factor + 0.02)`.
* Применяется Fuzzing (для интервалов $\ge 3$ дней).

#### 4. Оценка 3: `Easy` (Легко)
* **Учет задержки:** `due_bonus = min(days_since_due, interval * 1.0)`.
* **Интервал:** `new_interval = max(good_interval + 1, math.ceil((interval + due_bonus) * ease_factor * 1.30))`.
  * Строго гарантируется, что `easy_interval > good_interval` (для 1-дневной карточки: `Easy = 4 дня`).
* **Ease Recovery:** `ease_factor = min(3.0, ease_factor + 0.15)`.
* Применяется Fuzzing (для интервалов $\ge 3$ дней).

---

### 🎨 Трёхцветная система очередей (Anki-Style Tri-Color Queues)

Система классифицирует карточки на 3 понятных потока:
1. 🔵 **Синий (Новые карточки / New):** Карточки, которые еще ни разу не запускались в изучение (`queue == 'new'`).
2. 🔴 **Красный (Срочные к повторению / Due today):** Карточки из долговременной памяти (`queue == 'review'`), чей назначенный интервал истек к сегодняшнему дню (`next_review <= now`).
3. 🟡 **Желтый (На закреплении / Learning):** Карточки, находящиеся в краткосрочных шагах текущего урока (`queue in ['learning', 'relearning']`).

#### Где это отображается:
* **В Telegram-боте:** подробный отчёт с ярлыками изучаемых колод и раскладкой по цветам 🔴 🟡 🔵.
* **На карточке в режиме обучения (`StudyCard.jsx`):** верхний бейдж текущего статуса (например, 🔴 *К повторению сегодня (день 1)* или 🔵 *Новая карточка*).
* **В нижней панели под карточкой (`StudyView.jsx`):** живой Anki-счетчик оставшихся карточек в текущей колоде (`🔵 X` `🔴 Y` `🟡 Z`), обновляющийся в реальном времени.

---

### 🎲 Размытие интервалов (Fuzzing)

Для предотвращения «лавин повторений» (когда десятки выученных в один день карточек возвращаются одновременно) при сохранении оценки добавляется случайный сдвиг:

| Интервал (дней) | Алгоритм сдвига | Диапазон результата |
| :--- | :--- | :--- |
| **$< 3$ дней** | Без размытия | Точно 1 или 2 дня |
| **$3 .. 7$ дней** | Сдвиг на $\pm 1$ день случайно: `random.choice([-1, 0, 1])` | $2 .. 8$ дней |
| **$8 .. 30$ дней** | Сдвиг на $\pm 10\%$ (минимум $\pm 1$ день) | Пример для 14 дн: $13 .. 15$ дн |
| **$> 30$ дней** | Сдвиг на $\pm 5\%$ (минимум $\pm 2$ дня) | Пример для 60 дн: $57 .. 63$ дн |

> **Примечание:** На кнопках интерфейса отображается стабильное базовое превью интервала, а случайный Fuzz применяется только в момент записи в БД.

---

### ⚠️ Детекция «Личей» (Leech Detection)

Если пользователь допустил на карточке 5 или более ошибок (`lapses >= 5`):
* Сервер и клиент возвращают `is_leech: true`.
* В интерфейсе карточки (`StudyCard.jsx`) отображается предупреждающий бейдж ⚠️ **«Сложная карточка (X ошибок)»**.
* Пользователю дается визуальный сигнал переформулировать карточку, добавить контекст или мнемонику.

---

## 5. Офлайн-режим и Синхронизация

1. **Локальное хранилище (Dexie.js / IndexedDB):**
   * Таблица `progress` с композитным ключом `[card_id+user_id]`.
   * При выставлении оценки без сети [`offlineApi.js`](file:///C:/121/Lerne_projekt/tma/app/src/services/offlineApi.js) перехватывает запрос и вызывает [`srsEngine.js`](file:///C:/121/Lerne_projekt/tma/app/src/utils/srsEngine.js).
   * Запись сохраняется в IndexedDB с флагом `is_dirty: 1`.
2. **Автоматическая синхронизация ([`syncService.js`](file:///C:/121/Lerne_projekt/tma/app/src/services/syncService.js)):**
   * При восстановлении соединения `is_dirty` записи и события оценок `review:*` из существующей таблицы Dexie `syncState` отправляются в устойчивом пакете `POST /sync/v2/push`.
   * Сервер атомарно сохраняет итоговый progress и `TMAReviewHistory`, без повторного расчёта SRS. Квитанция `request_id` защищает от повторного применения пакета; `review_count` подтверждает сохранение оценок.
   * После подтверждения клиент удаляет только отправленные события, обновляет временные ID и получает снимок через `GET /sync/v2/pull`.

### Завершение занятия и принудительный проход (Study completion / forced review)

Обычное открытие колоды по-прежнему ведёт в список карточек. Завершение занятия не сбрасывает progress:

- `StudyFinished.jsx` показывает завершение колоды/темы, переход к следующей обычной колоде текущей папки и повторение текущей. Если обычный SRS сразу вернул `finished`, показывается «На сегодня всё выполнено» и ближайшая дата из имеющихся карточек.
- Следующая колода определяется в `utils/studyFlow.js`: общая с DeckGrid видимость, только `folder_id` текущей колоды, уже отсортированный порядок store. Запуск следующей колоды и повторение используют `useStudyNavigation.startStudy`.
- `StudyError.jsx` отображается отдельно от успеха и позволяет повторить загрузку. `returnToStudyTheme` в `utils/navigation.js` останавливает autoplay, сбрасывает сессию и открывает `decks` с папкой текущей колоды. Для root deck текст — «К колодам», для колоды в папке — «К колодам темы»; остановка аудио выполняется обработчиком в `StudyView`.
- Повторение запускает ту же учебную сессию с `review_context=forced` (`isLearningMore` — существующее внутреннее состояние). `useSessionStore.forcedSeenIds` передаётся через `useStudySession` как `exclude_ids` в запросы выбора и оценки.
- В forced-проходе серверный `api/services/cards.py:get_next_card` и локальный `offlineApi.js:nextCard` выбирают неудалённые карточки строго по `position`, затем по `id` при одинаковой позиции. Queue и `next_review` не влияют на порядок. Исключённые карточки не возвращаются; после обхода занятие заканчивается. Совместимый `learn_more` также использует этот порядок.
- Оценки сохраняются в обычный progress и историю. `review_context` передаётся в оба существующих SRS-движка и в прогноз интервалов кнопок. Ранний forced review учитывает прошедшую долю срока; scheduled review сохраняет прежнюю формулу. «Снова» сохраняет relearning и ближайшее повторение для следующего обычного занятия.
- SRS-бейдж формируется в `StudyView.jsx:currentCardSrsStatus`. Для forced-сессии с `queue=review` и будущим `next_review` показывается «↻ Дополнительное повторение» с пояснением раннего показа. Плановое due review сохраняет красный бейдж «К повторению».

Это расширение существующих компонентов, сессии и sync v2, без отдельного progress и без новой SRS-системы. Новые модули предыдущего изменения: `StudyError.jsx`, `utils/studyFlow.js`; отдельное поле context в PostgreSQL и миграция БД не добавлялись. Регрессии находятся в `scripts/tests/test_forced_study.py`, `scripts/tests/browser/study-finished.spec.cjs`, `scripts/tests/browser/offline.spec.cjs`, `app/src/utils/__tests__/studyFlow.test.js` и `srsEngine.test.js`.

---

## 6. Пользовательский интерфейс и Аналитика

1. **Экран обучения (`StudyCard.jsx` & `GradeButtons.jsx`):**
   * Динамическое отображение прогнозируемых интервалов на 4 кнопках (`5 мин`, `10 мин`, `1 дн`, `3 дн`, `12 дн`, `1.5 мес`).
   * Индикатор сложных карточек (Leech Badge).
2. **Модальное окно аналитики SRS (`SrsStatsModal.jsx`):**
   * Доступно в профиле пользователя (`ProfileTab.jsx`).
   * **Retention Rate (30 дней):** процент успешных ответов (*Good + Easy*) из `TMAReviewHistory`.
   * **Зрелость памяти:**
     * 🌟 **Освоены (Mature):** интервал $\ge 21$ день (золотой цвет).
     * 🟩 **Закрепляются (Young):** интервал $< 21$ день (зеленый цвет).
     * 🟦 **В процессе (Learning):** фаза обучения (синий цвет).
     * ⬜ **Новые (New):** еще не начаты (серый цвет).
     * 🟧 **Сложные (Leech):** $\ge 5$ ошибок (красный цвет).
   * **Прогноз повторений на 7 дней:** столбчатая диаграмма распределения нагрузки по дням недели.

---

## 7. Файловая карта компонентов SRS

| Файл | Назначение |
| :--- | :--- |
| [`api/srs.py`](file:///C:/121/Lerne_projekt/tma/api/srs.py) | Серверное ядро SM-2 PRO: формулы, Fuzzing, Leech check, интервалы |
| [`api/routers/study.py`](file:///C:/121/Lerne_projekt/tma/api/routers/study.py) | Эндпоинты `/study/card/:id`, `/study/grade`, `/study/stats` |
| [`api/services/cards.py`](file:///C:/121/Lerne_projekt/tma/api/services/cards.py) | Выбор следующей карточки по SRS-очереди, форматирование |
| [`api/services/study.py`](../../api/services/study.py) | Атомарное обновление progress и истории оценки с review_context |
| [`app/src/hooks/useStudySession.js`](../../app/src/hooks/useStudySession.js) | Запросы выбора/оценки, context и forcedSeenIds → exclude_ids |
| [`app/src/hooks/useStudyNavigation.js`](../../app/src/hooks/useStudyNavigation.js) | Общий startStudy для обычного запуска, следующей колоды и forced review |
| [`app/src/store/useSessionStore.js`](../../app/src/store/useSessionStore.js) | История сессии, isLearningMore и forcedSeenIds |
| [`app/src/components/study/StudyView.jsx`](../../app/src/components/study/StudyView.jsx) | Переключение карточки/успеха/ошибки, бейдж раннего forced review |
| [`app/src/components/study/StudyFinished.jsx`](../../app/src/components/study/StudyFinished.jsx) | Следующие действия после завершения и подпись возврата по folder_id |
| [`app/src/components/study/StudyError.jsx`](../../app/src/components/study/StudyError.jsx) | Отдельное состояние ошибки с retry и возвратом |
| [`app/src/utils/studyFlow.js`](../../app/src/utils/studyFlow.js) | Общая видимость колод с DeckGrid, следующая/последняя колода темы |
| [`app/src/utils/navigation.js`](../../app/src/utils/navigation.js) | Прямой returnToStudyTheme, отдельно от обычного navigateUp |
| [`app/src/utils/srsEngine.js`](file:///C:/121/Lerne_projekt/tma/app/src/utils/srsEngine.js) | Офлайн клиентское ядро SM-2 PRO (зеркало Python-логики) |
| [`app/src/services/offlineApi.js`](file:///C:/121/Lerne_projekt/tma/app/src/services/offlineApi.js) | Офлайн-обработчик оценок и локальной аналитики из IndexedDB |
| [`app/src/services/syncService.js`](../../app/src/services/syncService.js), [`api/services/offline_sync.py`](../../api/services/offline_sync.py) | Устойчивый пакет progress + reviews, квитанция, remap ID и подтверждение истории |
| [`app/src/components/study/StudyCard.jsx`](file:///C:/121/Lerne_projekt/tma/app/src/components/study/StudyCard.jsx) | Карточка с отображением Leech-бейджа и медиа |
| [`app/src/components/study/GradeButtons.jsx`](file:///C:/121/Lerne_projekt/tma/app/src/components/study/GradeButtons.jsx) | Кнопки 4 оценок с интервалами |
| [`app/src/components/study/SrsStatsModal.jsx`](file:///C:/121/Lerne_projekt/tma/app/src/components/study/SrsStatsModal.jsx) | Модальное окно SRS-аналитики (Retention Rate, прогноз 7 дней) |
| [`app/src/components/settings/ProfileTab.jsx`](file:///C:/121/Lerne_projekt/tma/app/src/components/settings/ProfileTab.jsx) | Точка входа в аналитику SRS в профиле |
| [`api/scratch/test_srs_engine.py`](file:///C:/121/Lerne_projekt/tma/api/scratch/test_srs_engine.py) | Unit-тесты для автоматической проверки математики алгоритма |

# Отчёт по реализации KI-03: Knowledge Attempts API & Batch Sync Contract

## 1. Инвентаризация
- **Backend router conventions:** API-роутеры подключаются в `api/main.py`. Существующие роутеры (например, `sync.py`) используют префикс `/api`. Я создал новый роутер `api/routers/knowledge.py` и подключил его.
- **Auth mechanism:** Проект использует FastAPI-зависимость `get_user_id` из `api.dependencies.auth`, которая парсит токены и возвращает `user_id` аутентифицированного пользователя.
- **API client & Sync:** На клиенте используется `api.js` (оболочка над axios с interceptor'ами авторизации). Существуют `offlineApi.js` и `syncService.js`, но чтобы не смешивать логику карточек и Knowledge Layer, я создал выделенный `knowledgeSyncService.js`.

## 2. API Contract
Создан endpoint `POST /api/knowledge/attempts/sync`.
**Batch Limit:** Максимум 100 событий в одном запросе (настроено через `max_length=100` в Pydantic).

**Request Schema:**
```json
{
  "attempts": [
    {
      "client_event_id": "string",
      "knowledge_item_id": 123,
      "card_id": 456, // optional
      "event_time": "2026-09-27T18:00:00Z", // optional
      "evaluation_data": {"score": 1}, // optional
      "review_id": 789 // optional
    }
  ]
}
```
**Response Schema (Per-event results):**
```json
{
  "results": [
    {
      "client_event_id": "string",
      "status": "created | duplicate | event_conflict | rejected",
      "error_code": "string" // optional
    }
  ]
}
```

## 3. Security
Поле `user_id` намеренно **отсутствует** в `KnowledgeAttemptSyncItem`.
Клиент физически не может передать `user_id` в запросе. Сервер использует исключительно значение `Depends(get_user_id)`. Это гарантирует, что пользователь может записать попытку только от своего имени.
Поля `mastery`, `owner_id` и другие недоверенные данные также отсутствуют в схеме запроса.

## 4. Idempotency
Уникальность обеспечивается на уровне БД `(user_id, client_event_id)`. При дублировании происходит `IntegrityError`, после чего сервер анализирует конфликт:
- **new (успех):** запись создаётся, возвращается `created`.
- **duplicate identical:** сервер сравнивает доменные поля (`knowledge_item_id`, `card_id`, `evaluation_data`). Если они идентичны — это просто повторная доставка. Возвращается `duplicate` (клиент его удалит).
- **duplicate conflicting:** если доменные поля различаются, значит кто-то пытается переписать историю. Возвращается `event_conflict` (клиент пометит его как `failed` навсегда).

## 5. Transaction strategy
Batch обрабатывается **независимо для каждого элемента**. 
Внутри цикла по событиям открывается атомарный контекст Peewee (`with models.tma_db.atomic()`). Таким образом:
- Если один attempt падает с ошибкой валидации или конфликтом, остальные продолжают обрабатываться и успешно сохраняются.
- HTTP-статус батча остаётся 200 OK (если нет структурных ошибок), а ошибки распределяются точечно внутри массива `results`.

## 6. Frontend Sync Lifecycle
Реализован метод `syncKnowledgeAttempts(userId)`.
1. **pending → syncing:** выбирает до 100 pending событий и переводит их в `syncing`.
2. Если HTTP `error < 500` (например 400 Bad Request из-за инвалидного JSON) — весь batch помечается `failed`, так как это перманентная ошибка клиента.
3. Если HTTP `error >= 500` или Network Error — события возвращаются в `pending`, чтобы быть отправленными снова.
4. **Per-event processing:**
   - `created` или `duplicate` → `delete` из локальной IndexedDB.
   - `rejected` или `event_conflict` → `failed` (событие остаётся для аудита, но больше не отправляется).

## 7. Изменённые файлы
- `api/routers/knowledge.py` — Создан. Содержит логику валидации, проверки дубликатов, Pydantic-схемы и роутер.
- `api/main.py` — Изменён. Добавлен импорт и подключение `app.include_router(knowledge.router, ...)`.
- `app/src/services/knowledgeSyncService.js` — Создан. Фронтенд-сервис для чтения очереди и вызова API.
- `app/src/services/__tests__/knowledgeSyncService.test.js` — Создан. Unit-тесты фронтенда (настроены через dynamic imports для работы `mock.module`).
- `tests/test_knowledge_sync.py` — Создан. Интеграционные тесты API.

## 8. Tests
- **Backend (Python `unittest`):** 7 тестов (`Test 1` create, `Test 2` idempotent, `Test 3` conflicting, `Test 4` user isolation, `Test 6` invalid KI, `Test 7` partial batch, `Test 8` oversized batch). 
  - *Результат:* 7 passed, 0 failed.
- **Frontend (Node `node:test`):** 5 тестов (`Test A` pending->created->deleted, `Test B` duplicate->deleted, `Test C` rejection->failed, `Test D` network error->pending, `Test E` partial batch). 
  - *Результат:* 5 passed, 0 failed.

## 9. Lint/build
- `npm run lint` — пройдено без ошибок.
- `npm run build` — сборка Vite завершена успешно.

## 10. Отклонения от плана
- Явно не потребовалось проверять `TMACardKnowledgeItem` (ограничение #11 из плана), так как `card_id` помечен опциональным. Knowledge Attempt может исходить не только от карточек (согласно вашему комментарию), поэтому сервер не блокирует attempt, если связь карточка-KI отсутствует (если `card_id` передан как None или связь слабая). Проверяется только физическое существование `knowledge_item_id`.
- Для запуска тестов фронтенда с `mock.module` на Node ESM пришлось обернуть импорты сервисов в `await import(...)`, так как статические импорты поднимаются до вызова мока, что мешало изолировать `api.js`. Это сделано исключительно внутри тестового файла и не влияет на production.

## 11. Риски для следующего этапа (KI-04/05)
- На фронтенде очередь (outbox) пока никак не вызывается автоматически, что отлично для изоляции. Но в будущем нужно будет продумать, будет ли `syncKnowledgeAttempts` вызываться по таймеру, при `online` event браузера, или в конце study-сессии.
- Пока `TMAUserKnowledgeState` не трогается, но при интеграции расчёта Mastery серверу придётся асинхронно или в фоне пересчитывать Knowledge State после сохранения Attempt'ов, чтобы не замедлять `/sync` эндпоинт.

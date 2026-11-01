# Lerne Adaptive: первый технический шаг

Продолжение: [реальный HTTP/PostgreSQL прогон](LERNE_ADAPTIVE_HTTP_POSTGRES.md) —
30.10.2026, все шесть запрошенных сценариев прошли на одноразовой PostgreSQL 17.11.
Ниже сохранены результаты и границы исходного изолированного этапа.

Локальная проверка от 30.10.2026. Основание: [архитектурный эскиз v0.1](https://docs.google.com/document/d/1gzspudxpSZicPtJSX51-pMkLIijdSj57UGYg15NBF2U/edit).
Архитектурных противоречий для этого патча не обнаружено. Новый алгоритм оценки,
планировщик, схема данных и разметка материалов не вводятся.

## Проверенный путь

1. `useStudyNavigation` подготавливает KI и primary/secondary mappings для обычной
   колоды и открытия отдельной карточки через `knowledgeContentService`.
   Assessment использует тот же загрузчик. В сети обновляется кэш текущего
   аккаунта; без сети сохраняется существующий. Ошибка Knowledge не прерывает
   обычное обучение.
2. `useStudySession.submitGrade` передаёт оценку существующему `/study/grade`.
   Сервер атомарно сохраняет SRS progress/review. Offline API сохраняет локальные
   progress и review в Dexie для отдельного entity sync.
3. Только подтверждённая оценка вызывает `captureStudyKnowledgeAttempt`.
   Capture использует primary mapping и существующий KI: self-rating остаётся
   schema v1, exercise evidence — hybrid schema v2. Без mapping или самого KI
   Attempt отсутствует; отсутствие evidence не означает нулевое mastery.
4. Durable `knowledge_attempt_outbox` отправляется отдельным Knowledge Sync,
   независимо от `/sync/v2/*`. Перед отправкой проверяется аккаунт, запрос
   закреплён через существующий `_expectedUserId` auth interceptor. Все операции
   batch обращаются к исходной Dexie-базе, включая поздний ответ после смены
   пользователя.
5. `/knowledge/attempts/sync` проверяет существование KI, активную карточку,
   доступ к её активной колоде и точную primary-связь. Если передан review, он
   должен принадлежать тому же пользователю и карточке. Эти проверки действуют
   для self-rating/hybrid и assessment. Новые события без карточки отклоняются;
   существующие клиенты capture всегда передают card_id.
6. В одной серверной транзакции создаётся raw Attempt и обновляется существующая
   проекция `mastery-v1`. Идентичный повтор подтверждается без изменения проекции,
   в том числе после снятия mapping или доступа. Изменённый payload с тем же
   client_event_id получает `event_conflict`.
7. Клиент удаляет только подтверждённые IDs отправленного batch. Отсутствующий
   результат возвращается в pending; неожиданный ID не затрагивает другие записи.
   Logout с закрытием исходной базы сохраняет durable событие в syncing для
   существующего stale recovery при следующем входе, затем duplicate безопасно
   подтверждает принятую сервером запись.

## Исправленные причины

- В обычных `startStudy` / `startStudyCard` отсутствовала загрузка Knowledge.
- Upsert mappings оставлял прежний primary при remapping/unmapping. Загрузчик
  теперь атомарно заменяет связи карточек колоды. Ответ API дополнен `card_ids`
  активных карточек, включая неразмеченные; поддерживается и старый ответ.
- Обычные Attempts обходили проверки доступа и primary mapping; проверка review
  учитывала пользователя, но не соответствие карточке.
- Асинхронные операции outbox могли после смены аккаунта обратиться к новой базе
  и удалить/изменить чужое событие с совпадающим ID.
- Неполный sync response оставлял события в syncing; неожиданные IDs могли
  затронуть записи вне отправленного batch.

## Локальные доказательства и границы

Адресные клиентские проверки: `knowledgeFlow`, `knowledgeCaptureService`,
`knowledgeDbService`, `knowledgeSyncService`, `knowledgeSyncOrchestrator`,
`knowledgeDiagnosticsService`. Сервер: `test_knowledge_sync`,
`test_knowledge_mastery`, `test_knowledge_diagnostics`, `test_knowledge_item_schema`,
`test_study_latency`, `test_forced_study` через изолированный backend runner.
Браузер: полный `study-latency.spec.cjs`, включая пять новых Knowledge-сценариев.
Результат: 58 клиентских, 66 серверных и 31 браузерный тест прошли. ESLint
затронутых JS-файлов, Python compilation и локальная сборка Vite прошли; сборка
сохранила предупреждения о крупных chunks и смешанных dynamic/static imports.
Данные синтетические; внешняя сеть backend/Node проверок блокируется, browser API
изолирован mocks. Логи сравнения с исходным кодом: `local/test-data/knowledge-baseline/`.

На исходном коде воспроизведены отсутствие Attempt при cold-cache study,
недостаточные серверные проверки и нарушения обработки очереди при смене аккаунта
и частичном ответе. Исправленная версия проходит эти регрессии.

Это проверка реальных hooks/services, Dexie, routers и mastery engine по слоям,
а не единый browser → HTTP backend → PostgreSQL E2E. PostgreSQL advisory locks,
нагрузочная конкурентность, Android/native runtime и deployed startup не
проверялись. Состояние production и фактическое покрытие карточек KI в этой работе
не читались. Существующие self-rating/hybrid результаты остаются клиентскими
сигналами: проверка происхождения не заменяет серверную проверку правильности
самого ответа. SRS, форматы карточек V2 и формула mastery-v1 не изменены.
Миграции рабочих БД, массовая разметка и публикация не выполнялись.

## Следующий этап

1. Проверить HTTP-контур и конкурентную идемпотентность на одноразовой локальной
   PostgreSQL с синтетической колодой; отдельно проверить native/offline runtime.
2. Согласовать стабильные skill keys и правила primary/secondary mapping для
   небольшого каталога двух тем, без массового изменения карточек.
3. Уточнить достоверность/свежесть evidence и границы self-rating, objective
   assessment и будущей самооценки. До этого mastery-v1 не использовать для
   автоматического пропуска тем или нового адаптивного маршрута.

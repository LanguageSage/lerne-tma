# SQL-чтение синхронизации TMA — 20 октября 2026

Сравнение с `97306fc9257defadee3c5cd51ee0184826383e61` на одной изолированной
SQLite в памяти. Production Supabase не запрашивался, миграции не запускались.
Полный SQL и остальные пользователи: [sync-sql-read-comparison.json](sync-sql-read-comparison.json).

## Метод

Реальные Peewee models/services и HTTP routes; внешние соединения, `.env` и
инициализация production БД блокируются `scripts/test_backend.py`.
Старые версии трёх сервисов загружаются через `git show`, без смены checkout.
Обе реализации читают одни и те же строки; каждый push откатывается savepoint,
чтобы следующий запуск получил исходные данные.

Fixture: 4 пользователя, 12 колод, 48 карточек; у каждой карточки 1 МиБ
детерминированных псевдослучайных бинарных данных. Есть вложенные shared folders,
editor/viewer, прямой доступ к колоде, public readonly, чужие private records,
удалённые карточки/колоды/папки, прогресс нескольких пользователей и learning settings.
Пользователь 1 получает 40 карточек в v2, 28 в legacy, 36 в collab-pull.

Счётчик оборачивает cursor.fetch* и суммирует **фактически полученные значения**:
длину бинарных данных и UTF-8 представления остальных ненулевых значений.
Это логический объём результатов SQL, а не сетевые пакеты PostgreSQL, физические
страницы, TOAST I/O или скорость Supabase. PostgreSQL здесь не установлен;
дополнительно проверена компиляция проекций карточек для PostgreSQL без соединения.
Измерения времени намеренно не используются как доказательство ускорения production.

## Результаты

Число SELECT и байты включают всю цепочку вызова, в collab-pull также
`get_access_version` из router.

| Сценарий | SELECT до → после | Байты до → после | Сокращение объёма |
| --- | ---: | ---: | ---: |
| `/sync/v2/pull`, user 1 | 18 → 15 | 41 954 152 → 8 441 | 99,980% |
| `/sync/pull`, user 1 | 5 → 5 | 29 367 892 → 6 081 | 99,979% |
| `/sync/collab-pull`, user 1 | 21 → 10 | 37 760 933 → 2 610 | 99,993% |
| v2 push: 4 правки карточек | 29 → 17 | 4 196 856 → 68 | 99,998% |
| Legacy push: 4 правки карточек | 27 → 23 | 8 391 495 → 352 | 99,996% |
| v2 study: 4 progress + 12 reviews | 213 → 18 | 16 789 780 → 352 | 99,998% |
| Legacy study: 4 progress | 57 → 16 | 4 197 925 → 349 | 99,992% |

До правки Peewee выбирал все 26 полей `tma_card`, включая `image_data`, `history`,
`difficulty`, `topics`, `source`, deprecated card annotations и прочие неиспользуемые поля.
После: v2 — 17 полей сериализатора, legacy pull — 14, collab-pull — 13;
legacy push читает 8 полей для timestamp/media merge, study — только `id, deck_id`.
В v2 push lookup существующей карточки также читает только `id, deck_id`;
`save(only=...)` записывает поля пакета, сохраняя неизбранные бинарные данные и контент.

Дерево активных папок читается одной узкой проекцией на pull и передаётся
access helpers и batch role serializer. Повторные обходы collab-pull используют
эту карту. Legacy push переиспользует bulk lookup карточек при проверке прав
и обновлении. Progress/reviews в обоих протоколах читают ссылки на карточки
пакетом после канонических изменений; права на учебный доступ проверяются
один раз для каждой колоды в этой фазе транзакции.
Разбор deck metadata для `is_learning` отключает разрешение media URLs: snapshot
возвращает raw metadata и не нуждается в отдельных TMAMedia lookup на каждый ресурс.

## Проверки и воспроизведение

```powershell
python scripts/test_backend.py scripts/tests/test_sync_read_queries.py --compare-ref 97306fc9257defadee3c5cd51ee0184826383e61
python scripts/test_backend.py
python -m py_compile api/services/offline_sync.py api/services/sync_service.py api/services/collaborative_service.py api/services/utils.py scripts/tests/test_sync_read_queries.py scripts/test_backend.py
```

Сравнены полные pull-ответы трёх маршрутов для четырёх пользователей, исключая
изменяющийся `server_time`, и ответы четырёх сценариев push.
Проверены HTTP-контракты, отсутствие `image_data/history` во всех SELECT цепочки,
постоянное число запросов при добавлении карточек и папок, batch study lookup,
viewer study/edit permissions, media merge/removal и сохранность неизбранных полей.
Старый код на той же fixture действительно читает `image_data`; сравнение не
подменяет карточки объектами без бинарного поля.
Существующие offline/material-permissions suites покрывают retry, rollback,
отрицательные ID, owner restore, published maintenance policy и права editor/viewer.
Итог: полный изолированный backend runner — 260 тестов в 20 suites, PASS;
сравнение с baseline — 9 тестов, PASS; `py_compile` изменённых Python-файлов — PASS.

## Оставшиеся проблемы и границы

- Существующая ошибка `/sync/collab-pull`: изменённая чужая папка вызывает 500,
  потому что serializer читает `f.is_pinned`, а у `TMA_Folder` такого поля нет.
  Воспроизведена на старом и новом коде, status/detail совпадают. Для успешного
  замера shared/public folders имеют `updated_at` раньше `since`; изменения
  карточек и колод попадают в ответ. Исправление ошибки требует отдельной правки поведения.
- Существующая фильтрация удалений collab-pull сохранена: удалённые shared decks
  исключаются при вычислении доступных IDs. Tombstones владельца в v2 сохранены.
- V2 остаётся полным snapshot. Дерево доступа всё ещё читает активные папки всех
  пользователей, а большие списки IDs и полный набор доступных карточек остаются
  потенциальной нагрузкой. Инкрементальный протокол не вводился.
- Push всё ещё делает отдельные проверки прав при правках сущностей и отдельные
  чтения/записи progress/receipt. Устранены тяжёлые binary reads и повторные
  card/access lookups в study-фазе; полной пакетной перезаписи push не проводилось.
- Реальный PostgreSQL query plan, физический I/O, сеть и конкурентные изменения
  прав между SQL statements этим SQLite-набором не измеряются.

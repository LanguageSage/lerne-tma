# Lerne Game Mode — подготовка интеграции MVP 3

Дата: 12 октября 2026. Работа выполнена в отдельном managed worktree
`C:/Users/Aruna/.codex/worktrees/game-mode-integration/tma`.
Это подготовка изолированного сборщика и API, а не разрешение включить MVP 3 в рабочем Lerne.
Commit, push, рабочие миграции, запуск действующего backend и доступ к микрофону не выполнялись.

## 1. Исходные рабочие копии и сохранность изменений

| Копия | HEAD | Состояние перед работой |
| --- | --- | --- |
| `C:/121/Lerne_projekt/tma`, `feat/game-mode-mvp1` | `ff95311ee5fce3779d770c9a8577402ccb967b6b` | Чистая; последние исправления MVP 2 и голосового цикла |
| `C:/Users/Aruna/.codex/worktrees/game-mode-mvp3/tma`, `codex/game-mode-mvp3` | `10efe3a7cadd89c5eb64af95c9c904a2406e35d8` | 3 изменённых документа в `.agents`, 13 новых файлов; MVP 3 ещё не закоммичен |

Интеграционный worktree создан от актуального `ff95311`, затем скопированы новые
MVP 3 файлы. Незакоммиченные изменения не терялись и не заменялись checkout/reset/stash.
Все 16 исходных файлов сохранены в `project_docs/mvp3_source_snapshot` с SHA-256
в `manifest.json`. Исходные документы `.agents` сохранены в снимке; документы новой
копии обновлены поверх актуального MVP 2, чтобы не затереть описание последних voice fixes.
Ни одна из двух исходных копий не использована как место интеграционных правок.
Итоговая сверка: HEAD обеих копий сохранён, все 16 исходных файлов совпадают со снимком.
В основной копии во время работы появились новые файлы
`lerne-card-prompts/B1-11_Verben_mit_Praepositionen/B1-11-D01_Verben_mit_Praepositionen.txt`
и `B1-11-D02_Verben_mit_Praepositionen.txt`; агент их не изменял, не удалял и не переносил.

## 2. Подготовленные изменения и контракты

- Перенесены оригинальные каталоги, модели, память, прогресс и приватность MVP 3.
- `api/game_mvp3/flags.py`: серверный выключенный по умолчанию pilot для одного account ID.
- `api/game_mvp3/integration.py`: сбор только реальных завершённых событий движка.
- `game_service.start_attempt`: opt-in только на новой попытке; существующие попытки не переобрабатываются.
- `game_service.finish_turn`: события, память и результат пишутся в той же транзакции, что игровая версия.
- Ошибка новой записи откатывает завершение хода, не оставляя игровой успех без его свидетельств;
  исходный draft/request ID можно повторить. Резервация AI budget остаётся поведением MVP 2.
- Идентификатор события состоит из UUID попытки и реального `request_id`; уникальны также попытка/версия.
- Завершение коммуникативной задачи — первый настоящий `borrowed`, а не конец знакомства с NPC.
  После этого свободный диалог продолжается; сохранённый результат не переписывается поздними репликами.
- HTTP Game, TurnRequest, сериализованный ответ, scene, каталог и engine verdict остаются совместимыми.
  Клиент по-прежнему не может прислать outcome, user ID, skill evidence или modality.
- `/api/game-foundation` подключён только при isolated mode; все endpoints дополнительно требуют
  strict Bearer v2, выбранного pilot account и ownership. Клиентской записи evidence нет.
- Добавлены GET `/api/game-foundation/attempts/{id}/events` и DELETE
  `/api/game-foundation/data?include_source_attempts=false`.

`GameView`, `useGameVoice`, `useAudio`, STT/TTS, media services, NPC prompt и dialogue
service не изменены. Новых AI-вызовов и зависимостей нет. Память доступна как компактный
`relevant()`-контекст, но этот контекст пока не подключён к промпту NPC. Classic, SRS,
Knowledge и Dexie не получают новых записей и не используются для фиктивного прогресса Game.

## 3. Достоверность событий

| Что наблюдается | Что сохраняется | Что нельзя заключить |
| --- | --- | --- |
| Серверная библиотечная задача | Versioned task/rubric snapshot, situation ID | Что каждая светская реплика выполняла задачу |
| Engine предложил/выдал доступную книгу | Event ID, version, book ID; success/partial из engine | Грамматическая правильность, speaking/listening |
| Реальная кнопка hint | hint_count и support code `example_request`/`confirm_offer` | Полный объём любой использованной помощи |
| Запрос simplify/slow/repeat принят engine | Реальные help event IDs и support codes | Что локальное повторное TTS воспроизведение полностью учтено |
| Пользователь ввёл текст, возможно через STT | modality=`unknown` | Что текст был произнесён, правильно произнесён или понят на слух |
| В попытке была подтверждённая помощь | independence=`with_help` | Общая слабость языкового навыка |
| Успех без зафиксированной помощи | independence=`unknown` | Самостоятельность при неполной телеметрии |
| Несколько успешных попыток/много реплик | История конкретных игровых исходов | Языковой прогресс, CEFR, рост mastery |

`translation_count` и `other_help_count` остаются `null`, support tracking — `false`.
Skills в collector всегда пусты; проекции — `not_tested`. Даже меньше подсказок во
второй успешной попытке не даёт подтверждённого языкового улучшения.
Ссылки task/help относятся к действительно записанным engine events этой попытки.
Подтверждённую помощь нельзя скрыть нулевыми counters или independent skill evidence.
NPC clarification count остаётся описанием диалога, не штрафом пользователю.

Автоматическая память ограничена встречей и серверным исходом. Произвольная биография,
предпочтения, обещания и тема из guessed STT/AI в collector не сохраняются. Исходные
ручные trusted memory interfaces MVP 3 сохранены и требуют проверки источника/свидетельства.
NPC не получает оценки прогресса. Нет фоновой переобработки усечённой истории.

## 4. Хранение, миграция и удаление

Миграция 88 подготовлена как явная транзакционная миграция четырёх новых таблиц:
`tma_npc_memory`, `tma_communication_result`, `tma_game_capture`, `tma_game_interaction`.
Она не зарегистрирована в startup/create_all_tables и не меняет `TMAGameAttempt`.
Проверяются обязательные поля, PK, unique indexes, source FK и `ON DELETE CASCADE`.
Marker 88 при другом/неполном наборе таблиц вызывает отказ вместо тихого обновления.
Номер 88 необходимо ещё раз сверить с другими ветками перед любым будущим применением.

PostgreSQL SQL включает RLS, REVOKE для PUBLIC/anon/authenticated и отказ при
неожиданной policy. Backend ownership использует integer account IDs Lerne Auth v2;
Supabase `auth.uid()` не подставляется. Приватность сверена с
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) и
[API security](https://supabase.com/docs/guides/api/securing-your-api), но фактическое
исполнение этих правил PostgreSQL ещё не подтверждено.

Вложенные сервисы сохраняют внешний DB connection и используют тот же advisory
user lock, что MVP 2. Это важно для атомарной записи/удаления и порядка блокировок.
Сетевая AI-работа по-прежнему проходит вне DB transaction.

Очистка памяти оставляет tombstone, чтобы replay не восстановил удалённый факт.
DELETE foundation `/data` физически удаляет memory/results/events и оставляет только
не содержащий контента capture barrier для исходной попытки. Старую попытку после
очистки нельзя автоматически переобработать. Новая явно начатая попытка может собирать
новые факты. `include_source_attempts=true` удаляет также Game attempts и их barriers.

Account deletion теперь использует strict Bearer, поскольку прежний legacy dependency
допускал X-User-ID. При наличии таблиц 88 очистка всех Game данных происходит внутри
удаления аккаунта независимо от обоих флагов. Подделанный заголовок не может удалить
чужую память. Это намеренное изменение контракта DELETE `/auth/account` в интеграционной
копии: legacy-only клиенту нужен вход v2. Остальные legacy endpoints не изменялись.
Проверка аккаунта под engine user lock не позволяет началу capture обогнать уже
завершившееся удаление ранее аутентифицированного пользователя.

## 5. Выполненные проверки

Команда из интеграционного worktree:

```powershell
python scripts/test_game_mvp3.py
```

**132 tests — OK:** 49 foundation MVP 3, 30 новых integration и 53 актуальных
MVP 2/answer evaluation. Одноразовые файловые SQLite, FK включены, синтетические данные.
Runner подавляет dotenv/legacy DB initialization и блокирует внешние socket connections.
На этой машине запуск потребовал разрешения вне sandbox из-за Windows ACL tempfile;
это не отказ бизнес-проверок. Рабочая БД и внешние AI/TTS/STT не использовались.

Покрыты реальный engine success/partial/unavailable/ongoing, подсказки и помощь,
отсутствие fake skill evidence, task boundary и social dialogue, default-off без
таблиц 88, pilot ownership, strict Bearer, несовместимые клиентские поля, конкурентные
повторы, stale/conflicting requests, AI failure/retry, атомарный откат записи/удаления,
memory tombstones, capture erasure barrier, account cleanup с выключенными флагами,
изолированные runner guards, migration rerun/collision/rollback/FK/CASCADE.
Флаг on/off даёт одинаковые Game response keys, scene, history, outcome и hint counts.

**20 Playwright tests — passed:** 17 `game-mode.spec.cjs` и 3 `guest-entry.spec.cjs`.
Тестировалась копия UI на отдельном `127.0.0.1:5207`, reuse existing server выключен,
Vite backend proxy направлен на закрытый порт; API перехвачен, внешние browser requests
блокированы. Fake STT/audio проверяли manual/auto Finish, native restart, pause/off,
скрытие страницы, callbacks, TTS failure, AI retry и отсутствие дублирования ходов.
Реальный микрофон и TTS не включались. Снимки находятся в `.cache/browser-integration-results`.
UI не менялся; full frontend lint/build и отдельный Classic autoplay spec не повторялись.

Python-компиляция изменённых модулей, diff whitespace checks и проверка сохранности
исходных файлов выполнены отдельно. Это не считается полным project test suite.

## 6. PostgreSQL: явный блокер

Не найдены PostgreSQL/Docker executables, установки в стандартных Program Files,
службы PostgreSQL/Docker или явно заданная тестовая DSN. Рабочая DSN не проверялась
подключением и не использовалась как тестовая среда.

```powershell
python scripts/test_game_mvp3_postgres.py
```

Результат: **BLOCKED/REFUSED — GAME_MVP3_TEST_DB_URL not configured**, exit 2;
ни одна БД не была открыта. Скрипт подготовлен и скомпилирован, но PostgreSQL-ветка
не исполнена. Он допускает только loopback DSN, имя `lerne_game_mvp3_test_*` и пустую
public schema; пробные schema/data изменения откатываются. Проверяет RLS/grants,
FK/CASCADE, uniqueness, rerun, ownership/replay, competing advisory lock и полный rollback.
Если anon/authenticated отсутствуют, он явно сообщает, что права этих ролей не проверены.
SQLite и SQL mocks не заменяют PostgreSQL-проверку. До её завершения rollout блокирован.

## 7. Безопасное включение только для тестового аккаунта

Сейчас доступен только изолированный автоматический тест с синтетическим account 101.
Для отдельного API pilot после снятия PostgreSQL-блокера:

1. Подготовить локальную одноразовую PostgreSQL-БД `lerne_game_mvp3_test_probe` и
   выполнить PostgreSQL probe выше. Не использовать production DSN, даже временно.
2. Подготовить другую одноразовую локальную БД `lerne_game_mvp3_test_pilot` с существующей
   Game 87/Auth v2 схемой, одним синтетическим аккаунтом и его тестовой Bearer-сессией.
   Live credentials, реальные личные данные и пользовательские production tokens не нужны.
3. В отдельной оболочке установить только pilot параметры. ID должен быть существующим
   Lerne account ID этой тестовой БД; поле принимает ровно один ID, списки/`*` запрещены.

```powershell
Set-Location C:\Users\Aruna\.codex\worktrees\game-mode-integration\tma
$env:ENVIRONMENT = 'test'
$env:GAME_MVP3_ISOLATED = '1'
$env:GAME_MVP3_ENABLED = '1'
$env:GAME_MVP3_TEST_USER_ID = '<ID синтетического аккаунта>'
$env:GAME_MVP3_TEST_DB_URL = '<локальная DSN lerne_game_mvp3_test_pilot>'
python scripts/run_game_mvp3_pilot.py --prepare-schema
python scripts/run_game_mvp3_pilot.py --check
python scripts/run_game_mvp3_pilot.py
```

`--prepare-schema` — явное применение **только 88 к выбранной тестовой БД**; оно не
запускает server или старые миграции. `--check` проверяет настройку без запуска.
Runner не импортирует `api.main` (у него legacy auto migrations), не читает `.env`,
не использует SUPABASE_DB_URL и привязывает только явно валидированную test DSN.
Сервер доступен только на `127.0.0.1:5210`, mock включается принудительно; доступны
Game/Foundation text APIs и `/docs`, media/auth provider/Classic routes отсутствуют.
Это API pilot, не полноценный экземпляр UI Lerne и не ручное live-voice испытание.

4. Использовать синтетический Bearer через API `/docs`; начать **новую** попытку,
   пройти сценарий и проверить events/results/memory/read/delete. Старые попытки не backfill.
   Для другого account ID новая интеграция не собирает данные и Foundation API возвращает 404.
5. После проверки выключить `$env:GAME_MVP3_ENABLED='0'` и остановить pilot. Working Lerne
   не переключать на эту БД/порт. Для удаления тестовых Game данных выполнить owner DELETE
   `/game-foundation/data?include_source_attempts=true` до выключения либо тестовую account cleanup.

Production environment запрещён самим gate. Подключение памяти к NPC prompt,
полной телеметрии modality/локальной помощи, подтверждённого skill evaluator и UI прогресса
требует следующего отдельного проверенного этапа. Изменение voice mechanism для этого
подготовленного этапа не потребовалось. Нет retention scheduler; purge памяти остаётся явным.

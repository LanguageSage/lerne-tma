# Native Structured Cards V2 — заключительный Production Cutover Audit

Дата: 15 ноября 2026, Europe/Budapest. **Заключение: NOT READY.**

Уточнение по ранее принятому решению пользователя: **при переходе V1 → V2 разрешён однократный сброс старого учебного прогресса SRS. Сохранение старых 7 392 записей в работающей V2 не является требованием и не блокирует переход.** Это разрешение не распространяется на повторные сбросы нового прогресса V2. Перед переходом по-прежнему обязательна свежая резервная копия всех production-данных, включая старый SRS до его возможного сброса. В этом аудите сброс и backup не выполнялись; миграции 92–97 сами по себе не реализуют очистку `tmaprogress`.

Это независимый аудит текущей пары исходников и доступных доказательств, а не разрешение на переключение. **P1-01 Like/Dislike закрыт в текущем рабочем дереве (раздел 12)**; повторный сброс нового V2-прогресса исправлен ранее (раздел 11). Остаются отсутствие доказанного общего запрета записей на время перехода, непроверенный production writer конвертации и незакрытая готовность полного backup. Успешные проверки этих исправлений остальные блокеры не отменяют. P0 в проверенной области не обнаружены; это не утверждение об отсутствии любых P0 вне покрытия.

## 1. Границы и идентичность релиза

В исходной фазе аудита Production `wdopyuulhiykrextyvnt` использовалась только для SELECT и чтения advisories; исправления продукта тогда не вносились. Последующие исправления рабочего дерева описаны отдельно в разделах 11–12. Новый production backup/snapshot не создавался. Миграции production, остановка пользовательских записей, merge, commit и deploy не выполнялись. Рабочая LOCAL-база не открывалась для записи.

Запись выполнялась только в новых PostgreSQL-копиях, восстановленных из **существующих** архивов, и синтетических изолированных unit fixtures. PostgreSQL-копии: loopback, отдельные порты, роль `cards_test`, PGDATA в ignored `local/test-data/structured-cards-pg-*`. Внешние AI/Storage-вызовы в испытаниях не выполнялись. Новые диагностические скрипты и приватные результаты оставлены в ignored `local/test-data/`; единственный новый отслеживаемый документ — этот отчёт.

| Компонент | Фактическая версия | Состояние |
| --- | --- | --- |
| TMA checkout | `2fb3f34f77605e7d6365f89817ae51dd1a365b81`, `codex/design-local-parity` | Рабочее дерево перед аудитом чистое |
| Локальные TMA `main` / `origin/main` | `973ba520dd90b092f23b408413446b270838176e` | Отстают от проверяемого checkout на commit LOCAL/design parity; remote ref не обновлялся fetch |
| Admin checkout | `97fe7436158d5a0703eaaadeeb8f46bc9f402e94`, `codex/standalone-admin` | Рабочее дерево чистое; локальный tracking ref совпадает |
| Admin package | `lerne-admin==0.2.2`, editable из данного checkout | `--check-install` PASS; не доказательство отдельного замороженного release wheel Admin |
| Общее ядро | `lerne-card-core==0.1.7` | TMA sources, Admin pin/vendor wheel и установленный Admin runtime согласованы |
| Wheel card-core SHA-256 | `1a9a98990c3cda199bca6b173bc65c1b7a262488c225a836f59e1341968a4e8b` | Проверены provenance, Git blobs, содержимое wheel/runtime и защита от подмены |
| TMA contracts | schema **7**, permissions **2**, cards **3**, import **6** | Текущий verifier PASS |
| Admin contracts | schema **3**, permissions **2**, cards **1**, import **1**; diagnostics **2**, profiles **8** | Это независимые контракты; совпадение номеров с TMA не требуется |
| Reviewed pair | Admin `reviews/library-cleanup97/release-pair.json` | Совпадает с текущим TMA contract; предшественник — `native-unified-storage96` |
| Опубликованный TMA | `edceff02f29df32af501806efb301cf2d6a3ec62` | Read-only Vercel inspection `tma-amber.vercel.app`, deployment `dpl_D1pF7WP7rX83pf6LiVdn5ULuaJLQ`, READY, source CLI |

Последний production deployment не является V2-кандидатом. Запрос deployments с SHA `2fb3f34` не нашёл подготовленного артефакта. Это ожидаемо до разрешённого выпуска, но равенство «локально проверено = подготовлено к релизу» **ещё не доказано**. Нельзя выпускать `973ba52` под видом проверенного `2fb3f34` либо считать версию `0.2.2` достаточной идентичностью всего Admin.

Для проверки deployment metadata применён skill `vercel:deployments-cicd`; только чтение. Другие применённые правила: `ai-harness-eval`, `db-mgmt`, `supabase`, `tma-ui` и Admin `admin-ui`.

## 2. Что изменилось после предыдущей приёмки

Артефакт прежней реальной приёмки — `local/test-data/supabase-rehearsal-d3fa29fb450a4326bfb13ab946d44023/rehearsal_final_report.json`; последующий Chromium smoke связан с инструментами из `27c5139`. Этот JSON не содержит замороженной пары commit SHA. Его readiness-строка сама по себе не является release gate.

Проверены следующие последующие изменения:

| Изменение | Проверка текущей версии |
| --- | --- |
| TMA `5338175`: migration 96, единый scoped store, library import/catalog/permissions | Повтор на восстановленной V2-копии: все 38 526 личных карточек, 8 586 библиотечных, 144 библиотечные колоды; exact hashes/placement/media и HTTP import/export |
| TMA `973ba52`: cleanup 97, startup без legacy-таблиц, сохранение generation | Реальные отказ/rollback/retry/rerun 97, unknown FK, изменённая media link, startup дважды, Dexie pending и restore protection |
| TMA `2fb3f34`: локальные шрифты, publication cache, LOCAL/Preview/login/config | Текущие frontend 592/592; production build/LOCAL/Preview parity 6/6; просмотр скриншотов |
| Admin `eee523b` | Nullable source profile проверен текущим compatibility guard на копии |
| Admin `864f838`, `bfba5ec` | Scoped native модели, permissions и library flows: текущие HTTP/browser roundtrips и изолированные compatibility/core tests |
| Admin `97fe743` | Reviewed cleanup97 pair сопоставлен с TMA contract; runtime profiles не ослаблены |

`git diff 27c5139..HEAD` подтвердил отсутствие изменений в `api/card_core`, `api/srs.py`, `api/routers/cards.py`, `api/routers/ai.py`, `api/services/offline_sync.py` и `app/src/services`. Поэтому прежние подробные offline/media/all-types доказательства используются для неизменённых алгоритмов, с указанными ниже ограничениями. Scope/permission/library/startup и последний дизайн перепроверены.

### Активные V1-зависимости

**PASS для хранения и авторинга карточек:** обычные create/edit/copy/import/export, study и library business paths работают с `content_v2`, `tma_card` и `tma_deck.scope`. На восстановленной копии после DROP пяти legacy-таблиц TMA/Admin продолжили работать. Не найден runtime fallback, компилирующий сохранение native карточки в V1.

Оставшиеся V1-парсеры/конвертеры относятся к обслуживанию и входному авторскому синтаксису; старые определения ORM не означают активную legacy-библиотеку. Legacy-поля `tma_card` остаются частью CHECK/исторических tombstone-контрактов; media/source/image_data — действующие поля, их удалять нельзя.

**FAIL для полного исключения небезопасных старых клиентов:** совместимый `/sync/v2/push` по-прежнему принимает не-карточечные старые записи. Это отдельный подтверждённый P1, описанный ниже. Наличие слова `v2` в URL не доказывает native/CAS-семантику.

## 3. Production: факты чтения и актуальность исходных данных

Основной контрольный SELECT выполнен в `2026-11-15T14:17:15Z`; последующие чтения выполнялись при продолжающейся работе пользователей. Это отдельные наблюдения, **не единый замороженный MVCC snapshot**.

| Проверка | Наблюдение |
| --- | ---: |
| PostgreSQL | 17.6 |
| Личные / библиотечные карточки | 38 526 / 8 586; всего 47 112 |
| Активные карточки | Все указанные; deleted rows 0 / 0 |
| Личные / библиотечные колоды | 741 / 144 |
| Последняя `tma_migration_history.migration_id` | 91 |
| `tma_card_rating`, обе `content_v2`, `tma_deck.scope` | Отсутствуют |
| `tmaprogress` / repetitions > 0 | 7 392 / 3 415 |
| Legacy `progress` | 200; repetitions > 0: 0; queue, отличная от `new`: 0 |
| Legacy `reviewhistory` / `uservoice` | 0 / 0 |
| Library orphan cards / reserve / legacy sharing | 0 / 0 / 0 |
| Внешние FK в удаляемые таблицы | Не обнаружены: только внутренние card/deck/progress/reviewhistory/uservoice связи |

Дополнительно обнаружены **168 `tmaprogress` без существующей `tma_card`, из них 54 с повторениями/queue=review**. Это существующее состояние, не потеря, вызванная V2. Они входят в полную резервную копию исходной production, без исключения через JOIN с карточками. Их сохранение в работающей V2 не требуется при согласованном однократном сбросе старого SRS; отдельным блокером эти orphan-строки не являются. Причина их появления в этом аудите не устанавливалась.

### Актуальность архива: различие старого SRS не является блокером

Существующий V1-архив `../data/backups/supabase_production_public.dump`, SHA-256 `b0eb382f530652b9c0e88cda042a4950026ea8d79f5130be74bfde2c19df5953`, после восстановления содержит те же card/deck counts, но только **7 265** progress-строк. Хеш front проблемной исторической карточки `348700` также отличается от текущего production-хеша.

**Разница 7 265 / 7 392 сама по себе не критична и снята как основание блокировки:** старый SRS разрешено сбросить однократно. Этот архив остаётся пригодным доказательством выполненных на нём проверок. Однако он не заменяет обязательную свежую полную резервную копию перед переходом. Изменившийся контент карточки и отсутствие актуального converter-ready подтверждения рассматриваются независимо от SRS; соответствующая часть P1-04 сохраняется.

Повтор конвертации **неизменённого архива** дал:

- личные: 38 525 converted, **1 blocked**, `unmarked_preamble_before_directive`;
- библиотека: 8 586 converted, 0 blocked;
- реальный atomic writer завершился отказом предварительной валидации;
- после отказа в обеих таблицах **0** V2-строк; 92/93/94/95 остались отдельно успешно committed.

Прежний private rehearsal script явно выполнял UPDATE карточки `348700` на тестовой копии перед конвертацией. Поэтому его `READY_FOR_PRODUCTION_CUTOVER` не доказывает чистый переход исходных данных.

**Нельзя утверждать, что эта карточка всё ещё дефектна в production:** её хеш изменился. Полный payload production-карточки прочитать не удалось: автоматический review отклонил запрос из-за возможного раскрытия пользовательского содержания. Запрос не повторялся обходным способом. Текущая полная converter-ready проверка production остаётся неподтверждённой. Исправление старого архива не переносилось в рабочую базу.

## 4. Последовательность миграций и восстановление после сбоев

Корректный порядок: **92 → 93 → 94 → 95 → полная предварительная валидация и V1→V2 content conversion → 96 → 97 → проверки → допуск новых writers**. Один номер миграции не заменяет конвертацию данных. Перед 96/97 writers должны быть закрыты.

| Шаг | Проверенное поведение | Статус |
| --- | --- | --- |
| 92 | Private rating table, unique user/card, RLS, REVOKE PUBLIC/anon/authenticated, история в одной транзакции; отсутствие storage даёт 503 | PASS на копии/unit tests |
| 93/94 | Nullable JSONB, single-content-source CHECK, legacy rows сохраняются; advisory locks, lock_timeout 5s, statement_timeout 60s, атомарная history | PASS; не означает автоматической конвертации |
| 95 | Nullable source обеих таблиц; atomic history, проверка rerun schema | PASS на восстановленной копии |
| Конвертация | До UPDATE проверяются обе таблицы; все pages и обе таблицы в одной транзакции; layout/Context/metadata/media validation; отказ не оставляет половину V2 | PASS отказа; FAIL допуска текущих production-данных |
| 96 | ACCESS EXCLUSIVE обеих source/target пар, новые library IDs, личные IDs неизменны, scoped ownership/category constraints, remap source_library_id; история атомарна | PASS на реальном архиве |
| 97 | Полное сравнение library deck/card/media/placement multisets, unknown FK/nonempty reviewhistory/uservoice отказ, DROP RESTRICT, generation anchor, atomic history | PASS на реальном архиве |
| Повтор/сбой | 96/97 retry и rerun; поздняя ошибка после DROP откатывает удаление и anchor; повторный startup не создаёт legacy-таблицы | PASS текущего restored runner |

Источники: `api/migrations.py:34`, `:151`, `:287`, `:339`, `:412`; `scripts/tests/unified_cards_postgres.py`; `tools/migrate_native_v2_local.py`.

Полный запуск не является одной общей транзакцией: каждый schema runner владеет своей транзакцией, конвертация — своей. При отказе после 95 схема может оставаться 95, при отказе после 96 — 96; это штатные частично применённые состояния, а не право открыть несовместимое приложение. Rerun 96/97 не копирует данные заново; sequence gaps после rollback допустимы. Advisory lock 96/97 общий, у 92–95 разные IDs; общей координации всех внешних writers эти locks не обеспечивают.

97 проверяет принадлежность legacy progress к library через FK, **но не проверяет `repetitions=0`/`queue=new`** перед DROP. На прочитанной production эти условия выполнены. При разрешённом однократном сбросе старого SRS они не являются самостоятельным условием допуска: исходный progress должен попасть в свежий полный backup, а его сохранение в работающей V2 не требуется. Защита неизвестных FK, content/media и nonempty `reviewhistory`/`uservoice` остаётся без изменений. После перехода новый `tmaprogress` должен быть защищён от повторного сброса; 92–97 его однократную очистку не выполняют.

### Существенный пробел production execution

`tools/migrate_native_v2_local.py:18` намеренно допускает только runner-owned cluster: `cards_test`, loopback, специальный PGDATA, исключение рабочего LOCAL-порта/имени. Этот writer **не может выполнить production-конвертацию в текущем виде**. Чистый `api/v1_to_v2_converter.py` не является production DB writer. Нельзя устранять защиту ad hoc во время переключения. Нужны отдельно reviewed точный maintenance entrypoint/команды, проверки целевой БД, исходных хешей, транзакции, failed-commit reconciliation и abort policy; затем репетиция именно этого пути.

## 5. Функциональная матрица

Здесь FAIL означает либо воспроизведённый дефект, либо отсутствие обязательного доказательства; эти случаи различены явно.

| Критическое направление | Статус | Доказательство / граница |
| --- | --- | --- |
| Совместимость card-core/TMA/Admin | PASS | 0.1.7 wheel/source/runtime; TMA contracts 5 tests, release 5; Admin core 7, compatibility 16; check-install |
| Сохранность library/personal content, Context, layout, media и связей | PASS на проверенном архиве | Все personal card hashes, все library media/content/placement, остальные защищённые таблицы до/после 96/97; текущие production hashes не заморожены |
| Однократный сброс старого SRS / разница 7 265 и 7 392 progress | Не блокер по решению пользователя | Сохранение старого SRS в работающей V2 не требуется; свежая полная резервная копия production до перехода обязательна |
| Like/Dislike: запись и счётчики в БД | PASS | Раздел 12: девять типов, реальные голоса, пакетная агрегация, переключение/отмена, 96 конкурентных записей |
| Like/Dislike: ошибки сервера | **PASS, P1-01 закрыт в рабочем дереве** | Раздел 12: 404/503/другие ошибки отклоняются, UI не подтверждает запись до ответа; lost-commit reconciliation и unknown offline проверены |
| Native Dexie/CAS/retry/conflicts | PASS в проверенной области | Текущие 592 frontend tests; restored Chromium negative-ID create/delivery; same-row stale conflicts TMA/Admin; unchanged detailed acceptance scenarios |
| Старые V1 card queues | PASS отказа / FAIL общего cutover | Card batch получает 409 `legacy_queue_requires_recovery`, receipt не означает запись; авто-конвертации нет. Необновлённые устройства и все виды очередей не инвентаризированы |
| Защита нового V2-прогресса от повторного progress snapshot | **PASS исправления P1-02 в рабочем дереве** | Историческая ошибка воспроизведена; после исправления повторные и новые request_id получают 409 без потери нового SRS; намеренный reset с актуальной base разрешён. Подробности — раздел 11 |
| Обучение/SRS | PASS native events и исправления повторного сброса (раздел 11) | Restored nine-type study/grade; текущий browser smoke; study latency/atomic grade tests 7. UUID review events и flag_only проверены отдельно и сохраняют новый SRS |
| 9 типов: create/edit/copy/import/export | PASS в проверенной области | Текущие TMA→Admin→TMA HTTP nine types, Admin JSON export/TMA import/replay, library copy/media, Chromium smoke; прежняя all-types form/offline матрица применяется к неизменённым редакторам |
| Медиа: сохранность ссылок/embedded bytes | PASS на архиве | Full media fields включая image_data; embedded image 200; copy/import сохраняют все attachments |
| Медиа: реальные внешние объекты/полнота backup | **FAIL, P1-05** | 1 161 unmatched cloud paths; полная проверка байтов Storage/CDN/CORS не выполнена |
| AI generation/Context | PASS адаптера / внешняя модель не проверена | Mock provider → настоящий native API → PostgreSQL explanation, 200, точное сохранение. Реальная семантика/доступность платного AI не проверялись |
| Последний UI TMA/Admin | PASS основных сценариев; P2 ниже | Parity 6/6, restored Chromium 2/2, Admin edit/save через UI; визуально просмотрены mobile TMA и desktop Admin screenshots |
| Изоляция пользователей/секреты | PASS в проверенной области | Restored foreign read/rating 403; permissions 36, global read-only 8, admin permissions 14; production grants/RLS; ограниченный scan |
| Общий write fence и запрет старых версий | **FAIL, P1-03** | В коде/проверенной конфигурации нет доказанного общего режима maintenance; old-client mutation воспроизведена |
| Rollback текущей production и точное release identity | **FAIL допуска, P1-04/P1-06** | Local rollback/97 refusal проверены; актуальная production recovery-процедура и неизменяемая пара артефактов не зафиксированы |

### P1-01 — исторический дефект Like/Dislike; закрыт в рабочем дереве

Ниже сохранены исходные доказательства дефекта. Исправление, актуальная область пользовательских оценок и проверки закрытия — в разделе 12.

`app/src/services/cardRatings.js:49–52` поглощает **любой** 404/503, оставляет optimistic vote и разрешает Promise. Cache — только память, outbox для рейтингов нет. `useCardRating` не получает ошибку; после reload неподтверждённая оценка исчезнет. Это воспроизведено отдельным отрицательным probe на текущем исходнике: для 404/503 `rejected=false`, rating=-1 вместо предыдущего 1; для 500 `rejected=true`, rating=1.

Текущий `cardRatings.test.js` явно ожидает поглощение этих ошибок, поэтому зелёный frontend suite не закрывает критерий. Изменение пришло ранее, в `3e1e623`, но всё ещё блокирует текущий допуск. Предложение: откатывать неподтверждённый vote и передавать ошибку для 404/503 так же, как для остальных отказов; проверить видимое error/retry состояние и отсутствие ложного успеха. Offline queue для online-only функции не требуется.

### P1-02 — исторический дефект повторного сброса SRS V2; исправлен в рабочем дереве

`api/services/offline_sync.py:210` применяет base/CAS guard только при `drain_legacy=True`. Обычный `/sync/v2/push` принимает progress snapshot без этого guard. Подлинная сессия и `X-Lerne-Generation` не являются протоколом минимальной версии клиента: `require_generation(None)` допускается при `restored=false`.

Первоначальная проверка на восстановленной и мигрированной до 97 копии, с настоящим signed Bearer, без dependency overrides и без generation header:

```text
До:    repetitions=10, interval=100
POST /api/sync/v2/push со старым snapshot repetitions=0, interval=0
Ответ: HTTP 200
После: repetitions=0, interval=0
```

**Сам по себе этот `10/100 → 0/0` не блокирует переход**, если является согласованным однократным сбросом старого SRS. Поэтому дополнительно проверен именно новый прогресс после такого сброса. На той же изолированной восстановленной копии (96/97 уже применены), без запуска новых миграций, для синтетической native-карточки:

1. Удалена только её старая тестовая progress-строка, моделируя разрешённый однократный сброс. Настоящий `POST /api/study/grade` с новым `action_id` создал **новый** прогресс V2: repetitions=1, interval=3, queue=review.
2. Обычный `POST /api/sync/v2/push` с действительным signed Bearer **и корректным текущим `X-Lerne-Generation`**, без auth dependency overrides, передал устаревший нулевой snapshot без review event. Ответ 200; новый V2 progress стал repetitions=0, interval=0, queue=new.
3. Следующая настоящая V2-оценка снова создала 1/3. Replay уже обработанного `request_id` вернул 200 и сохранил 1/3 — receipt защищает от повторного применения именно этого пакета.
4. Тот же нулевой snapshot в новом обычном пакете с **другим `request_id`** снова получил 200 и сбросил новый progress в 0/0. Ограничителя «только один раз при cutover» в этом пути нет.
5. Контроль: snapshot вместе с native UUID review event обработан безопасно; повтор того же пакета не применил оценку дважды. `flag_only` также не заменил новый SRS.

Результат до исправления: повторный сброс нового V2-прогресса воспроизведён. Поэтому P1-02 относился к новому SRS, а не к разрешённому сбросу старого. Этот результат сохранён как baseline; исправление и повторные проверки приведены в разделе 11. Не утверждается, что каждый актуальный V2-клиент обязательно сформирует небезопасный пакет: новый event-based путь защищён, но сервер по-прежнему принимает snapshot без event. `syncService.js` выбирает обычный `/push` для native card IDs и сохраняет ранее pending пакет, поэтому одно наличие native-карточки или generation header не исключает такой запрос.

Для guarded `/push-legacy` с устаревшей base ранее получен 409. Карточечный старый пакет отдельно получил 409. Предложение: до reopening исключить перезапись нового SRS незащищёнными snapshots, включая оставшиеся старые очереди; native UUID review events и безопасные флаги должны продолжить работать. Старые SRS-очереди не должны восстанавливать или обнулять новый progress после разрешённого reset. Сохранность очередей редактирования контента остаётся отдельным требованием. Не решать это только просьбой обновить страницу.

### P1-03 — нет доказанного полного запрета записей

UI maintenance/banner или закрытие Admin window не останавливают serverless instances, прямые deployment URLs, фоновые задачи и старые устройства. `RUN_MIGRATIONS=false` и `LERNE_SKIP_SCHEMA_INIT` не являются write fence. GET/init/auth могут создавать данные; запрета только POST недостаточно. Startup TMA сам выполняет подготовку схемы, поэтому запуск нового приложения до готовности 97 небезопасен.

Нужен конкретный проверенный механизм, охватывающий TMA всех доступных версий/URL, Admin + workers/paused jobs, импорты/TTS/AI, cron/bot, media uploads, notes/messages/ratings/SRS/Knowledge/auth и внешние maintenance-процессы. Для DB-owner/bypassrls соединения простой REVOKE с таблиц сам по себе может не остановить владельца; нельзя объявлять такой fence работающим без реального теста. Ничего из этого сейчас не включалось.

### P1-04 — не закрыты production writer и актуальный data gate

Миграционный writer намеренно LOCAL-only; в прежнем успешном rehearsal контент существующего архива предварительно исправлялся. Требуются reviewed исполнимый production путь и проверка актуального входа без скрытых нормализаций. Если production-карточка 348700 уже исправлена, это нужно подтвердить валидатором; исторический дефект не считается доказанным текущим дефектом. Разница числа старых SRS-строк исключена из оснований P1-04. Сохранение этих строк в работающей V2 не требуется; свежая резервная копия **всех** production-данных, включая SRS до возможного reset, обязательна. Требования к остальным данным не меняются.

### P1-05 — полный backup сейчас не доказан и имеет известный отказ

Read-only сопоставление пяти прямых media полей обеих таблиц с `storage.objects` дало 26 863 cloud references, 11 976 различных paths; **2 901 references / 1 161 paths не нашли точного объекта**. Percent-encoded paths в этой выборке не обнаружены. Это проверка каталога, а не HTTP/SHA-256 всех байтов; metadata/resources/внешние origins не охвачены полностью.

`lerne-admin/src/lerne_admin/services/full_database_backup.py:200` и `:229` намеренно отклоняют отсутствующие Storage references; абсолютный cloud URL не считается восстановленным только по наличию embedded TMAMedia. Полный архив на таких ссылках не должен объявляться успешным. Исторический audio audit 27.10 также фиксировал missing objects; текущие числа шире и включают обе таблицы/пять полей, их нельзя вычитать как динамику одного показателя.

До backup надо выбрать и проверить допустимый recovery contract: восстановление найденных оригиналов либо явно согласованный архив с полным SQL, всеми доступными байтами и manifest исходных missing objects. Текущий строгий full-backup path не превращается в такой архив автоматически. Не удалять/обнулять ссылки и не генерировать замену только ради зелёной проверки. Частичные архивы из другой ветки Admin в проверенный релиз не входят.

### P1-06 — пара выпуска и процедура отката ещё не заморожены

Нужно зафиксировать exact TMA/Admin commits, card-core wheel, проверенные build/package hashes, effective config без секретов, перечень допустимых URL/writers и согласованные команды rollback. Сейчас проверен checkout `2fb3f34`, `main` — `973ba52`, production — `edceff02`. Это три разных состояния. Никакой merge/deploy в рамках аудита не выполнялся и здесь не разрешается.

## 6. Безопасность

На production все **41 public tables** имеют RLS, `FORCE RLS=false`; policies в public — 0. Effective `has_table_privilege`: `anon`/`authenticated` читают 0 и пишут 0 таблиц; `service_role` читает/пишет 41. Public SECURITY DEFINER functions не найдены. Legacy FK замкнуты внутри пяти удаляемых таблиц. Новая rating table в 92 явно включает RLS и отзывает client grants.

Supabase security advisor вернул INFO `rls_enabled_no_policy` (42 таблицы, включая служебную вне public), не разрешение открыть client grants. При текущей собственной auth-модели отсутствие policies означает закрытый клиентский доступ; owner/service role обходят RLS, поэтому tenant boundary обеспечивается серверными permissions. Это согласуется с [официальной документацией RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) и [защитой Data API](https://supabase.com/docs/guides/api/securing-your-api).

Default privileges роли `postgres` в public не выдают table/sequence grants anon/authenticated; у `supabase_admin` defaults шире. Итоговые grants/RLS новой таблицы надо сверить после maintenance отдельно; defaults нельзя считать единственным доказательством.

Текущие проверки: foreign user read/rating 403 на копии; material permissions 36/36; global read-only 8/8; TMA admin permissions 14/14, включая private `/init`, скрытие synthetic API key и auth; Admin loopback Host/Origin/security 10/10. Scan 486 tracked frontend paths на характерные secret/private-key patterns не нашёл совпадений; deploy-input tests 6/6 проверили исключение private data/config. Это ограниченная проверка, не полный secret-history scan и не чтение всех значений production environment. Настоящие ключи в отчёт/логи не выводились. Проверенный parity build использовал очищенное окружение.

## 7. Производительность и некритический долг

Актуального сохранённого JSONB/Context performance report, привязанного к данной паре commits, среди найденных доказательств нет. Старый load-test артефакт до V2 не засчитывается. Выполнены ограниченные новые замеры на восстановленной копии, а не production capacity test:

| Сценарий | Наблюдение |
| --- | --- |
| Native content с большим Context | Payload 210 270 bytes; 5 CAS saves: 115.99, 254.19, 250.86, 120.82, 221.27 ms; точное persisted JSON равенство |
| Поиск Context, 1 synthetic card | HTTP 200, найден; первый замер 11 311 ms; повторные READ ONLY service calls 11 637 / 12 070 / 11 104 ms |
| No-match search крупнейшего владельца | 30 183 cards; HTTP 200; первый замер 17 911 ms; повторные READ ONLY 17 388 / 18 351 / 17 902 ms |
| SRS latency/atomic contracts | Текущие изолированные tests 7/7; не заменяют нагрузочный тест |

**P2: задержка поиска подтверждена повторно.** `api/services/cards.py:478` загружает доступные decks и перебирает native JSON, нормализуя строки; общий prep/catalog/statistics также входит в замер. На основании этих результатов нельзя приписывать всю задержку JSONB или Context. Нужны точечное профилирование этого пути, baseline/SLO и проверка concurrency до обещания production latency. Архитектурный рефакторинг не выполнялся и здесь не предлагается.

Другой отдельный долг:

- **Context в отдельной колонке остаётся после V2.** В рамках перехода правильное место пояснения — `content_v2.card.explanation`; отдельная миграция не нужна.
- **P2 UI:** на просмотренном parity screenshot при 375px с synthetic published design подрезана надпись «Начать занятие». Parity/scroll-width tests проходят, поскольку сравнивают одинаковое поведение трёх режимов; это не доказательство идеальной визуальной вёрстки.
- 168 существующих orphan progress, включая 54 repeated: учесть в полном исходном backup. Их сохранение в работающей V2 не требуется при разрешённом однократном сбросе старого SRS; отдельным блокером они не являются.
- V1 queue recovery/инвентаризация устройств остаётся явной обязанностью; не чистить Dexie автоматически. Полный production service-worker/cold-offline rollout не испытан; browser harness блокирует service workers.
- Устаревшие исторические разделы документации упоминают card-core 0.1.6/0.1.4 и старые профили. Для выпуска использовать manifests/current guard, а не эти номера.
- Реальные внешние AI/TTS, Storage bytes/CDN/CORS и полный визуальный набор состояний Admin не проверялись заново; проверены native adapters, текущий desktop edit/save и прежние неизменённые сценарии. Это не external-service PASS.

### Некритический долг по итогам приёмки Lerne Native V2 (2026-11-17)

1. **Перегруженность и дублирование в редакторе и создании карточек (`CardForm`, `useCardEditor`, `CardEditor`, `CardCreator`)**
   - **Причина:** `app/src/components/common/CardForm.jsx` (704 строки) совмещает редактирование содержимого, предпросмотр, прикрепление готового аудио/видео/изображений, классификацию CEFR, локальную публикацию, AI-генерацию и диктовку; `app/src/hooks/useCardEditor.js` (552 строки) объединяет сериализацию, offline/CAS-очереди и навигацию, а `CardEditor.jsx` (177) и `CardCreator.jsx` (122) дублируют обвязку (включая устаревший позиционный аргумент `'creator'` в `CardCreator.jsx:77` при вызове `saveCard(newCardData, 'creator')`, хотя `saveCard` принимает объект `{ awaitDelivery }`).
   - **Последствия:** визуальная перегрузка формы на одном экране, высокая связность состояния и повышенный риск задержек/регрессий при изменениях редактора.
   - **Приоритет:** P1 (следующий этап упрощения после слияния в `main`, без ломки контрактов V2).
   - **Предлагаемое решение:** выполнить 3-шаговое упрощение: (a) выделить общую оболочку редактора и изолировать панели медиа/AI/JSON в отдельные подкомпоненты, поправить сигнатуру вызова `saveCard` в `CardCreator`; (b) разделить `useCardEditor` на модули состояния черновика, транспорта и навигации; (c) разгрузить UX `CardForm` через прогрессивное раскрытие вторичных секций (метаданные, исходный JSON, доп. действия), оставив базовые поля, прикрепление аудио и сохранение на первом экране.

2. **Полный снэпшот `applySnapshot` и `inspectCutoverDatabase` загружает таблицы Dexie в память (`toArray()`)**
   - **Причина:** для устранения 30k+ поэлементных Dexie-чтений/записей `syncService.js:applySnapshot` и `cardCutoverPreflight.js:inspectCutoverDatabase` считывают `folders`/`decks`/`cards`/`progress` через `toArray()`, строят diff в памяти и выполняют один `bulkPut`/`bulkDelete` на таблицу; на 40 000 синтетических карточках (с 40k `progress` в `fake-indexeddb`) зафиксировано `136.9–232.6 MB` `heapUsed` и `6.7 s` на delta-pull с 1 изменённой карточкой (в реальном Chromium на 30 383 карточках повторное открытие редактора ускорилось до `967 ms`, а сразу после сохранения с `skipPull: true` — `117 ms`).
   - **Последствия:** при росте коллекции существенно выше 50–100 тыс. карточек возможны всплески памяти и паузы сборки мусора на мобильных WebView.
   - **Приоритет:** P2.
   - **Предлагаемое решение:** перейти на серверно-клиентский инкрементальный delta pull (`since`/watermark + tombstones в рамках Smart Sync), оставив полный `applySnapshot` для редкого reconcile.

3. **Сброс транзиентных study-полей на `cards` и полная очистка `deck-cards:*` при полном `pull`**
   - **Причина:** `app/src/services/api.js` записывает на локальные карточки временные поля `_studyProgressAt`, `_studyProgressStartedAt`, `_studyRequestStartedAt`, которых нет в payload `/sync/v2/pull`; `sameSnapshotRecord` фиксирует отличие числа ключей и перезаписывает такие карточки, а `applySnapshot` очищает все ключи `deck-cards:*`.
   - **Последствия:** корректность сохраняется, но недавно изученные карточки получают лишний `bulkPut` на `pull`, а первое открытие колоды после `pull` заново перечитывает список.
   - **Приоритет:** P3.
   - **Предлагаемое решение:** при переходе на delta sync хранить транзиентные study-метки отдельно от записи snapshot-сущности либо не сбрасывать `deck-cards:*` при нулевой дельте.

4. **Безусловный запрос `GET /local/transfer-card/{cardId}` при монтировании `LocalPublishButton`**
   - **Причина:** `app/src/components/common/LocalPublishButton.jsx:17-20` в режиме `IS_LOCAL` запрашивает `/local/transfer-card/{cardId}` при каждом открытии редактора существующей карточки без предварительной проверки админ-контекста.
   - **Последствия:** лишний сетевой запрос и возможный ответ `403`/`404` в консоли разработчика у не-административных локальных сессий; пользовательский сценарий не нарушен.
   - **Приоритет:** P3.
   - **Предлагаемое решение:** инициировать проверку `transfer-card` только при включённой локальной админ-публикации или по явному действию оператора.

5. **Устаревшие V1/UI-фикстуры в Playwright (`card-editor.spec.cjs`, `study-finished.spec.cjs`, `cardlist-menu.spec.cjs:196`)**
   - **Причина:** после удаления Legacy V1 в `f6d1db6` и ужесточения проверки имени профиля в `GuestBanner`/`UserBadge` (`useAppInitialization.js:290-296`) старый критический `card-editor.spec.cjs` (14 тестов на удалённой `.card-content-editor` и V1 `front`; заменён на `native-card-editor.spec.cjs`) и 6 из 16 тестов `study-finished.spec.cjs` (фикстура карточек без `content_v2` и вызов `finish()` до завершения `/api/init`) устарели; дополнительно `cardlist-menu.spec.cjs:196` не задаёт `first_name` в моке профиля, из-за чего `GuestBanner` сдвигает область при `height: 640` во время синтетического touch-scroll.
   - **Последствия:** `playwright --project=critical` содержит устаревшие красные тесты при зелёном прохождении актуальных V2-сценариев (`auth-recovery`, `guest-entry`, `library-mobile`, `cardlist-media`, 4/5 `cardlist-menu`, `native-card-editor` и 45/45 `study-latency`).
   - **Приоритет:** P2.
   - **Предлагаемое решение:** отдельной задачей заменить `card-editor` на `native-card-editor` в `playwright.config.cjs`, перевести карточки `study-finished.spec.cjs` на `content_v2` с ожиданием загрузки `/api/init` и задать `first_name` в профиле `cardlist-menu.spec.cjs`.

6. **Косметическое форматирование `root_id === null` в Admin `material_archives.js` и отложенные черновые ветки**
   - **Причина:** в `lerne-admin/src/lerne_admin/static/js/material_archives.js:163` при восстановлении библиотечных колод без корневой папки (`result.root_id === null`) в статус подставляется `новая папка #null` (улучшение с формулировкой для библиотечных колод оставалось в неслитой ветке `codex/td-005a-backup-reliability`, отложенной вместе с `codex/td-005-audio-reliability` и `game-mode`).
   - **Последствия:** только текст статус-строки в локальной админке; данные, `scope='library'` и привязки сохраняются без ошибок.
   - **Приоритет:** P3.
   - **Предлагаемое решение:** точечно перенести ветвление текста для `result.root_id == null` в `material_archives.js` без возврата старой ветки целиком.

## 8. Исполненные тесты и проверяемые артефакты

Все перечисленные ниже повторные проверки относятся к текущим HEAD из раздела 1. Private artifacts не являются входами CI и не включаются в release.

| Проверка | Результат | Артефакт в `local/test-data/` |
| --- | --- | --- |
| `npm --prefix app test` | 592 passed, 0 failed/skipped | `cutover-final-frontend.log` |
| `npm run test:design-parity` | 6/6; real production build + LOCAL + Preview | `cutover-final-design.log`, `design-parity/` |
| `structured_cards_postgres.py --unified-dump … --admin-root …` через Admin venv | EXIT 0; 96/97 invariants, nine-type HTTP, native-migrated Chromium и smoke Chromium по 1 passed | `cutover-final-restored.log`, `structured-cards-pg-b693de9226fc432a98a65a1cebb887a7/`, `playwright/` |
| Неизменённый V1 archive → fresh PG → 92–95 → converter | **Ожидаемый отказ данных:** 1 blocked, обе таблицы V2=0 | `structured-cards-pg-68ff77d81f814492a4d81705ff7370f6/audit-results.json` |
| Restored V2 targeted API/DB | rating DB PASS, 503 returned; old progress reset **reproduced**; guarded 409; AI Context persisted; foreign 403; large Context saves | `cutover-final-behaviour.log`, `structured-cards-pg-7133e10b983c49fc9e7e2417f3bd74c2/audit-results.json` |
| Старый progress с настоящей auth dependency | HTTP 200, 10/100 → 0/0; не самостоятельный блокер при разрешённом однократном reset | `cutover-final-old-authenticated.log`, тот же cluster `old-client-authenticated.json` |
| Новый V2 progress после моделирования однократного reset | **P1-02 reproduced**: V2 grade → 1/3; обычный snapshot → 0/0; повторный новый пакет снова сбрасывает новый progress. Корректные Bearer/generation, без overrides. Receipt replay / UUID review event / flag_only — PASS | `cutover-final-srs-repeat.log`, probe `cutover_srs_repeat.py`, тот же cluster `srs-repeat.json` |
| Correct-error assertion для frontend ratings | **FAIL как и ожидалось:** 404/503 swallowed; 500 rollback PASS | `cutover-final-rating-errors.log`; probe `cutover-rating-errors.mjs` |
| Повторные READ ONLY search timings | Длительность подтверждена; результат корректен | `cutover-final-search.log`, тот же cluster `search-readonly.json` |
| TMA isolated card ratings / offline sync / generation / converter | 7 / 10 / 7 / 30 tests PASS | `cutover-final-backend.log`, `cutover-final-test_*.log` |
| TMA native content updates / release / contracts | 10 / 5 / 5 PASS | `cutover-final-test_*.log` |
| TMA material permissions / global read-only / admin permissions | 36 / 8 / 14 PASS | `cutover-final-test_*.log`, `cutover-final-admin-permissions.log` |
| SQL runner / deploy manifest / API errors / study latency | 17 / 6 / 5 / 7 PASS | `cutover-final-sql-migrations.log`, `cutover-final-deploy-manifest.log`, `cutover-final-api-errors.log`, `cutover-final-study-latency.log` |
| Admin core / compatibility / perimeter | 7 / 16 / 10 PASS | `cutover-final-admin-core.log`, `cutover-final-admin-compat.log`, `cutover-final-admin-security.log` |
| Admin `--check-install` | PASS; editable current source, card-core 0.1.7, profiles 8 | Проверен вывод без доступа к БД |

Начальные попытки Chromium/Node/PG и отдельных tempfile-cleanup tests упирались в sandbox EPERM/WinError 5. Повторные запуски тех же изолированных тестов вне этого ограничения прошли; assertions не ослаблялись. Два вспомогательных audit probes первоначально имели ошибки вызова/import, исправлены только ignored scripts; их неполные результаты не засчитаны. Никакой общий full-suite/build PASS сверх перечисленного не заявляется.

## 9. Можно ли переключиться с минимальным простоем

**Технически — с ограниченным окном полного запрета записей; сейчас безопасное окно не доказано.** Нулевой downtime при продолжающихся V1 writers эта реализация не обеспечивает.

92–95 являются подготовительными изменениями, но их предварительное применение потребует отдельного разрешения, проверки старого приложения и оценки блокирующего CHECK scan. Они используют table/advisory locks и могут остановиться по timeout. Это не рекомендация применять их сейчас.

Для финального окна нужна последовательность: доказанный fence всех writers → завершение in-flight транзакций → замороженный baseline/backup по согласованному recovery contract → reviewed production converter → 96 → 97 → data/ACL/startup checks → запуск TMA и Admin за закрытым внешним доступом → smoke → открытие только допущенных новых clients/writers. Admin не запускает миграции TMA. Старые процессы, сохранённые jobs и deployment URLs не должны оставаться альтернативным путём записи.

Оценка конвертера 40–43 s в этом аудите относится **к проверке с отказом**, не к успешному production cutover. Restored Chromium 1.8 min + 46 s — тестовый runtime, не downtime estimate. Полное время backup/Storage download, успешной актуальной конвертации, 96/97, проверок и rollback не измерено как единая процедура. Поэтому обещать конкретные минуты простоя нельзя. Предварительные read-only аудиты и подготовка артефактов могут уменьшить окно, но не отменяют fence.

### Откат

До reopening при любой ошибке: сохранить fence, установить durable history/schema и состояние последней транзакции; не считать потерянный COMMIT-ответ rollback. Частично committed 92–96 нельзя обслуживать старым/новым API произвольно. Контентный writer не поддерживает resume поверх частичного V2; нужен исходный вход и проверенный план восстановления, а не повтор с игнорированием guard.

Откат после 96/97 — восстановление согласованного pre-cutover public schema/data/sequences/ACL и прежней пары приложения. Обратной миграции объединённых библиотечных IDs/JSON в V1 нет. JSON/deck export не заменяет полный rollback archive. Управляемые Supabase auth/storage schemas не должны пересоздаваться случайно; отдельно сохраняются необходимые roles/grants/policies и внешние media bytes, учитывается scope используемого archive.

Перед допуском клиентов после restore нужен проверенный generation marker/quarantine; 97 сохраняет старый generation для штатной миграции, но реальный restore должен обнаруживаться как новый. Это проверено локальным restored runner. Пока старый `/push` допускает запись, одной generation-защиты недостаточно.

Если после backup уже допущены новые записи, слепой restore старого архива потеряет их. Нужны повторное закрытие writers, отдельное сохранение появившихся изменений и решение об их согласовании; автоматического reverse merge нет. Rescue backup/restore и такое согласование требуют отдельного разрешения. В этом аудите они на production не выполнялись.

## 10. Точный перечень действий до резервного копирования

Это список последующих работ для отдельного разрешения, **не выполненные операции**. Не начинать backup/cutover по одному этому отчёту.

1. P1-01 исправлен и проверен в текущем рабочем дереве (раздел 12). При подготовке выпуска сохранить именно это исправление и регрессии: личный голос подтверждается сервером, счётчики считаются из реальных голосов, 404/503/offline не превращаются в успех. Административное управление счётчиками и общий React-просмотрщик отложены и не являются условием закрытия этого P1.
2. P1-02 исправлен в текущем рабочем дереве (раздел 11); при выпуске сохранить исправление и регрессионные проверки: после разрешённого однократного reset доказать, что обычные snapshot-пакеты и старые SRS-очереди не сбрасывают новый V2 progress, в том числе с новым request_id и корректным generation header. Сохранение старого SRS не требуется. UUID review retry, flag_only и актуальные native flows должны продолжить работать; требования к очередям редактирования контента не меняются.
3. Подготовить и испытать общий write fence P1-03, включая старые deployment URLs, Admin workers/jobs, cron/bot, startup/GET-side effects, auth, media и любые прямые writers. Сначала показать его работу на отдельном стенде. Сейчас production writes не останавливать.
4. Подготовить reviewed production maintenance entrypoint для converter + точный порядок 92–97. Зафиксировать target identity, транзакции, lock/statement timeout, rerun/abort/COMMIT-uncertainty и проверку сохранности. Не удалять LOCAL safety guard ради ручного обхода.
5. Закрыть актуальный content data gate: read-only проверка текущего V1-входа конвертером, 0 blocked; отдельно проверить изменённую карточку 348700. Для локальных private inputs требуется явно разрешённый способ чтения/выгрузки; создание нового snapshot/backup пока не разрешено. Разница старого SRS не блокирует эту проверку и не требует replay всех 7 392 строк. Перед переходом после отдельного разрешения обязательна свежая полная резервная копия всех production-данных, включая старый SRS и orphan-строки до возможного однократного reset.
6. Согласовать media/recovery contract P1-05 до запуска backup: инвентаризировать missing references, определить доступные оригиналы и проверить restore пути архива, который действительно сохраняет SQL и доступные байты. Отсутствующие байты должны быть явно отражены; не выдавать metadata match за SHA-256 bytes и не «лечить» ссылки удалением.
7. Зафиксировать точную исправленную пару TMA/Admin и card-core wheel/hash; повторить только затронутые тесты и проверки последующих diff. Выбрать, входит ли `2fb3f34` в выпуск. Подготовить проверяемые артефакты/config без merge/deploy до отдельного разрешения. Текущий отчёт не распространяется автоматически на будущие исправления.
8. Утвердить конкретный runbook переключения и физического rollback: ответственный, команды/версии PG, archive scope, ACL/roles/media, baseline counts+hashes, критерии отказа, generation и политика данных после backup. Измерить rehearsal этой последовательности и определить допустимое окно простоя; отдельно принять решение по подтверждённой задержке поиска.
9. Только после закрытия этих пунктов и отдельного разрешения на следующий этап: включить проверенный fence, дождаться in-flight writers и повторить frozen read-only preflight. Перед фактическим backup зафиксировать **все** актуальные counts/hashes, включая SRS, для проверки полноты свежей копии; сохранение старого числа/значений SRS в работающей V2 не является критерием допуска. Проверки reviewhistory/uservoice empty, FK/reserve/sharing, версии схемы и target identity остаются обязательными; расхождение по этим условиям остановит процедуру. Разрешённый однократный reset должен быть явным шагом будущего runbook и не повторяться при обычной работе V2; в текущем аудите он на production не выполняется.

**Финальное решение: NOT READY.** Доказательства позволяют продолжать точечное устранение перечисленных блокеров; они не разрешают production backup, миграции, остановку записей, merge или deploy.


## 11. Исправление P1-02 — защита нового SRS от progress snapshots

Проверена рабочая версия на базе TMA `2fb3f34f77605e7d6365f89817ae51dd1a365b81` с незакоммиченными изменениями, перечисленными ниже. Commit/merge/deploy не выполнялись. Другие P1-блокеры не сняты; общий итог **NOT READY** сохраняется.

Первопричина: `offlineApi.js` при offline reset записывает нулевой progress в Dexie с dirty marker и исходной `sync_base.updated_at`; offline grade отдельно создаёт UUID review event. `syncService.js` сохраняет pending batch, но прежде передавал `drain_bases` только через guarded legacy transport. Для native card IDs обычный `/sync/v2/push` принимал snapshot без проверки исходной версии. В `offline_sync.py` этот snapshot напрямую присваивал queue/repetitions/interval и остальные SRS-поля PostgreSQL. Это перезапись устаревшим snapshot, не действие generation и не однократная миграционная очистка. Receipt защищал только от повторного применения одного request_id; другой UUID снова мог перезаписать строку.

Минимальное исправление использует существующий контракт версий, без новых таблиц, миграций или альтернативной очереди:

- `api/services/offline_sync.py`: блокировка существующей progress-строки и сравнение её server updated_at с переданной base теперь действуют и на обычном push. Устаревшая base либо отсутствие base при отличающемся SRS дают 409 с откатом всей транзакции/receipt. Неизменённый SRS и личные annotations не трактуются как сброс; `flag_only` не меняет SRS. UUID review event остаётся источником расчёта SRS и не заменяется snapshot. Подтверждения progress включают committed `versions`, чтобы следующий локальный edit/reset использовал серверную, а не локальную версию.
- `app/src/services/syncService.js`: передаёт уже сохранённую progress `sync_base` как `drain_bases` и при обычном native push. Существующий ack применяет committed versions, а существующий conflict path сохраняет dirty/pending пакет и показывает необходимость сверки. Синхронизация не отключена; конфликт не выдаётся за успешную запись.
- Намеренный online reset колоды остаётся на прежнем отдельном endpoint. Намеренный offline reset доставляется snapshot с актуальной base. Если после ухода offline другой клиент уже обучал карточку, reset получает конфликт и требует явного согласования; он не должен молча уничтожать новое обучение. Однократный migration reset старого SRS по-прежнему разрешён отдельно.
- `scripts/tests/test_offline_sync.py`: добавлен regression реального native grade → stale zero snapshot → повтор того же и новых request_id, а также валидный reset, receipt replay после нового grade и stale-base conflict.
- `scripts/tests/browser/native-smoke-acceptance.spec.cjs`: добавлен настоящий Dexie offline reset с проверкой сохранённой base, последующей отправкой online и новым обучением после reset.
- `.agents/subsystems/sync.md`: уточнён контракт ownership/CAS/ack progress. Этот отчёт фиксирует результат; остальные блокеры сохранены.

Подтверждения на изолированной ранее восстановленной V2-копии `audit_v2_behaviour`, схема 96/97, настоящие Bearer/generation, без auth overrides:

- Новый native progress 1/3 остаётся 1/3 после stale snapshot: HTTP 409. После следующей оценки новый progress также сохраняется при повторном и новом request_id.
- Native UUID review event + stale snapshot и повтор receipt: HTTP 200/200, оценка применяется один раз; `flag_only` не меняет SRS.
- Намеренный reset с актуальной base: 200. После новой оценки replay подтверждённого reset возвращает receipt без удаления нового progress. Тот же reset с новым request_id и старой base: 409. Запрос другого аккаунта: 403, чужой progress не меняется.
- Артефакт: ignored `local/test-data/srs-fix-postgres.log`, probe `cutover_srs_fixed.py`, `structured-cards-pg-7133e10b983c49fc9e7e2417f3bd74c2/srs-fixed.json`. Первоначальная попытка probe остановилась на отсутствии синтетического пользователя второго аккаунта; добавлен только тестовый пользователь в этой копии, успешный повтор проверил весь сценарий.

Текущие проверки: isolated backend offline sync **11/11**, study **7/7**, material permissions **36/36**, frontend **592/592**; Python compilation, targeted ESLint `syncService.js` и TMA contract verifier PASS. Логи — `local/test-data/srs-fix-{backend,study,permissions,frontend}.log`. Начальная команда ESLint из неверного cwd не нашла файл; повтор из `app/` прошёл.

Проверка Chromium offline→online на новой восстановленной копии: **PASS, 1/1 (30.4 s)**. Проверены сохранение base в настоящем Dexie при offline reset, доставка обычным push после восстановления сети, reset на сервере и новое обучение после reset; дополнительно прошли nine-type TMA/Admin HTTP, media/import и проверки 96/97 restored runner. Артефакт: `local/test-data/srs-fix-browser-restored.log`, кластер `structured-cards-pg-9f404555b4ae4f4db8bbbf1c9163c78f`. Браузер использует существующие loopback API routes и account-scoped Dexie, внешние запросы блокируются. **P1-02 закрыт для текущего исправления: новый progress не теряется в воспроизведённых случаях, намеренный reset сохранён.** Production и рабочая LOCAL не менялись; production-миграции и backup не выполнялись. Критерий закрытия P1-02 относится к этому исправлению и его тестам, а не к ранее опубликованному deployment.


## 12. Закрытие P1-01 — пользовательские Like/Dislike

15 ноября 2026. Проверена рабочая версия TMA на базе `2fb3f34f77605e7d6365f89817ae51dd1a365b81`, ветка `codex/design-local-parity`, с отдельными изменениями рейтингов и сохранёнными ранее внесёнными изменениями P1-02. Commit/merge/deploy не выполнялись. В этой фазе production вообще не подключалась; рабочая LOCAL и её данные не менялись. Для PostgreSQL создавались новые disposable кластеры под `local/test-data/structured-cards-pg-*`, с ролью `cards_test`, случайными loopback-портами, очищенным окружением и синтетическим контентом. Существующие production backups и приватные снимки входами этих тестов не были.

**Область решения владельца:** реализованы только обычные пользовательские оценки. Административное изменение счётчиков, общий React-просмотрщик и перевод Admin на React отложены до завершения V2. Это не незакрытые части данного P1. Архитектура карточек, JSON V2, SRS и offline очереди карточек в этой задаче не менялись.

Реализация сохраняет `TMACardRating`, миграцию 92, `/card-ratings` и `useCardRating`:

- Уникальный `(user_id, card_id)` и CHECK миграции 92 по-прежнему обеспечивают один голос +1/−1; отсутствие строки означает отсутствие голоса. PUT null удаляет голос, переключение заменяет его. Новых таблиц, миграций или столбцов-счётчиков нет.
- `GET /card-ratings/deck/{deck_id}?include_counts=true` одним LEFT JOIN/GROUP BY считает реальные Like/Dislike всех живых карточек, включая нули, и возвращает только личные `rating/reason/updated_at` вызывающего аккаунта. Прежний GET без флага сохраняет private-votes контракт. Сводки не содержат user IDs, IDs строк голосов или чужих причин. Все routes используют обычный Bearer и существующий серверный resolver доступа; viewer может оценивать доступную карточку, но не получает право менять её содержимое.
- PUT держит PostgreSQL row lock карточки и выполняет upsert/delete и чтение итоговой сводки в одной транзакции. Блокировка существует и для отсутствующего голоса: конкурентный clear не может удалить строку между upsert и чтением ответа. Запросы одного пользователя и разных пользователей сериализуются; последняя выполненная запись определяет голос.
- `cardRatings.js` хранит только подтверждённые сервером account/card snapshots. Синхронная защита сервиса и UI исключает повторную запись до rerender. Пакетные загрузки объединяются; версии запросов не дают позднему GET вернуть старый голос после записи/отмены. Cache обновляется при повторном открытии по TTL, focus/reconnect и после каждой записи; realtime между устройствами не добавлялся.
- UI выбирает голос, обновляет счётчики и показывает «Оценка сохранена»/dislike-panel только после подтверждения PUT. Все ошибки, включая 404/503, отклоняются. После неопределённого результата выполняется GET карточки: он может подтвердить уже committed голос при потере PUT-ответа, но исходная ошибка остаётся ошибкой без success notice. Если GET также недоступен, UI показывает неизвестные счётчики `—` и не заявляет личный выбор через `aria-pressed`. Offline outbox и автоматических повторов PUT нет; пользователь может повторить действие после восстановления сети.
- Feedback, undo и draft принадлежат аккаунту/карточке; поздние ответы не открывают панели и уведомления другой карточки. Существующее предложение по карточке через `/messages` и причина dislike сохранены.

Проверки текущего исправления:

| Проверка | Результат | Доказательство |
| --- | --- | --- |
| Изолированные backend ratings | 10/10 PASS | `python scripts/test_backend.py scripts/tests/test_card_ratings.py`; switch/clear/retry, own-only reasons, zero totals, ACL/deleted, constant query count на 1/31 карточках, rollback и migration 92 |
| Клиентский сервис | 7/7 PASS | `local/test-data/ratings-service.log`; pending/duplicate, 404/503/500/401/403/network, lost commit, malformed response, late batch, refresh/external clear и account-scoped cache |
| Полный frontend regression suite | 597/597 PASS | `local/test-data/ratings-frontend-regression.log`; финальное уточнение проверки card_id повторно проверено 7 целевыми тестами |
| Смежные backend-регрессии | 9 notes + 36 permissions + 7 study latency + 31 db workers PASS | `local/test-data/ratings-{notes,permissions,study,workers}.log`; каждый suite запущен отдельным изолированным процессом |
| PostgreSQL/socket ratings gate | PASS | Реально применена миграция 92 в новом кластере; 96 конкурентных PUT, включая clear/upsert, одно голосование на user/card, валидные ответы, 401/403/422, настоящие 404 и 503 при недоступной таблице, одна агрегатная выборка на колоду |
| Chromium → HTTP → PostgreSQL | 11/11 PASS, 1.7 min | `local/test-data/ratings-postgres-browser.log`; все девять типов: Theory, Standard, Trainer, Quiz, Match, Puzzle, Word Bank, Free Text, Editable Text; Like↔Dislike, повторное нажатие для удаления, undo, reload, ошибки, offline unknown, потеря ответа после commit, сохранение при навигации и double click |
| PostgreSQL после браузера | PASS | Для каждой из девяти карточек ровно две строки: user 1 = +1, user 2 = −1; GET возвращает likes=1/dislikes=1 и личный голос +1 |
| Существующая footer-регрессия | 1/1 PASS | `local/test-data/ratings-footer-regression.log`; до/после переворота, optional reason, текстовое предложение, Space в textarea и отмена; два fixture-only теста вне PG runner пропущены и сюда не засчитаны |
| Смежный nine-type learning gate | 2/2 Chromium + PostgreSQL/lifecycle PASS | `local/test-data/ratings-learning-regression.log`; online/offline/restart, SRS, 27 уникальных review/Knowledge attempts, личные заметки/флаги/голоса двух аккаунтов; edit/copy/replay/move/reorder/delete/restore сохраняют связи, clear/read-only ACL не расширены |
| Static checks | PASS | Python compilation изменённых Python-файлов, targeted ESLint четырёх JS/JSX, `node --check` browser specs, `git diff --check` |

Геометрия проверена Chromium на ширинах 320/375/430/768/1280: горизонтального overflow нет, touch targets ≥44×44, счётчики и actions доступны. Просмотрены реальные screenshots 320 px/desktop и error/unknown offline; исходные evidence скопированы в ignored `local/test-data/ratings-evidence/` перед следующими browser suites. Это desktop Chromium с эмуляцией viewport, не проверка физических iOS/Android/WebView.

Первый Node запуск упёрся в sandbox spawn EPERM; тот же тест с отключённой внешней сетью вне ограничения прошёл. Начальные попытки нового gate выявили ошибки тестового стенда: mock на Peewee Proxy вместо фактической БД и заглушённый обязательный `/sync/v2/status`. Они исправлены в tests, assertions не ослаблялись. Старая footer fixture также обновлена с удалённого V1-формата до Native V2. Неполные/неуспешные запуски не засчитаны. Production migration 92 не применялась и уже развёрнутый deployment не проверялся.

**P1-01 Like/Dislike закрыт для текущего исправления и указанного покрытия.** Общий production cutover остаётся **NOT READY** из-за остальных пунктов аудита. Это заключение не разрешает production backup, миграции, остановку writers, merge или deploy.

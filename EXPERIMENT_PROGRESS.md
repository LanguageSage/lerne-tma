# Эксперимент по чистке архитектуры TMA

Ветка `experiment/lerne-architecture-cleanup` создана от `96c871f`. Парный Admin создан от `9c7aace`.

## 1. Исходное состояние

| Область | Файлы или строки |
| --- | ---: |
| Отслеживаемые файлы | 1 143 |
| Python / JS / JSX / CSS / JSON | 305 / 202 / 153 / 46 / 37 |
| Frontend `app/src` | 79 414 строк |
| Backend routers / services / card-core | 5 337 / 8 224 / 6 126 строк |
| JS и CSS после чистого Vite build | 2 603 995 байт |
| JS и CSS в gzip с уровнем 9 | 696 342 байта |

Рядом с worktree в игнорируемом `local/test-data` сохранён снимок `tma-cleanup-baseline-inventory.json`. Скрипт `architecture-cleanup-inventory.py` фиксирует 744 модуля со статическими рёбрами или пустым импортным списком, 948 указателей динамики и регистрации, 206 деклараций маршрутов и 898 потенциальных клиентских вызовов. Статический список маршрутов включает fixture apps. Проверка удаления требует учитывать FastAPI mount, worker/CLI, динамические импорты, offline и публичные контракты.

- TMA React использует frontend-код `app/src/card-ui` и собственные интеграции с Dexie, auth и серверным API. Admin получает версионированный `@lerne/card-ui`; обратной зависимости нет.
- `api/card_core/lerne_card_core` — источник wheel 0.2.0. TMA legacy import paths участвуют в deploy и контрактных проверках. SRS, Knowledge, permissions, sync и запись карточек принадлежат TMA.
- `api/v1_to_v2_converter.py` и код обработки старого входного формата входят в импорт, проверку переноса и восстановление данных. Сам факт отсутствия V1 в Native V2 UI недостаточен для удаления.
- Vite сообщает о динамическом импорте уже статически достижимого `services/api.js` и большом entry chunk. Сопоставление потребителей требуется до изменения границы разбиения из-за offline entry и service worker.

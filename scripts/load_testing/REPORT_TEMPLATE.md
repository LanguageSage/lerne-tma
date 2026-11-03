# Отчёт о нагрузочном тестировании FastAPI: [Baseline vs Codex]

## 1. Общие сведения и тестовое окружение

| Параметр | Значение |
|:---|:---|
| **Дата и время тестирования** | YYYY-MM-DD HH:MM UTC |
| **Тестируемая ветка Baseline** | `main` (commit `xxxxxxx`) |
| **Тестируемая ветка Codex** | `codex/c1-fastapi-db-workers` (commit `yyyyyyy`) |
| **Целевой хост** | `http://127.0.0.1:8000` (FastAPI / Uvicorn) |
| **Режим запуска** | Live HTTP / In-process ASGITransport |
| **База данных** | PostgreSQL 17.11 (Native, port 55432, `lerne_tma_local`) |
| **Аппаратная конфигурация** | CPU: [X cores], RAM: [Y GB], OS: Windows / Linux |
| **Параметры ступеней** | Concurrency: 1, 10, 50, 100 VUs |
| **Длительность ступени** | 15–30 секунд на сценарий |
| **Тип данных** | 100% синтетические данные (seeder `980000001`–`980000100`) |

---

## 2. Итоговое резюме (Executive Summary)

- **Общий вердикт:** `[IMPROVED / DEGRADED / SIMILAR]`
- **Пропускная способность (Throughput):**
  - При 1 VU: `...` req/s $\to$ `...` req/s (`+...%`)
  - При 10 VU: `...` req/s $\to$ `...` req/s (`+...%`)
  - При 50 VU: `...` req/s $\to$ `...` req/s (`+...%`)
  - При 100 VU: `...` req/s $\to$ `...` req/s (`+...%`)
- **Латентность p95 (пиковая):**
  - Снижение/рост задержки с `...` мс до `...` мс (`-...%`).
- **Ошибки и стабильность соединений:**
  - Ошибки тайм-аута и пула соединений: `...` (Baseline) $\to$ `...` (Codex).

---

## 3. Сводная таблица сравнения по ступеням нагрузки

| VUs | Сценарий | RPS (Base) | RPS (Codex) | $\Delta$ RPS | p50 (Base) | p50 (Codex) | p95 (Base) | p95 (Codex) | p99 (Base) | p99 (Codex) | Ошибки (Base/Codex) | Вердикт |
|:---:|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **1** | study | | | | | | | | | | | |
| **1** | read | | | | | | | | | | | |
| **1** | sync | | | | | | | | | | | |
| **1** | mixed | | | | | | | | | | | |
| **10** | study | | | | | | | | | | | |
| **10** | read | | | | | | | | | | | |
| **10** | sync | | | | | | | | | | | |
| **10** | mixed | | | | | | | | | | | |
| **50** | study | | | | | | | | | | | |
| **50** | read | | | | | | | | | | | |
| **50** | sync | | | | | | | | | | | |
| **50** | mixed | | | | | | | | | | | |
| **100** | study | | | | | | | | | | | |
| **100** | read | | | | | | | | | | | |
| **100** | sync | | | | | | | | | | | |
| **100** | mixed | | | | | | | | | | | |

---

## 4. Детализация по эндпоинтам (Endpoint Breakdown)

### 4.1. Сценарий Study: Next & Grade
- `GET /api/decks/{deck_id}/next`
- `POST /api/study/grade`

| VUs | Эндпоинт | RPS (Base) | RPS (Codex) | $\Delta$ RPS | p95 (Base) | p95 (Codex) | $\Delta$ p95 | Ошибки |
|:---:|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 10 | `GET /decks/{id}/next` | | | | | | | |
| 10 | `POST /study/grade` | | | | | | | |
| 50 | `GET /decks/{id}/next` | | | | | | | |
| 50 | `POST /study/grade` | | | | | | | |
| 100 | `GET /decks/{id}/next` | | | | | | | |
| 100 | `POST /study/grade` | | | | | | | |

### 4.2. Сценарий Read: Cards & Detail
- `GET /api/decks/{deck_id}/cards`
- `GET /api/study/card/{card_id}`

| VUs | Эндпоинт | RPS (Base) | RPS (Codex) | $\Delta$ RPS | p95 (Base) | p95 (Codex) | $\Delta$ p95 | Ошибки |
|:---:|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 50 | `GET /decks/{id}/cards` | | | | | | | |
| 50 | `GET /study/card/{id}` | | | | | | | |
| 100 | `GET /decks/{id}/cards` | | | | | | | |
| 100 | `GET /study/card/{id}` | | | | | | | |

### 4.3. Сценарий Sync: Pull & Push
- `GET /api/sync/v2/pull`
- `POST /api/sync/v2/push`

| VUs | Эндпоинт | RPS (Base) | RPS (Codex) | $\Delta$ RPS | p95 (Base) | p95 (Codex) | $\Delta$ p95 | Ошибки |
|:---:|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 50 | `GET /sync/v2/pull` | | | | | | | |
| 50 | `POST /sync/v2/push` | | | | | | | |
| 100 | `GET /sync/v2/pull` | | | | | | | |
| 100 | `POST /sync/v2/push` | | | | | | | |

---

## 5. Метрики соединений и поведение пула БД

| Метрика соединения | 1 VU | 10 VU | 50 VU | 100 VU | Поведение Baseline vs Codex |
|:---|:---:|:---:|:---:|:---:|:---|
| **Peak Active HTTP Sockets** | | | | | |
| **Peak Active DB Connections** (`pg_stat_activity`) | | | | | |
| **Peak Total DB Connections** | | | | | |
| **Waiting DB Queries (Lock/Pool)** | | | | | |
| **Socket Timeouts / Resets** | | | | | |
| **Peewee Connection Errors** | | | | | |

---

## 6. Выявленные узкие места и выводы

1. **Поведение при 1–10 пользователях:**
   - [Анализ времени отклика и утилизации ресурсов]
2. **Поведение при 50–100 пользователях:**
   - [Влияние конкурентного доступа, переключение контекста, блокировки строк в БД]
3. **Оценка оптимизаций Codex:**
   - [Обоснование: удалось ли устранить блокировки цикла событий / исчерпание пула соединений]

---

## 7. Ограничения и воспроизводимость

- Все замеры проводились исключительно на синтетическом стенде без обращений к production или внешним API.
- Для автоматической генерации отчёта использовалась команда:
  ```powershell
  python -m scripts.load_testing.compare baseline.json codex.json --output report.md
  ```
- В случае недоступности внешней среды тестирования указать:
  *(Например: «Тестирование проводилось в режиме in-process ASGITransport, так как внешний порт 8000 был занят/недоступен»).*

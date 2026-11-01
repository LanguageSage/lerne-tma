# Сохранение target_relevance в v3 Assessment

01.11.2026, ветка `codex/adaptive-knowledge`.

## Контракт

Минимальное совместимое расширение — optional `evaluation_data.target_relevance`
рядом с `error_types_seen` / `error_codes_seen` существующего v3. Схема БД и
версия события не меняются. Конвертер Free Text передаёт только literal
`primary / secondary / none` через `gradingSummary.final_target_relevance` в
первый result сессии (`targetRelevance`), затем в raw Attempt.

Нет значения, null, неизвестное значение → поле отсутствует. `none` не означает
unknown. Trainer без фактически предоставленной классификации не получает поля.
Skipped не получает relevance; unavailable не создаёт результат/Attempt, ввод
можно повторить. Повторная классификация не заменяет и не дополняет первый
результат, в том числе первый результат без relevance.

Сервер допускает отсутствие поля. Новые события с неизвестным/null значением
или relevance у skipped получают `invalid_assessment_evidence`. Существующие
события проверяются на duplicate/conflict до валидации новых payload. Изменение
поля при прежнем ID даёт `event_conflict`; старое событие без поля остаётся
идемпотентным. Outbox/session schemas, account ownership, транспорт, KI/mappings,
SRS, answer grading и Mastery v1 не менялись. Frozen payload и ID ранее созданных
событий не переписываются; backfill не выполняется.

**Поле является заявлением checker.** Оно не удостоверяет правильность verdict,
наличие целевой ошибки, отсутствие посторонней помощи или независимое владение
навыком. Это не доверенное доказательство ошибки и не новая оценка Mastery.
Существующий scorer игнорирует relevance; даже `incorrect + secondary/none`
сохраняет прежний вклад v3. Семантика прежних событий не переопределяется.

## Проверки

Потеря предоставленного `secondary` воспроизведена на `assessment.js` из HEAD до
изменений: после result conversion в raw отсутствует target_relevance.

- 28 Node tests: whitelist и четыре classified verdict; unknown/Trainer/legacy;
  первый результат и reload; unavailable/skip; Dexie frozen payload, offline
  failure/reopen/replay и account isolation; соседний Free Text lifecycle.
- Ещё 48 Node tests — PASS: Assessment, diagnostic contract, Free Text,
  Knowledge sync и orchestrator. Прежний тест, фиксировавший потерю relevance,
  обновлён на реальный converter; его 20-test suite повторно прошёл.
- 23 server sync tests и 24 Mastery tests — PASS. Проверены optional/invalid
  значения, immutable raw, duplicate/conflict, доступ другого аккаунта, отсутствие
  SRS-записей и неизменность Mastery при всех трёх relevance.
- ESLint runtime JS/JSX и новых JS-тестов, Python compilation, Node syntax checks
  browser scripts — PASS.
- 3 Playwright Assessment tests — PASS: полный 48-card экзамен с сохранением
  relevance у Free Text и отсутствием у Trainer/skip, unavailable → skip → reload,
  rollback IndexedDB и повтор сохранения первого ответа. Проверено отсутствие
  горизонтального overflow на 320/375/430/768/1280px, сохранены снимки результата;
  визуально просмотрены 375px и resumed state. Артефакты —
  `local/test-data/playwright/assessment-*`.
- Настоящие Chromium/IndexedDB → offline/reopen/reconnect → HTTP/FastAPI/Bearer →
  PostgreSQL 17.11 — PASS. Четыре отрицательных Free Text события (три допустимых
  relevance и неизвестное), Trainer correct без поля и skip без поля. Raw JSON
  совпадает с outbox; поздняя correct-проверка не заменяет первый needs_retry.
  Вклад — прежние 4 negative + 1 positive; skip не добавляет evidence, SRS review
  count не меняется. Duplicate/conflict, чужой аккаунт и invalid relevance также
  проверены через HTTP. Прежние проверки стенда, включая конкурентный duplicate,
  смену аккаунта и v2 relevance, прошли.

HTTP/PG артефакты:
`local/test-data/knowledge-postgres/9b61164b005848feb760450912e595e7/results.json`.
`assessment_target_relevance_offline_raw_postgres=PASS`,
`cluster_stopped_and_removed=true`. Стенд создаёт собственный кластер и удаляет
его после проверки; рабочие БД, production migrations и deploy не вызываются.
Сообщение initializer об отсутствующем SUPABASE_DB_URL — известное свойство
тестовой композиции; proxies привязаны к одноразовой PG, сценарий завершился PASS.

Первый Playwright прогон не засчитан: до входа в Assessment устаревшая fixture
возвращала `{}` на `/api/messages`, а актуальный header ожидает массив. В test
setup добавлен корректный пустой массив; повторный полный прогон прошёл за 49.8s.
Прикладной код сообщений не менялся; assertions не ослаблялись.

Команды из корня:

```powershell
python scripts/test_backend.py tests/test_knowledge_sync.py
python scripts/test_backend.py tests/test_knowledge_mastery.py
python scripts/tests/run_knowledge_http_postgres.py --bin-dir C:/121/Lerne_projekt/tools/pgsql/bin
npx --no-install playwright test --project=extended scripts/tests/browser/assessment.spec.cjs
```

Команды из `app`:

```powershell
node --import ../scripts/tests/no-network.mjs --experimental-test-module-mocks --test src/utils/__tests__/assessmentEvidence.test.js src/utils/__tests__/freeTextEvaluationState.test.js src/services/__tests__/knowledgeFlow.test.js
node --import ../scripts/tests/no-network.mjs --experimental-test-module-mocks --test src/utils/__tests__/assessment.test.js src/utils/__tests__/freeTextLifecycle.test.js src/services/__tests__/adaptiveDiagnosticContract.test.js src/services/__tests__/knowledgeSyncService.test.js src/services/__tests__/knowledgeSyncOrchestrator.test.js
```

## Ограничения и следующий минимальный этап

Classified ответы синтетические: качество AI/ASR не проверено. HTTP/PG runner
использует настоящие routers в тестовой композиции без production lifespan.
Node Assessment suite и отдельные browser fixtures используют локальный
игнорируемый снимок курса; новые evidence-регрессии имеют синтетические данные
непосредственно в коде. Android/WebView и несколько вкладок не проверялись.

Следующий минимальный этап — полноценный учёт подсказок, переводов и раскрытия
ответа за попытку: единый владелец счётчиков/флагов, фиксация на момент ответа,
передача в v2/v3 и offline outbox. Контракт обязан различать **известный ноль**
(наблюдение включено, действий не было) и **неизвестное состояние** (данные
отсутствуют/не наблюдались), включая старые события. Отсутствие поля не должно
превращаться в ноль или доказательство самостоятельного ответа. Scoring и
доверенный receipt — отдельные этапы.

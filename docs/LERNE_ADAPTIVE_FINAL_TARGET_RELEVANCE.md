# Сохранение final_target_relevance в v2 Free Text

01.11.2026, ветка `codex/adaptive-knowledge`. Реализация одного улучшения из
[d14-diagnostic-draft-1](LERNE_ADAPTIVE_D14_DIAGNOSTIC_CONTRACT.md).

## Реализовано

`freeTextEvaluationState.evidence()` сохраняет `target_relevance` текущего
classified результата в `gradingSummary.final_target_relevance`. Одинаковое
правило применяется к accepted и exhausted incorrect результатам. Разрешены
только буквальные `primary / secondary / none`. Отсутствие, null и неизвестная
строка не создают поля; отсутствующее значение не подменяется `none`.

Существующий Knowledge Capture уже переносит summary в
`evaluation_data.exercise_evidence.grading_summary`; существующие outbox и sync
сохраняют весь JSON. Поэтому им не потребовались изменения или backfill.
Ранее созданные события, UUID и frozen payload не переписываются.

Это relevance **ошибки по заявлению checker**, не дополнительный verdict,
не confidence и не доказательство наличия/отсутствия проверенной способности.
`none` может быть default AnswerEvaluation и не доказывает отсутствия целевой
ошибки. Из последнего результата не восстанавливаются ранние ошибки: после
primary-error → correct/none сохраняется none; если у финала поля нет, его нет
и в summary. Агрегированная история типов ошибок сохраняет прежнюю семантику.
Unavailable по-прежнему не даёт objective evidence.

SRS, scorer mastery-v1, KI/mappings, алгоритм проверки ответов, v1 и v3 не менялись.
Добавление поля не запрещает и не разрешает contribution: scorer его игнорирует.
Исторический D14-документ остаётся записью состояния до реализации этого leaf.

## Фактически пройденные проверки

- **29 Node tests PASS**, включая 9 прежних draft-semantic tests и текущие
  Free Text/capture регрессии. Проверены whitelist, unknown, retry, exhausted,
  unavailable, сохранение в Dexie, snapshot payload после изменения объекта
  evidence, неизменность валидного старого события без поля.
- **23 Mastery tests PASS** на изолированных fixtures: новый leaf не меняет
  contribution при primary/secondary/none, первом/повторном ответе и
  completed true/false. Существующие golden values и duplicate projection checks
  остаются зелёными. Suite включает тесты migration helpers на SQLite/mock;
  операционные миграции рабочих БД не запускались.
- ESLint изменённого runtime JS и JS-теста, Python compilation и Node syntax
  check изменённого browser harness — PASS.
- **Настоящий HTTP/PostgreSQL 17.11 прогон — PASS** через существующий opt-in
  runner. Chromium: Free Text state с синтетическим classified result → настоящий
  Capture → IndexedDB → offline transport failure/pending → reconnect → настоящий
  FastAPI Knowledge Sync → raw PostgreSQL Attempt. Полный JSON raw совпал с
  outbox; final_target_relevance=secondary сохранился. Duplicate не изменил state;
  изменение leaf при том же event ID дало event_conflict без изменения state.
  Также прошли прежние проверки grade, восьми конкурентных отправок, origin,
  remapping/unmapping и смены аккаунта.

Команды:

```powershell
# Из app
node --import ../scripts/tests/no-network.mjs --test-isolation=none --test src/services/__tests__/adaptiveDiagnosticContract.test.js src/utils/__tests__/freeTextEvaluationState.test.js
# Из корня
python scripts/test_backend.py tests/test_knowledge_mastery.py
python scripts/tests/run_knowledge_http_postgres.py --bin-dir C:/121/Lerne_projekt/tools/pgsql/bin
```

Изолированные логи: `local/test-data/adaptive-final-target-relevance/`.
Успешный HTTP/PG результат:
`local/test-data/knowledge-postgres/e074d84da0e24ef0b7f3fa5a5a6a5214/results.json`;
ключ `free_text_final_target_relevance_raw_postgres=PASS`,
`cluster_stopped_and_removed=true`. Предыдущий запуск `ba8e10c7…` не засчитан:
новый сценарий не обновил KI-кэш после fixture unmapping; исправлен harness,
а не прикладная логика.

## Ограничения и следующий этап

Classified ответ в новом PG-сценарии синтетический; настоящие AI/ASR и
точность грамматического grader не проверялись. Реальны state/capture/storage,
HTTP/auth/sync и PostgreSQL; серверные routers запускаются в тестовой композиции,
без production startup/lifespan. Полные UI, Android и несколько вкладок не
проверялись. Базовые ограничения стенда — в [HTTP/PG отчёте](LERNE_ADAPTIVE_HTTP_POSTGRES.md).

Следующий минимальный этап — согласовать и отдельно перенести этот же атрибут
через v3 assessment result conversion: **3/10**, с сохранением frozen events,
прежнего scoring и explicit unknown. Сейчас v3 relevance по-прежнему теряется;
это не исправлено v2-патчем. Учёт помощи и доверенный result receipt требуют
отдельного контракта. Production, контент и рабочие БД не менялись; деплой не выполнялся.

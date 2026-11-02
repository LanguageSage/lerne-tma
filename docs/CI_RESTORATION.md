# Восстановление Regression checks

Дата: 2026-11-02. База: `main` / `3e1e623ecd54f91f93c06893b62d7b3125d00763`.
Ветка: `codex/restore-regression-ci`.

## Причины

По журналам [запуска 41347311396](https://github.com/LanguageSage/lerne-tma/actions/runs/41347311396):

1. Тесты читали заранее подготовленные файлы из ignored `local/test-data/`.
   Frontend не мог загрузить `assessment.test.js`, `exerciseDetectionCorpus.test.js`,
   `lessonQa.test.js`, `quizParser.test.js`. Из-за `&&` оставшиеся Node-проверки
   не запускались. Backend падал в Structured Cards V2, паспортах колод, общем
   корпусе детекции и серверном контексте free text. Browser останавливался
   при сборе `card-editor.spec.cjs` из-за отсутствующего `quiz_boundaries.json`.
2. `actions/checkout` по умолчанию использовал shallow history. Все пять
   `test_card_core_release.py` падали при `git show 73810af...:<source>`.
   Проверка происхождения требует исходный исторический коммит, а не только HEAD.
3. Настройка загрузки browser failure evidence указывала старые root-каталоги,
   тогда как Playwright пишет в `local/test-data/playwright*`. Это не причина
   красного статуса, но мешало диагностике.

`database-security` в этом запуске прошёл. Lint и build также прошли.

## Исправления и зависимости данных

| Вход | Потребители | Решение |
| --- | --- | --- |
| exercise detection corpus | JS `exerciseDetectionCorpus.test.js`, Python `test_exercise_detection_corpus.py` | 83 синтетических сценария; ожидаемые Python/JS результаты и расхождения сохранены |
| quiz boundaries / compact labels | `quizParser.test.js`, `test_exercise_detection_corpus.py`, `test_single_quiz_analysis.py`, `browser/card-editor.spec.cjs` | Отслеживаемые вымышленные fixtures, прежние комбинации форматов и переносов строк |
| V2 examples | `test_structured_cards_v2.py`, CLI и реальный JS compatibility checker | Пять рукописных schema examples со строковыми ID, все восемь типов; перенесены без изменения контрактных проверок |
| lesson snapshots / passports | JS `lessonQa.test.js`, `assessment.test.js`; Python `test_lesson_qa.py`, `test_lesson_qa_database.py`, `test_deck_passport.py`, `tests/test_answer_evaluation.py`; browser `lesson-qa.spec.cjs`, `assessment.spec.cjs` | Полный синтетический корпус 678 сценариев, 14 колод, независимые примеры семантических регрессий и детерминированная генерация |
| optional D14 support | JS `trainerSupportEvidence.test.js`, browser `trainer-support.spec.cjs`, `run_knowledge_http_postgres.py` + `knowledge_http_browser.cjs` | Те же отслеживаемые fixtures, синтетические ID; флаги запуска сохранены |
| editable corpus | `browser/editable-corpus.spec.cjs`, `browser/editable-text.spec.cjs` | Сохранены все 65 форм разметки, текст и ID заменены синтетическими |

Естественный текст приватных корпусов заменён вымышленными токенами. Все числовые
идентификаторы записей заменены тестовыми. Нет пользовательских записей, медиа,
секретов, runtime-конфигурации, БД или backups. `card-cases.json` хранит только
обезличенный синтаксис, grading policy и symbolic competency IDs; генератор не
читает локальные источники. Экзамен сохраняет 46 основных + 2 бонусных задания,
неизменность первого ответа, пропуски, оценку 40/46 при шести ошибках, outbox и
support/target-relevance evidence. Проверки ошибочного и исправленного quiz key,
отклонения семантических альтернатив exact trainer, source/task и ID/порядка
сохранены на независимо написанных примерах.

Оставшиеся `local/test-data/` в тестах — **выходы**: временные SQLite, аудио,
wheel, PostgreSQL scratch и screenshots/reports. `offline_sandbox.py` создаёт
свой внешний sandbox. `prepare_relativsaetze_updates.py` и ручной
`lesson_qa.py --snapshot ...` по-прежнему требуют приватные снимки, но не входят
в автоматический gate. Комментарий в версионированном card-core может содержать
исторический путь: исходные байты пакета защищены provenance и не менялись.

Дополнительно: `fetch-depth: 0`; LF для card-core закреплён `.gitattributes`;
путь browser artifacts исправлен. Два расширенных browser harness обновлены
для действующего входа и ответа `/api/messages` в виде массива. Для новых
синтетических форм word bank/editable добавлены отдельные DOM-assertions.

## Граница production

`.vercelignore` явно исключает `tests/`; root allowlist продолжает разрешать
только app/API и необходимые build inputs. `verify_deploy_files.py` проверяет
каждую текущую fixture и будущий путь-маркер. `test_deploy_manifest.py` отдельно
проверяет отсутствие fixtures и тестов в upload manifest. Runtime frontend
не импортирует fixtures. Production-код, бизнес-логика, migrations и настройки
авторизации приложения не изменены.

## Изменённые файлы

48 файлов (включая новые fixtures и этот отчёт):

```text
.agents/AGENTS.md
.agents/subsystems/cards.md
.agents/subsystems/study.md
.gitattributes
.github/workflows/checks.yml
.vercelignore
api/card_core/README.md
app/src/utils/__tests__/assessment.test.js
app/src/utils/__tests__/exerciseDetectionCorpus.test.js
app/src/utils/__tests__/lessonQa.test.js
app/src/utils/__tests__/quizParser.test.js
app/src/utils/__tests__/trainerSupportEvidence.test.js
docs/CI_RESTORATION.md
docs/LESSON_QA.md
docs/TEST_DATA.md
scripts/tests/browser/assessment.spec.cjs
scripts/tests/browser/card-editor.spec.cjs
scripts/tests/browser/editable-corpus.spec.cjs
scripts/tests/browser/editable-text.spec.cjs
scripts/tests/browser/lesson-qa.spec.cjs
scripts/tests/browser/trainer-support.spec.cjs
scripts/tests/knowledge_http_browser.cjs
scripts/tests/run_knowledge_http_postgres.py
scripts/tests/test_deck_passport.py
scripts/tests/test_deploy_manifest.py
scripts/tests/test_exercise_detection_corpus.py
scripts/tests/test_lesson_qa.py
scripts/tests/test_lesson_qa_database.py
scripts/tests/test_single_quiz_analysis.py
scripts/tests/test_structured_cards_v2.py
scripts/verify_deploy_files.py
tests/fixtures/README.md
tests/fixtures/editable-cards.json
tests/fixtures/exercise_detection_corpus.json
tests/fixtures/generate_lessons.py
tests/fixtures/lesson-qa/before.json
tests/fixtures/lesson-qa/card-cases.json
tests/fixtures/lesson-qa/corrected.json
tests/fixtures/lesson-qa/passport-proposals.json
tests/fixtures/lesson-qa/source-ids.json
tests/fixtures/quiz_boundaries.json
tests/fixtures/quiz_compact_labels.json
tests/fixtures/structured_cards_v2/basics.json
tests/fixtures/structured_cards_v2/match.json
tests/fixtures/structured_cards_v2/other_types.json
tests/fixtures/structured_cards_v2/puzzle_quiz.json
tests/fixtures/structured_cards_v2/word_bank_free_text.json
tests/test_answer_evaluation.py
```

## Проверки

Финальный `npm run check`: **PASS**, exit 0, `All checks passed`.

| Проверка | Результат |
| --- | --- |
| Frontend app tests | 606 passed, 0 failed/skipped |
| Дополнительные Node tests | 112 passed, 0 failed/skipped |
| Backend allowlist | 39 suites, 500 tests, PASS |
| Critical Playwright | 81 passed, 3.4 min |
| ESLint | PASS |
| Production Vite build | PASS; остаются предупреждения о больших chunks и смешанных static/dynamic imports |
| Extended Playwright с `LERNE_D14_SUPPORT=1` | 37 passed, 5.4 min; все изменённые дополнительные browser specs |
| Дополнительные Python-потребители fixtures | Lesson QA 6 + SQLite/SRS 2 + Single Quiz 18: PASS |
| Опциональные unit-сценарии и lesson/assessment | 23 passed с `LERNE_D14_SUPPORT=1` |
| Отдельная security isolation suite | 4 passed; dotenv/startup, TCP/UDP/PostgreSQL заблокированы |
| Vercel boundary suite | 6 passed |
| Offline deployment manifest | PASS, 22 обязательных ресурса; все fixtures исключены |
| `generate_lessons.py --check`, Python/JS syntax, `git diff --check` | PASS |
| Сканирование новых fixtures на секреты, приватные поля и бинарные файлы | PASS |

Воспроизводимость: свежий clone актуального `main` с GitHub с полной историей,
затем перенесены только исправленные исходники и новые синтетические fixtures.
`npm ci` выполнен отдельно в корне и `app/`; Python dependencies установлены из
`requirements-test.txt` в отдельном окружении. Перед финальным gate в клоне
не было `local/test-data/`, `.env`, пользовательских БД или снимков. Сгенерированные
артефакты предыдущего прогона сохранены вне клона. Все конечные тестовые/исполняемые
файлы и fixtures в клоне побайтово сверены с рабочей веткой. Проверка LF-атрибутов
card-core также пройдена. Runtime frontend не читает `tests/fixtures/`.

Логи находятся только в ignored `local/test-data/`: `ci-clean-final-check.log`,
`ci-extended-verified.log`, `ci-test_lesson_qa.log`, `ci-test_lesson_qa_database.log`,
`ci-test_single_quiz_analysis.log`, `ci-security-isolation.log`,
`ci-deploy-boundary.log`, `ci-npm-audit-root.json`, `ci-npm-audit-app.json`.
Новые fixtures и остальные изменения добавлены в индекс Git; commit/push не сделаны.

## Ограничения и оставшиеся вопросы

- `npm audit`: root — 9 уязвимостей (1 critical, 2 high, 6 moderate);
  app — 28 (1 critical, 11 high, 15 moderate, 1 low). Эти результаты относятся
  к существующим lock-файлам; автоматический `audit fix` не выполнялся.
  Critical/high root: `@capacitor/android`, `@xmldom/xmldom`, `brace-expansion`.
  В app также: `axios`, `browserslist`, `form-data`, `js-yaml`, `nanoid`,
  `postcss`, `source-map-js`, `vite`, `zod`.
- Отдельный PostgreSQL security job локально не запускался: задача запрещает
  изменения БД. В исходном GitHub run он зелёный; его workflow и SQL не менялись. Opt-in native
  Knowledge HTTP/PostgreSQL runner также не запускался; его Python/JS синтаксис
  проверен, а три support-сценария проверены отдельно в unit/browser тестах.
- Деплой и проверка реального Vercel upload не выполнялись. Проверены offline
  manifest, runtime import boundary и локальная production-сборка.
- Локальная платформа: Windows, Node 24.14.0, Python 3.14.3; GitHub использует
  Ubuntu и Python 3.12. Успешный локальный прогон не выдаётся за новый GitHub run.
- Commit/push, PR, deployment и merge в main не выполнялись. Изменения подготовлены
  в отдельной рабочей ветке; для зелёного статуса на GitHub нужен запуск workflow
  с этими изменениями (например, PR или workflow_dispatch).

Политика fixtures и команды: [TEST_DATA](TEST_DATA.md).

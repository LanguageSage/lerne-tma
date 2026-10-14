# Lerne Lesson QA

Операторский инструмент проверки перед публикацией. Production-контент и результаты учеников не изменяет. Использует реальные frontend-парсеры и evaluator Trainer; паспорта проверяет существующий Python validator. Новых зависимостей и публичного endpoint нет.

## Запуск из корня репозитория

```powershell
python scripts/lesson_qa.py --snapshot reports/lesson-qa/relativsaetze.snapshot.json --output reports/lesson-qa/result.json
python scripts/lesson_qa.py --import-file lesson.txt --output reports/lesson-qa/import.json
python scripts/lesson_qa.py --folder-id 285 --save-snapshot reports/lesson-qa/source.json --output reports/lesson-qa/folder.json
python scripts/lesson_qa.py --deck-id 7139 --output reports/lesson-qa/deck.json
```

Файл импорта использует существующий формат «Автора»: заголовки колод, FRONT/BACK/CONTEXT, разделители и паспорта. Ошибки структуры и схемы сохраняются как ERROR в отчёте; содержимое не исправляется. IDs из импорта сохраняются; для новых карточек используются только локальные отрицательные IDs отчёта.

ID-режимы используют настроенный SUPABASE_DB_URL из существующей конфигурации. Предпочтителен отдельный DB-role с правом SELECT. Не добавляйте credentials в команды, отчёты или Git. CLI заранее отключает import-time migrations в api.models и начинает PostgreSQL-транзакцию с SET TRANSACTION READ ONLY. Выбирает активные колоды и карточки; папка включает активных потомков. Не читает прогресс или пользовательскую историю. Offline-режимы не открывают DB-соединение, но импорт API-модулей может настроить database proxy.

Операторский доступ к SQL не заменяет пользовательскую авторизацию: не выставлять этот CLI публичным HTTP endpoint. При будущей API-интеграции требуется существующая проверка owner/editor scope.

Коды завершения: 0 — без ERROR; 1 — отчёт создан, есть ERROR; 2 — ошибка чтения/окружения. WARNING и SUGGESTION сами не блокируют публикацию.

## Что проверяется

- Поддерживаемые директивы, runtime тип, доступность ключей, пустые ответы и поля, JSON metadata.
- Trainer принимает authored answer; длинный единственный эталон помечается для проверки альтернатив.
- `grading_policy` и `accepted_answers` проверяются по действующему серверному контракту. Для open_text критерии описываются в задании/эталоне/learning target; отдельного поля rubric в текущем GradingPolicy нет.
- Quiz/Match/Word Bank/Free/Puzzle разбираются существующими parser-модулями.
- Несколько интерактивных блоков, дубли ID, одинаковые FRONT/BACK.
- Каноническая схема паспорта, диапазоны этапов по **порядковым номерам**, пропуски, пересечения, ссылки рекомендаций на компетенции.
- Потенциальные утечки решения через Puzzle BACK или visible example, controlled_text default для свободной продукции.
- Assessment без явной runtime-конфигурации даёт WARNING. Канонический валидатор проверяет конфигурацию; Lesson QA проверяет число заданий, поддерживаемые механики и компетенции карточек. Реализованный режим описан в [ASSESSMENT](ASSESSMENT.md).

Ссылки review_recommendations на компетенции, отсутствующие в текущей колоде, дают WARNING: схема допускает описание компетенций целевой колоды. Не добавляйте фиктивные локальные компетенции только ради устранения предупреждения.

Стабильные severity: ERROR — доказанная структурная ошибка; WARNING — кандидат для авторской проверки; SUGGESTION — необязательное улучшение. Совпадение с authored key доказывает техническую согласованность, а не грамматическую правильность. Инструмент не знает все допустимые немецкие альтернативы.

## Проверки и границы

```powershell
node --test --test-isolation=none app/src/utils/__tests__/lessonQa.test.js
python -m unittest discover -s scripts/tests -p test_lesson_qa.py -v
python -m unittest discover -s scripts/tests -p test_lesson_qa_database.py -v
npx --no-install playwright test scripts/tests/browser/lesson-qa.spec.cjs --workers=1
```

Последняя команда — конкретный regression fixture курса Relativsätze, а не автоматическое E2E любого нового урока. Новому уроку нужен собственный снимок и выбранные поведенческие сценарии существующего browser harness. Не подменять E2E статическим JSON отчётом.

Грамматику, естественность и педагогическую адекватность проверять отдельно автором или моделью с сохранением исходника, предлагаемого текста, причины, уверенности и источников. В этом MVP платного AI-provider и автоматического переписывания карточек нет.

Артефакты аудита Relativsätze находятся в reports/lesson-qa: неизменяемый снимок, структурный отчёт, semantic coverage, предложения контента/паспортов и русский итоговый отчёт. `python scripts/prepare_relativsaetze_updates.py` собирает отдельные corrected.snapshot.json и update-plan.json с original/proposed значениями и проверкой ID/порядка. Он не подключается к БД и ничего не применяет. Lesson QA не заменяет авторское утверждение содержательных изменений.

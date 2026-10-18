# Структурированные карточки V2 — слой авторства и компиляция в DSL

> **Заморожено нативное хранение V2 (2026-10-16, по архитектурному аудиту).**
> Этапы нативного хранения (`content_v2`, миграция 87, `legacy_card_writes`, `/sync/v3`, CAS-ревизии и native writes) остановлены и не применяются.
> Активным является **Option B (Authoring V2 JSON → детерминированная компиляция в существующий DSL)**:
> ИИ или автор создаёт карточки в строгом контракте V2 JSON → `structured_cards_v2.py` валидирует структуру → `structured_cards_legacy.py` (`to_legacy_card` / `to_legacy_document`) компилирует карточку в существующий DSL (`FRONT`/`BACK`/`CONTEXT`/`metadata`) с обязательной round-trip проверкой (`parse_exercise_content`, `detect_card_type`, `detect_ai_input_type`) → сохранение идёт через стандартный конвейер публикации (`author_service.py` → `bulk_save_cards`) без изменения схемы БД, синхронизации, офлайн-режима или SRS.

V2 — JSON-контракт для авторства уроков человеком и ИИ. Тип задан явно; ответы и данные упражнения не извлекаются из текста `FRONT`. В «Авторе уроков» доступны как предварительный просмотр JSON V2 (`/api/admin/author/v2-preview`), так и разбор/публикация V2 JSON через `author_service.parse_document`.

## Что обнаружено в действующей архитектуре

| Путь | Владелец и ограничения |
| --- | --- |
| Редактор → сохранение | `cardData.front` → `/cards/save` → `TMA_Card.front_text`; offline — Dexie. `back_text`, `context`, `topics`, `metadata` — отдельные поля. |
| Быстрый импорт | `app/src/utils/batchCardParser.js`: секции FRONT/BACK/CONTEXT, затем информационные блоки и определение типа по FRONT. Может достраивать BACK и уровень по умолчанию. |
| «Автор» / CLI | `api/services/author_service.py`: документ с колодами и паспортами (в формате Lerne Codex или V2 JSON), наследование уровня/темы, сохранение через `bulk_save_cards`. |
| Граница текста и информации | `exerciseContentParser.js` и `input_parser.py`: task/source/example/options, exercise и маркер Theory. `source` не равен CONTEXT. |
| Упражнения | `exerciseDetector.js`, `clozeParser.js`, `quizParser.js`, `matchParser.js`, `wordBankParser.js`, `freeTextParser.js`; Puzzle собирается в `StudyCardPuzzle.jsx`. |
| Проверка | `trainerEvaluation.js` принимает варианты ответа через `\|`; `answer_contract.py` владеет политикой проверки открытого ответа. |

## Документ

```json
{
  "schema_version": 2,
  "deck": {"name": "Немецкий: прошлое"},
  "cards": [{
    "id": "past-mixed-1",
    "type": "trainer",
    "info": [{"type": "task", "text": "Ergänzen Sie den Satz."}],
    "data": {
      "parts": [
        {"type": "choice", "options": [
          {"text": "Als", "correct": true}, {"text": "Wenn"}
        ]},
        {"type": "text", "text": " ich ankam, "},
        {"type": "input", "answers": ["hatte"]},
        {"type": "text", "text": " sie schon gegessen."}
      ]
    },
    "explanation": "Als — однократное событие в прошлом."
  }]
}
```

Один документ описывает одну колоду и непустой список карточек в учебном порядке.
Обязательны `schema_version`, `deck.name`, `cards`, `card.type`, `card.data`.
`schema_version` — целое `2`; неизвестные поля и типы запрещены, значения не приводятся автоматически из строк/чисел/bool. Пустой обязательный текст запрещён.
Строки содержат обычный текст/Markdown; маркеры legacy не имеют специального значения в V2. Никакого шаблона `{{gap}}` и повторного разбора строки не требуется.

Общие необязательные поля карточки:

| Поле | Значение |
| --- | --- |
| `id` | Непустая строка, уникальная внутри документа; авторская ссылка, не ID записи БД. |
| `info` | Упорядоченные информационные блоки перед упражнением: `{type: task/source/example, text}` либо `{type: options, items: [...]}`. Блоки можно повторять. Их текст не определяет тип карточки. |
| `explanation` | Пояснение после ответа, соответствует legacy CONTEXT, по умолчанию `""`. |
| `level` | CEFR A1–C2; отсутствие или null наследует `passport.intro.level`. |
| `topics` | Массив непустых строк; отсутствие или null наследует `[passport.intro.topic]`, `[]` явно снимает темы. |
| `metadata` | JSON-объект расширений: происхождение, теги, авторские заметки. Не место для второго экземпляра содержимого/ответов. |

## Данные всех типов

| `type` | Обязательные данные в `data` | Ответ / дополнительные данные |
| --- | --- | --- |
| `theory` | `text` | Необязательный `summary` — оборот карточки, по умолчанию пустой. Примеры с пропусками в тексте остаются теорией. |
| `standard` | `prompt`, `answer` | Текст вопроса и оборот. |
| `trainer` | `parts` | Последовательность text/input/choice, минимум один пропуск. Режим определяется каждым пропуском, смешанный Trainer не требует отдельного типа. |
| `quiz` | `prompt`, `options` | Минимум два `{text, correct?}`. `correct` по умолчанию false, минимум один true; в legacy-проекции требуется ровно один правильный вариант. |
| `match` | `pairs: [{left, right}, ...]` | Минимум две пары. Пары и их порядок сохраняются, включая повторы. |
| `puzzle` | `tokens: ["Ich", "bin", "angekommen."]` | Непустой массив токенов в правильном порядке. Необязательный `translation`. |
| `word_bank` | `options: ["habe", "bin", ...]`, `parts` | text либо `{type: "gap", option: 0}`. `option` — индекс правильного элемента options с нуля, один элемент расходуется один раз. |
| `free_text` | `prompt`, `sample_answer` | Образец не является точным ключом. Необязательные `accepted_answers`, `grading_policy` используют действующий контракт. При отсутствии политики используется `mode: open_text`. |

## Реализация и запуск

- `api/services/structured_cards_v2.py`: строгие Pydantic-модели всех 8 типов, `validate_document(dict)`, `load_document(json_text)`, `validate_card(dict)`, `load_card(json_text)`, `normalize_card(card)` и генерируемая JSON Schema.
- `api/services/structured_cards_legacy.py`: `to_legacy_card(card, deck, index)` и `to_legacy_document(dict | Document)` для всех восьми типов с проверкой `parse_exercise_content`, `detect_card_type` и `detect_ai_input_type`.
- `api/services/author_service.py`: `parse_document` прозрачно принимает как текстовый формат Lerne Codex, так и V2 JSON (компилируя его через `to_legacy_document` и сохраняя `metadata` при публикации).
- `tools/admin/services/structured_preview.py` и `POST /api/admin/author/v2-preview`: покарточный предпросмотр V2 JSON без записи в БД.
- `scripts/structured_cards_v2.py`: CLI (`validate`, `to-legacy`, `schema`).

```powershell
python scripts/structured_cards_v2.py validate project_docs/examples/structured_cards_v2/basics.json
python scripts/structured_cards_v2.py to-legacy project_docs/examples/structured_cards_v2/basics.json
python scripts/structured_cards_v2.py schema
python -m unittest scripts.tests.test_structured_cards_v2 scripts.tests.test_structured_preview -v
```

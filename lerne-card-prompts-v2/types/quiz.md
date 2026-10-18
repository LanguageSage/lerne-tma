# Тип: Quiz (`type: "quiz"`)

## WHEN TO USE
Тестовый вопрос с выбором одного правильного ответа из отдельного списка вариантов под вопросом.

## FORMAT (`card.data`)
- `"prompt"` *(обязательно, `string`)* — текст вопроса.
- `"options"` *(обязательно, `array`, минимум 2 элемента)* — список объектов `{"text": "...", "correct": true/false}`. Для совместимости с компилятором DSL ровно один вариант должен иметь `"correct": true`.

```json
{
  "id": "capital-quiz",
  "type": "quiz",
  "info": [
    {"type": "task", "text": "Beantworten Sie die Frage."}
  ],
  "data": {
    "prompt": "Welcher Satz steht im Plusquamperfekt?",
    "options": [
      {"text": "Ich habe den Brief geschrieben."},
      {"text": "Ich hatte den Brief schon geschrieben.", "correct": true},
      {"text": "Ich schrieb den Brief."}
    ]
  },
  "explanation": "Plusquamperfekt образуется с помощью Präteritum вспомогательного глагола (hatte/war) + Partizip II."
}
```

## VALIDATION
- `"type"` равен `"quiz"`.
- В `"data.options"` минимум 2 уникальных варианта, и **ровно один** помечен `"correct": true`.
- Тексты в `"options"` однострочные, не начинаются с префиксов списка (`A)`, `1.`, `-`, `•`, `*`) и не содержат Markdown-символов `*`, `_`, `` ` `` или скобок `[[...]]` / `{...}`.
- В `"data.prompt"` нет пустых строк (`\n\n`) и пробелов перед знаками препинания (` ?`, ` !`).

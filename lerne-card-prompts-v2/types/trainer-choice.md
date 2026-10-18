# Тип: Trainer Choice (`type: "trainer"`, `part.type: "choice"`)

## WHEN TO USE
Встраиваемый (inline) выбор правильного варианта прямо внутри предложения (артикли, предлоги, союзы, окончания, порядок слов).

## FORMAT (`card.data`)
Карточка имеет `"type": "trainer"`, а `"data.parts"` включает элементы:
- `{"type": "text", "text": "..."}` — текст вокруг места выбора (сохраняйте пробелы!).
- `{"type": "choice", "options": [{"text": "...", "correct": true}, {"text": "..."}]}` — список минимум из 2 вариантов. У правильного варианта указывается `"correct": true` (по умолчанию `false`).

```json
{
  "id": "trainer-choice-1",
  "type": "trainer",
  "info": [
    {"type": "source", "text": "Zuerst fuhr der Zug ab. Dann kamen wir am Bahnhof an."},
    {"type": "task", "text": "Wählen Sie das passende Hilfsverb."}
  ],
  "data": {
    "parts": [
      {"type": "text", "text": "Der Zug "},
      {
        "type": "choice",
        "options": [
          {"text": "war", "correct": true},
          {"text": "hatte"}
        ]
      },
      {"type": "text", "text": " schon abgefahren."}
    ]
  },
  "explanation": "Поезд уже уехал. Глагол abfahren обозначает движение и образует Plusquamperfekt с war."
}
```

## VALIDATION
- В каждом `"choice"` минимум 2 варианта с уникальными `"text"`, минимум один имеет `"correct": true`.
- Неправильные варианты (дистракторы) не должны совпадать с правильным при нормализации регистра/пунктуации.
- Тексты вариантов не содержат звёздочек `*`, скобок `[ ] { }` или черты `|`.
- Пробелы вокруг места выбора находятся в соседних элементах `"text"`.

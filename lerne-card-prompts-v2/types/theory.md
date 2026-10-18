# Тип: Theory (`type: "theory"`)

## WHEN TO USE
Карточка с правилом, грамматической формулой, таблицей или кратким теоретическим объяснением перед серией практических упражнений (без проверки ввода).

## FORMAT (`card.data`)
- `"text"` *(обязательно, `string`)* — полный текст правила и примеры.
- `"summary"` *(необязательно, `string`, по умолчанию `""`)* — краткая выжимка/формула для обратной стороны карточки.

```json
{
  "id": "plusquamperfekt-theory",
  "type": "theory",
  "info": [
    {"type": "task", "text": "Lesen Sie die Regel und das Beispiel."}
  ],
  "data": {
    "text": "Das Plusquamperfekt beschreibt ein früheres Ereignis in der Vergangenheit.\n\nForm: hatte/war + Partizip II.\nBeispiel: Als ich ankam, hatte sie schon gegessen.",
    "summary": "Предпрошедшее время: hatte/war + Partizip II."
  },
  "explanation": "Используется для действия, завершившегося раньше другого действия в прошлом."
}
```

## VALIDATION
- `"type"` равен `"theory"`.
- `"data.text"` непустой и не содержит синтаксических маркеров `@theory` (маркер добавляется компилятором автоматически).

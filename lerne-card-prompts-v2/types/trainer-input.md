# Тип: Trainer Input (`type: "trainer"`, `part.type: "input"`)

## WHEN TO USE
Точный ввод слова, грамматической формы, окончания или перевода с клавиатуры прямо внутри предложения.

## FORMAT (`card.data`)
Карточка имеет `"type": "trainer"`, а `"data.parts"` состоит из чередующихся фрагментов текста и полей ввода:
- `{"type": "text", "text": "..."}` — неизменяемый текст вокруг пропусков (включая пробелы и знаки препинания!).
- `{"type": "input", "answers": ["..."]}` — пропуск для ввода с клавиатуры. В `answers` указывается один или несколько равноправных точных вариантов ответа.

*Примечание:* Ввод (`"input"`) и выбор (`"choice"`) можно свободно комбинировать в одном массиве `data.parts` внутри одной карточки `"type": "trainer"`.

### Пример одиночного Trainer Input:
```json
{
  "id": "trainer-input-1",
  "type": "trainer",
  "info": [
    {"type": "task", "text": "Ergänzen Sie die richtige Form im Plusquamperfekt."}
  ],
  "data": {
    "parts": [
      {"type": "text", "text": "Er "},
      {"type": "input", "answers": ["war"]},
      {"type": "text", "text": " schon nach Hause "},
      {"type": "input", "answers": ["gegangen"]},
      {"type": "text", "text": "."}
    ]
  },
  "explanation": "Он уже ушёл домой. Глагол движения gehen образует Plusquamperfekt с war + Partizip II (gegangen)."
}
```

### Пример комбинированного Trainer (Choice + Input):
```json
{
  "id": "trainer-mixed-1",
  "type": "trainer",
  "info": [
    {"type": "task", "text": "Wählen Sie die Konjunktion und ergänzen Sie die Verbformen."}
  ],
  "data": {
    "parts": [
      {
        "type": "choice",
        "options": [
          {"text": "Als", "correct": true},
          {"text": "Wenn"}
        ]
      },
      {"type": "text", "text": " ich ankam, "},
      {"type": "input", "answers": ["hatte"]},
      {"type": "text", "text": " sie schon "},
      {"type": "input", "answers": ["gegessen"]},
      {"type": "text", "text": "."}
    ]
  },
  "explanation": "Когда я пришёл, она уже поела. Als используется для однократного события в прошлом."
}
```

## VALIDATION
- В `data.parts` есть минимум один элемент `"input"` (или `"choice"`).
- Пробелы между словами сохранены в соседних элементах `{"type": "text", "text": " "}`.
- Строки внутри `"answers"` не содержат ведущих/хвостовых пробелов, переводов строк и спецсимволов `[ ] { } | ; , / * _ \` < >`.
- В `"explanation"` приведён перевод всей фразы и объяснение правила.

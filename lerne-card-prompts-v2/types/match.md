# Тип: Match (`type: "match"`)

## WHEN TO USE
Сопоставление пар: слово $\leftrightarrow$ перевод, глагол $\leftrightarrow$ вспомогательный глагол/управление, начало $\leftrightarrow$ продолжение реплики.

## FORMAT (`card.data`)
- `"pairs"` *(обязательно, `array`, минимум 2 элемента)* — массив объектов `{"left": "...", "right": "..."}`.

```json
{
  "id": "perfekt-match",
  "type": "match",
  "info": [
    {"type": "task", "text": "Ordnen Sie die Verben dem passenden Hilfsverb zu."},
    {"type": "example", "text": "fahren → sein"}
  ],
  "data": {
    "pairs": [
      {"left": "ankommen", "right": "sein"},
      {"left": "lesen", "right": "haben"},
      {"left": "einschlafen", "right": "sein"},
      {"left": "arbeiten", "right": "haben"}
    ]
  },
  "explanation": "Глаголы движения и смены состояния (ankommen, einschlafen) требуют sein; остальные (lesen, arbeiten) — haben."
}
```

## VALIDATION
- `"type"` равен `"match"`.
- В `"data.pairs"` минимум 2 пары (оптимально 3–6 пар на карточку).
- В строках `"left"` и `"right"` нет переводов строк, ведущих/хвостовых пробелов, разделителей `=>`, `->`, `—`, `=` и символов Markdown `*`, `_`, `` ` ``.

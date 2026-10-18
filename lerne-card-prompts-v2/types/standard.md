# Тип: Standard (`type: "standard"`)

## WHEN TO USE
Классическая двусторонняя карточка (слово/выражение $\rightarrow$ перевод, вопрос $\rightarrow$ прямой ответ) без интерактивного ввода или выбора.

## FORMAT (`card.data`)
- `"prompt"` *(обязательно, `string`)* — лицевая сторона карточки (вопрос, слово или выражение).
- `"answer"` *(обязательно, `string`)* — обратная сторона карточки (перевод или ответ).

```json
{
  "id": "ankommen-standard",
  "type": "standard",
  "data": {
    "prompt": "ankommen — kam an — ist angekommen",
    "answer": "прибывать, приезжать"
  },
  "explanation": "Глагол движения с отделяемой приставкой an-; в Perfekt используется вспомогательный глагол sein."
}
```

## VALIDATION
- `"type"` равен `"standard"`.
- Заполнены оба поля `"data.prompt"` и `"data.answer"`.
- В `"data.prompt"` нет списков с `[*]` или `A) *`, которые могли бы интерпретироваться как `quiz`.

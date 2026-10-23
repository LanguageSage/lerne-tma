# Тип: Free Text (`type: "free_text"`)

## WHEN TO USE
1. **Открытые высказывания (`mode: "open_text"`, по умолчанию)**: ответ в 1–5 предложениях своими словами (описание ситуации, мнение, рассказ о себе).
2. **Контролируемая трансформация предложения (`mode: "controlled_text"` или `"exact"`)**: переписать целое предложение в нужном времени/залоге, когда допустимы несколько полных формулировок.
*(Для вписывания одного слова или формы внутри готового предложения используйте `"trainer"`!)*
Если ученик правит предзаполненный ошибочный текст, используй `editable_text`.

## FORMAT (`card.data`)
- `"prompt"` *(обязательно, `string`)* — формулировка вопроса или исходного предложения для трансформации.
- `"sample_answer"` *(обязательно, `string`)* — эталонный образец ответа (*Musterlösung*).
- `"accepted_answers"` *(необязательно, `string[]`, по умолчанию `[]`)* — дополнительные допустимые варианты полного ответа (до 20 вариантов).
- `"grading_policy"` *(необязательно, `object`)* — политика проверки:
  - `{"mode": "open_text", "max_retries": 3}` — свободный ответ по смыслу и грамматике (по умолчанию).
  - `{"mode": "controlled_text", "max_retries": 2}` — контролируемый перевод/трансформация предложения.

### Пример 1. Открытый ответ (`open_text`):
```json
{
  "id": "weekend-open",
  "type": "free_text",
  "info": [
    {"type": "source", "text": "Eine Freundin fragt: Was hast du am Wochenende gemacht?"}
  ],
  "data": {
    "prompt": "Antworten Sie in zwei bis drei Sätzen im Perfekt.",
    "sample_answer": "Am Samstag habe ich Freunde besucht. Wir haben zusammen gekocht und einen Film gesehen."
  },
  "explanation": "Образец ответа в Perfekt. Проверьте выбор haben/sein и место Partizip II в конце предложения."
}
```

### Пример 2. Контролируемая трансформация предложения (`controlled_text`):
```json
{
  "id": "perfekt-controlled",
  "type": "free_text",
  "info": [
    {"type": "task", "text": "Schreiben Sie den Satz im Perfekt."}
  ],
  "data": {
    "prompt": "Ich besuche meine Freunde.",
    "sample_answer": "Ich habe meine Freunde besucht.",
    "accepted_answers": ["Ich habe Freunde besucht."],
    "grading_policy": {
      "mode": "controlled_text",
      "max_retries": 2
    }
  },
  "explanation": "Я навестил своих друзей. Глагол с неотделяемой приставкой be- образует Partizip II без ge- (besucht)."
}
```

## VALIDATION
- `"type"` равен `"free_text"`.
- Заполнены оба обязательных поля `"data.prompt"` и `"data.sample_answer"` (без ведущих и хвостовых пробелов).
- В `"data.prompt"` нет символов Markdown (`*`, `_`, `` ` ``) и маркеров `@free` (маркер подставляется компилятором).

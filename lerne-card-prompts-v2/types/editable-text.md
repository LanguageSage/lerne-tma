# Editable Text (`type: "editable_text"`)

Исправление готового текста в одном поле. Для свободного ответа используй Free Text, для отдельного пропуска — Trainer, для перестановки токенов — Puzzle.

`data.source_text` — ошибочный текст; `data.correct_text` — полное исправление. Оба поля обязательны, различаются и не превышают 4000 символов. Необязательны `accepted_answers` (полные допустимые варианты) и `grading_policy` (`controlled_text` или `exact`; по умолчанию первый, без зачёта опечаток, 3 попытки). Перевод до проверки задавай через `info.source`; правило — в `explanation`.

```json
{"type":"editable_text","info":[{"type":"task","text":"Исправьте лишнее местоимение."}],"data":{"source_text":"Ich trainiere regelmäßig, um ich stärker zu werden.","correct_text":"Ich trainiere regelmäßig, um stärker zu werden."},"explanation":"После um не повторяют подлежащее перед zu + Infinitiv."}
```

Ошибка должна быть реальной и проверяемой; эталон — грамматически верным, варианты — равнозначными. Не раскрывай исправление в `info`.

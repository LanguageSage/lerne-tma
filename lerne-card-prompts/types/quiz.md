# Тип: Quiz

## WHEN TO USE
Классический тест с одним правильным ответом из списка. Варианты идут блоком под вопросом, а не встраиваются в текст.

## FORMAT
Вопрос пишется текстом. Варианты ответа перечисляются с новой строки. Перед правильным ответом ставится `*`.

```text
FRONT:
::task
Beantworten Sie die Frage.

::exercise
Wann begann die Französische Revolution?
1812
*1789
1776
1799

BACK:
Die Revolution begann 1789 mit dem Sturm auf die Bastille.

CONTEXT:

```

## WHEN NOT TO USE
Не используйте, если выбор нужно сделать прямо внутри предложения (для этого есть Trainer Choice).

## VALIDATION
- Ровно один вариант отмечен `*`.
- Звездочка стоит в начале строки.

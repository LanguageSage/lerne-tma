# Тип: Match

## WHEN TO USE
Сопоставление пар (слово-перевод, термин-определение, начало-конец предложения).

## FORMAT
Используется обязательный тег `@match`. Пары разделяются стрелкой `=>`.

```text
FRONT:
::task
Ordnen Sie die Wörter zu.

::exercise
@match
Apfel => apple
Haus => house
Baum => tree

BACK:
(всё сопоставлено верно)

CONTEXT:
Vocabulary A1
```

## WHEN NOT TO USE
Не использовать для сборки одного предложения из частей (это Puzzle).

## VALIDATION
- Присутствует маркер `@match`.
- Строки строго формата `Левая часть => Правая часть`.

# Тип: Puzzle

## WHEN TO USE
Сборка правильного предложения или фразы из перемешанных блоков (слов/частей).

## FORMAT
Используется обязательный тег `@puzzle`. После него пишется ИСХОДНОЕ (правильное) предложение в обычном порядке. Парсер сам перемешает слова для ученика.

```text
FRONT:
::task
Bilden Sie einen korrekten Satz.

::exercise
@puzzle
Ich liebe es, neue Sprachen zu lernen.

BACK:
I love learning new languages.

CONTEXT:
Satzbau B1
```

## WHEN NOT TO USE
Не использовать для сопоставления разных сущностей (это Match).

## VALIDATION
- Присутствует маркер `@puzzle`.
- Предложение написано в правильном порядке.

# Тип: Word Bank

## WHEN TO USE
Заполнение пропусков в тексте из предоставленного банка слов. Слова перетаскиваются в дырки.

## FORMAT
Используется маркер `@wordbank`. Пропуски обозначаются как `<<id>>` (где id - уникальное число/строка для связи с ответом).
Затем идет блок `@options`, где через `|` перечислены все доступные слова (включая лишние).
В `BACK` пишется ключ-ответ в формате `id=ответ`.

```text
FRONT:
::task
Ergänzen Sie die Wörter.

::exercise
@wordbank
Ich fahre <<31>> Berlin.
Ich warte <<32>> den Bus.

@options
NACH | AUF | FÜR | MIT

BACK:
31=NACH
32=AUF

CONTEXT:
Präpositionen B1
```

## WHEN NOT TO USE
Не использовать, если ученик должен впечатать ответ руками без подсказок (это Trainer Input).

## VALIDATION
- `::options` (из Уровня 2) и `@options` (синтаксис Word Bank) не перепутаны! Для банка слов используется именно `@options`.
- Маркер `@wordbank` присутствует.
- Пропуски оформлены строго как `<<id>>`.
- В `BACK` все `id` расшифрованы (`id=Значение`).

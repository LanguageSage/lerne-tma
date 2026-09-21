# Тип: Trainer Choice

## WHEN TO USE
Встраиваемый (inline) выбор из нескольких вариантов прямо внутри предложения (dropdown). Подходит для артиклей, предлогов, окончаний.

## FORMAT
Варианты оборачиваются в фигурные скобки `{}`, разделяются вертикальной чертой `|`. Перед правильным ответом ставится звездочка `*`.
- **Комбинирование**: Trainer Input и Trainer Choice можно и нужно комбинировать, если исходное задание требует обеих механик. Это всё ещё один тип `trainer` (не создавайте `trainer-mixed`).

### Пример одиночного Trainer Choice:
```text
FRONT:
::task
Wählen Sie das passende Wort.

::exercise
Ich lebe {in|*seit|vor} 17 Jahren in Deutschland.

BACK:
seit

CONTEXT:
B1 Sprachbausteine
```

### Пример комбинированного Trainer (Choice + Input):
```text
FRONT:
::task
Wählen Sie das passende Wort und ergänzen Sie die Form.

::exercise
{*Als|Wenn} ich nach Hause kam, [[hatte]] sie schon [[gegessen]].

BACK:
Als ... hatte ... gegessen

CONTEXT:
Temporalsätze B1
```

## WHEN NOT TO USE
- Не используйте для длинных тестовых вопросов с отдельным списком вариантов под вопросом (для этого есть Quiz).
- Не используйте для открытых творческих заданий без однозначного ответа (для этого есть `@free`).

## VALIDATION
- Звездочка `*` стоит строго ПЕРЕД правильным вариантом (внутри скобок).
- Варианты разделены `|` без лишних пробелов вокруг разделителя внутри скобок.
- Если в карточке также есть `[[ ]]`, внутри квадратных скобок нет `|`.

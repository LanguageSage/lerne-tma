# Паттерн: Адаптация теории в интерактив (Theory Adaptation — V2)

## ЦЕЛЬ
Превратить теоретический материал, грамматический справочник, таблицы форм или разбор типичных ошибок в связку карточек Structured Cards V2 (`schema_version: 2`), сочетая вводные карточки `"theory"` с проверочными интерактивными карточками.

## МАТРИЦА ТРАНСФОРМАЦИИ

| Тип теоретического блока | Целевой `card.type` | Как оформляется в V2 |
| :--- | :--- | :--- |
| **Краткая сводка правила / формула перед практикой** | `"theory"` | Правило и примеры в `data.text`, короткая формула-резюме на обороте в `data.summary`. |
| **Разница смыслов** (факт vs гипотеза, нюансы союзов/модальных глаголов) | `"quiz"` | Вопрос о значении фразы в `data.prompt`, варианты трактовки в `data.options`, подробный разбор в `explanation`. |
| **Таблицы спряжений, управления и форм** | `"match"` или `"trainer"` | Пары «местоимение/глагол $\rightarrow$ форма» в `data.pairs` либо выбор/ввод формы в предложении (`data.parts`). |
| **Синтаксис и порядок слов** (глагольная рамка, инверсия, придаточные) | `"trainer"` (`choice`) или `"puzzle"` | Inline-выбор правильного порядка (`{"type": "choice", ...}`) либо сборка предложения по токенам (`"puzzle"`). |
| **Концептуальный вопрос-ответ** | `"standard"` | Вопрос в `data.prompt`, чёткий ответ в `data.answer`, примеры в `explanation`. |

---

## ЭТАЛОННЫЙ ПРИМЕР (фрагмент массива `cards`)

```json
[
  {
    "id": "konjunktiv2-theory",
    "type": "theory",
    "info": [
      {"type": "task", "text": "Lesen Sie die Regel."}
    ],
    "data": {
      "text": "Konjunktiv II der Gegenwart drückt irreale Wünsche, Hypothesen und höfliche Bitten aus.\n\nBildung: würde + Infinitiv oder eigene Formen (hätte, wäre, könnte, müsste).",
      "summary": "Konjunktiv II (Gegenwart): würde + Infinitiv / hätte / wäre."
    },
    "explanation": "Используется для нереальных условий и вежливых просьб в настоящем времени."
  },
  {
    "id": "konjunktiv2-meaning-quiz",
    "type": "quiz",
    "info": [
      {"type": "task", "text": "Bestimmen Sie die Bedeutung des Satzes."}
    ],
    "data": {
      "prompt": "Was drückt der Satz „Ich hätte gern mehr Zeit“ aus?",
      "options": [
        {"text": "Tatsache in der Gegenwart"},
        {"text": "Wunsch / irreale Vorstellung", "correct": true},
        {"text": "Abgeschlossene Handlung in der Vergangenheit"}
      ]
    },
    "explanation": "«Мне хотелось бы иметь больше времени» — форма hätte gern выражает нереальное желание в настоящем."
  },
  {
    "id": "konjunktiv2-word-order",
    "type": "trainer",
    "info": [
      {"type": "task", "text": "Wählen Sie die richtige Wortstellung."}
    ],
    "data": {
      "parts": [
        {"type": "text", "text": "Wenn ich mehr Zeit hätte, "},
        {
          "type": "choice",
          "options": [
            {"text": "ich würde"},
            {"text": "würde ich", "correct": true}
          ]
        },
        {"type": "text", "text": " mehr lesen."}
      ]
    },
    "explanation": "Если бы у меня было больше времени, я бы больше читал. После придаточного с wenn главное предложение начинается со спрягаемого глагола (инверсия)."
  }
]
```

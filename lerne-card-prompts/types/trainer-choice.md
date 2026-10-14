# Trainer Choice

Выбор варианта внутри предложения: артикль, предлог, окончание, форма или фрагмент фразы.

Синтаксис: `{вариант|*правильный|вариант}`. Перечисляй минимум два варианта без лишних пробелов вокруг `|`; отмечай `*` перед каждым допустимым ответом. Несколько правильных вариантов поддерживаются: `{*weil|*da|obwohl}`. Внутри варианта не используй `|`, `;`, `,`, `/`: парсер делит по ним. BACK — перевод фразы целиком.

Ввод и выбор можно сочетать: это единый тип `trainer`, без `trainer-mixed`. Синтаксис ввода — в [trainer-input.md](trainer-input.md).

Одиночный выбор:

```text
FRONT:
::task
Wählen Sie das passende Wort.
::exercise
Ich lebe {in|*seit|vor} 17 Jahren in Deutschland.
BACK:
Я живу в Германии уже 17 лет.
CONTEXT:
Seit обозначает начало продолжающегося действия и требует Dativ.
```

Выбор и ввод:

```text
FRONT:
::task
Wählen Sie das passende Wort und ergänzen Sie die Form.
::exercise
{*Als|Wenn} ich nach Hause kam, [[hatte]] sie schon [[gegessen]].
BACK:
Когда я пришёл домой, она уже поела.
CONTEXT:
Als — однократное событие в прошлом; hatte gegessen — предшествующее действие.
```

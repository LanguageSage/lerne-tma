# Free Text

Открытый ответ: мнение, описание картинки, рассказ, эссе или свободная речь. Если задание проверяет заранее определённое слово, форму или факт, выбирай механику точного ответа по маршрутизатору.
Для исправления предзаполненного текста используй `@edit`.

`@free` — отдельная строка перед текстом задания. BACK обязателен и непустой: образец ответа (Musterlösung) или ориентир для самопроверки, а не строка для точного совпадения. Не заменяй образец пояснением в CONTEXT и не добавляй Trainer-пропуски.

```text
FRONT:
::task
Erzählen Sie über Ihre Familie.
::exercise
@free
Beschreiben Sie Ihre Familie in 5–6 Sätzen.
BACK:
(Musterlösung) Meine Familie ist klein. Ich wohne mit meinen Eltern in Berlin. Meine Mutter arbeitet in einer Schule. Mein Vater ist Arzt. Am Wochenende kochen wir zusammen.
CONTEXT:
Назовите членов семьи, расскажите об их занятиях и совместном досуге.
```

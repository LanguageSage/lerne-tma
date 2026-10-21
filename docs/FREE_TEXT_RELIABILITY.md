# Free Text: проверка надёжности, 21 октября 2026

## Диагноз

Проверена цепочка StudyCardFreeText → useFreeTextEvaluation → answerEvaluationService → /ai/evaluate-answer → answer_evaluation → answer_ai → AIService.

Подтверждённые проблемы в коде до исправления:

- Внешний дедлайн 20s обрывал transport с собственными timeout 30/45s, retries и перебором ключей. Structured retry KI-07.1b не исправлял этот конфликт и не мог завершиться после исчерпания общего бюджета.
- JSON требовался только словами в промпте. Provider JSON mode не включался; полный fenced JSON отвергался. Google брал только первый content part, включая возможную thinking-часть вместо ответа.
- `confidence` имел default 1.0: отсутствие оценки уверенности могло выглядеть как достоверный verdict. Порог 0.85 сохранён, теперь поле обязательно для ИИ.
- Неверная конфигурация сливалась в общий unavailable; Google мог молча подменить неподходящую модель. Ollama evaluator не использовал сохранённый OLLAMA_URL.
- Причины ошибок оставались в серверном логе и терялись в ответе клиенту. Запросы и повторный SYSTEM_PROMPT нельзя было посмотреть.
- Диктовка завершалась через 1500ms после любого result; stop немедленно удалял обработчики и мог потерять последний result. Browser onend прекращал запись без восстановления.

Это установленные дефекты реализации. Production-инцидент не воспроизводился с живым платным провайдером: его точный текущий отказ определяется новым evaluator.<reason> и диагностикой на реальном запросе. Нельзя приписывать любой unavailable только таймауту: low_confidence, policy_violation, отсутствие модели/ключа и provider errors остаются отдельными исходами.

## Итоговый контракт

Evaluation: до двух transport-вызовов по 25s, общий бюджет 55s, клиент 65s. Повтор только для transient transport или JSON/schema; вложенные retries отключены. JSON mode включён отдельно для evaluator и не меняет defaults генерации. Модельные ошибки не превращаются в неправильный ответ ученика.

Администратор включает «Диагностика Free Text» перед проверкой. Ответ того же запроса содержит реальные prompts/user JSON каждой попытки, точные provider payloads, provider/model и финальный результат. Provider URLs, headers, API keys, raw errors и reasoning не возвращаются. При локальном verdict `ai_called=false`, запрос отсутствует. При ошибке конфигурации UI сообщает, что ИИ не вызывался, без ложного утверждения об успешной локальной проверке. Сервер проверяет admin до чтения карточки, затем сохраняет прежнюю проверку доступа к колоде. Диагностика не входит в savedState, Attempt, Dexie или sync.

Free Text отключает silence timer, поддерживает паузу/продолжение и ручную отправку. Отправка ждёт финальные results/onend, максимум 2s; если движок их не прислал, используется видимый текст. Текст можно исправлять вручную; редактирование отменяет pending flush. Browser end/no-speech восстанавливаются с сохранением текста, снимками results и устранением перекрытия от двух слов; не более 5 пустых завершений подряд/30 восстановлений. Разрешение микрофона и network errors требуют ручного действия. Остальные speech exercises сохраняют прежние defaults.

## Выполненные проверки

- Полный `npm --prefix app test`: 437 тестов PASS; после добавления отдельной проверки diagnostic deduplication актуальный `answerEvaluationService.test.js`: 3 PASS.
- Полный `npm --prefix app run lint`: PASS. Production build: PASS (предупреждения о размере chunks и существующих dynamic imports).
- Полный изолированный `python scripts/test_backend.py`: все 20 suites PASS. Актуальный `test_answer_evaluation.py`: 39 PASS; дополнительно изолированный Single Quiz regression: 15 PASS. Python compilation изменённых модулей: PASS.
- Chromium: Free Text evaluation/dictation и speech-followup — 32 PASS.
- Установленный Chrome ПК и Chrome с эмуляцией Pixel 5 — 30 PASS.
- WebKit 26.6 с эмуляцией iPhone 13 — 15 PASS.
- В browser suites API/recognition подменены, внешняя сеть запрещена. Проверены обычный и webkit-prefixed constructors, 60s silence, pause/resume, final result after stop, missing onend, duplicate/stale events, restart limits, denied permission, API error/retry, assessment, admin visibility и отсутствие диагностики в прогрессе. Layout assertions и screenshots: RU/EN/UK, 320/375/430/768/1280px; визуально просмотрены desktop listening и мобильный WebKit 320px.
- V2 free-text projection → серверный контекст проверен через штатный to_legacy_document; read permissions/collaborative access и существующие Knowledge/SRS/sync suites проходят. Supabase schema/RLS/auth configuration не менялись.

Воспроизводимая отдельная матрица (требуются установленный Chrome и `npx playwright install webkit`):

```powershell
npx --no-install playwright test --config=scripts/tests/browser/free-text-compat.config.cjs
```

## Ручная проверка

1. После выкладки в admin-аккаунте включить диагностику и проверить нестандартный ответ с настроенным живым провайдером. Сверить provider/model, user JSON, SYSTEM_PROMPT, финальный result; при unavailable использовать безопасный reason.
2. На физических Chrome ПК/Android и Safari iOS произнести длинный ответ с паузами 10–30s; нажать паузу, исправить текст, продолжить и отправить. Проверить финальные слова, разрешения/отзыв разрешения, сворачивание приложения и восстановление speech service.
3. Отдельно проверить Telegram WebView: доступность Web Speech зависит от устройства/контейнера. Если API недоступен, остаётся ручной ввод. Физический микрофон и системный speech service в автоматических тестах не проверялись.

`continuous` не гарантирует бессрочный сеанс; browser end обрабатывается отдельно. `stop()` пытается вернуть последний результат. См. [MDN continuous](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/continuous), [MDN end](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/end_event), [MDN stop](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/stop).

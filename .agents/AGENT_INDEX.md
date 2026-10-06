# Lerne: индекс для агента

Выберите строку по симптому или термину и откройте один документ подсистемы.
Его Primary entry points и Search anchors задают область первого поиска.
Общие границы приложения — в [ARCHITECTURE.md](ARCHITECTURE.md).

| Симптом / термин | Подсистема | Документ |
| --- | --- | --- |
| Редактор карточки, Simple/Raw, курсор, вставка команды, `::source`, `::task`, `::exercise` | Cards: editor / syntax | [cards](subsystems/cards.md) |
| Разбор `@wordbank`, `@puzzle`, `@match`, `@quiz`, `@free`, `[[input]]` | Cards: parsers | [cards](subsystems/cards.md) |
| Сохранение карточки, batch move/delete/copy, bulk-save, `import_id`, дубликаты | Cards: CRUD / batch | [cards](subsystems/cards.md) |
| Пропала карточка в списке, поиск, возврат и прокрутка CardList | Cards: list / navigation | [cards](subsystems/cards.md) |
| Колода, папка, порядок, видимость, язык обучения, кнопка «Учить» | Decks / folders | [decks](subsystems/decks.md) |
| Sharing, библиотека, импорт JSON, корзина, soft delete | Decks: imports / lifecycle | [decks](subsystems/decks.md) |
| Co-op, collaborator, совместный доступ | Decks: permissions | [decks](subsystems/decks.md) |
| SRS, SM-2, интервалы, оценка, queue, next_review | Study / SRS | [study](subsystems/study.md) |
| StudyFinished, StudyError, forced review, «Учить ещё», следующая колода | Study: navigation | [study](subsystems/study.md) |
| Неверный feedback, retry, completion, part ID, ошибка в проверке упражнения | Study: evaluation | [study](subsystems/study.md) |
| Autoplay, auto-show, плеер/оценки сворачиваются, Next/Back тормозит | Study: controls | [study](subsystems/study.md) |
| LiD, экзамен, ticket, отдельная quiz policy | Study: LiD | [study](subsystems/study.md) |
| IndexedDB, Dexie, offline, dirty, отрицательный ID, потеря локальной правки | Sync: entities | [sync](subsystems/sync.md) |
| v2 push/pull, request_id, mappings, review_count, повторный пакет | Sync: transport | [sync](subsystems/sync.md) |
| Изменения между устройствами, user settings, collab-pull | Sync: adjacent flows | [sync](subsystems/sync.md) |
| AI generation/enrichment, промпт, провайдер, неверный JSON, таймаут | AI: generation | [ai](subsystems/ai.md) |
| evaluate-answer, free text, grading_policy, accepted_answers, typo | AI: answer evaluation | [ai](subsystems/ai.md) |
| Telegram / Google / email-password, вход, challenge, привязка | Auth: identity | [auth](subsystems/auth.md) |
| 401, refresh, Bearer, logout, смена аккаунта, пароль | Auth: sessions | [auth](subsystems/auth.md) |
| TTS, edge-tts, голос, audio_path, аудио отсутствует/не играет | Media: audio | [media](subsystems/media.md) |
| Изображение, image_path, media URL, CDN, blob cache, upload | Media: storage / rendering | [media](subsystems/media.md) |
| Knowledge Item / KI, primary mapping, Attempt, evaluation_data | Knowledge: capture | [knowledge](subsystems/knowledge.md) |
| knowledge_attempt_outbox, Knowledge Sync, mastery-v1, rebuild, diagnostics | Knowledge: persistence | [knowledge](subsystems/knowledge.md) |
| Админ-панель, bulk creator, regen worker, checkpoint, backup explorer | Admin | [ADMIN_ARCHITECTURE](ADMIN_ARCHITECTURE.md) |

Если карточка разобрана правильно, но ответ проверяется неверно, переходите из Cards в Study.
Если verdict free-text неверен, идите в AI; если verdict верен, но mastery не меняется — в Knowledge.
Если правка существует локально, но не попала на сервер, идите в Sync.

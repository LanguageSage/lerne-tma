# Media: TTS, изображения и кэш

## Scope

Получение/загрузка изображений и аудио, генерация TTS, playback, URL resolution и offline media cache.
Порядок autoplay принадлежит [study](study.md); административная галерея — [Admin](../ADMIN_ARCHITECTURE.md).

## Primary entry points

| Задача | Файлы от корня репозитория |
| --- | --- |
| Playback и учебный плеер | `app/src/hooks/useAudio.js`, `app/src/components/study/CardAudioPlayer.jsx`, `app/src/components/study/StudyCard.jsx` |
| Изображения / upload | `app/src/components/study/StudyCardImage.jsx`, `app/src/hooks/useMediaUpload.js`, `app/src/components/common/MediaPicker.jsx` |
| URL normalization | `app/src/utils/media.js`, `app/src/services/apiConfig.js` |
| TTS из клиента | `app/src/utils/audioSynth.js`, `app/src/hooks/useAiActions.js`, `app/src/hooks/useAutoplay.js` |
| Кэш | `app/src/services/mediaCache.js`, `app/src/services/localDb.js` |
| Сервер | `api/routers/media.py`, `api/services/media.py`, `api/utils/audio.py`, `api/models.py` |

## Data flow

1. Карточка содержит media paths/URLs; UI нормализует их через media helpers и отображает player/StudyCardImage.
2. Playback аудио поддерживает прямой публичный Supabase Storage URL через `getAudioUrl`; images/media также обслуживает API.
3. TTS запрос → `/media/generate-audio` → media service / edge-tts helpers → сохранение и возврат path/URL.
4. Клиент связывает результат с карточкой через cards flow; study serialization возвращает существующее audio, не генерируя его при каждом Next.
5. Offline mediaCache возвращает cached blob URL или network URL и при возможности заполняет Dexie `media`.
6. Изображения имеют собственные retry/loading/fallback в StudyCardImage.

## Source of truth

- В LOCAL uploads хранят файлы во внешнем `data/media`, а `TMAMedia` — metadata; чтение идёт только через media routes, missing → 404 без Supabase redirect. Генерация TTS отключена. См. [local-development](local-development.md).

- `scripts/migrate_images_to_storage.py` и audio/cyrillic entry points используют конечный проход по ID, лимиты записей/байтов/попыток/времени и JSON-отчёт. По умолчанию бинарник в БД сохраняется; `--clear-db-content` разрешает compare-and-clear только после проверки публичного GET и SHA-256. Перед этим все серверы чтения должны поддерживать `api/utils/storage_keys.py`. Legacy filename и ссылки в карточках/V2 не переписываются; не-ASCII имена разрешаются в стабильный ASCII-ключ Storage. Скрипты не выполняют schema initialization (`LERNE_SKIP_SCHEMA_INIT=1`). Подробности — `tools/admin/EGRESS_REPORT.md`.

- `TMAMedia` в `api/models.py` хранит серверные media records; аудио также использует публичный бакет Supabase Storage.
- Разрешение пути: `getAudioUrl`/`cleanMedia` в utils/media, `mediaURL` в apiConfig; blob/data/external URLs требуют отдельного обращения.
- Локальный media cache — производная копия, отдельная от текста карточки и entity sync.
- Генерация и проверка пригодности audio cache находятся в `api/services/media.py` / `api/utils/audio.py`.
- Поля image URL/path могут отличаться у online/offline/raw карточек; renderer должен учитывать существующий fallback cascade.
- StudyCardImage владеет состояниями загрузки/retry; настройки голоса и скорости — `app/src/store/useSettingsStore.js`.

## Common symptoms

| Симптом | Первый участок проверки |
| --- | --- |
| Аудио существует, но не воспроизводится | getAudioUrl → useAudio → URL/CDN response; затем media record |
| TTS пустой, старый или force regeneration не работает | audioSynth/useAiActions → generate-audio → серверный cache/force logic |
| Картинка работает online, но отсутствует offline | Нормализация path и mediaCache в БД текущего аккаунта |
| Изображение сломано после Next/Back | Поля raw/cached карточки и StudyCardImage fallback |
| После reconnect media endpoint падает | media router и DB connection resilience |
| Autoplay не создаёт недостающую озвучку | useAutoplay/StudyCard и вызов audioSynth; см. [study](study.md) |

## Search anchors

```sh
rg -n 'getAudioUrl|cleanMedia|mediaURL' app/src/utils/media.js app/src/services/apiConfig.js
rg -n 'localMediaURL|cacheMedia|objectUrls' app/src/services/mediaCache.js
rg -n 'generate_audio|ensure_card_audio|force|TMAMedia' api/services/media.py api/routers/media.py api/utils/audio.py
```

## Relevant tests

- `scripts/tests/test_material_permissions.py`: привязка audio требует
  `can_edit_audio` до генерации и после ожидания TTS; авторство/владелец строки
  не обходят права. Явный viewer audio grant сохранён; TTS подменён fixture.

- Audio force/cache: `scripts/tests/test_audio_force_regeneration.py`.
- Offline media scenarios: `scripts/tests/browser/offline.spec.cjs`.
- Playback/autoplay: `scripts/tests/browser/autoplay-ui.spec.cjs`, `scripts/tests/autoplay_sequence.mjs`.
Проверяйте mocks/fixtures: аудио-проверки могут обращаться к TTS и storage.

## Related docs

- [Как сейчас работает генерация аудио](<../../project_docs/Как сейчас работает генерация аудио.md>).
- [Перенос в публичный бакет audio](<../../project_docs/аудио/Перенос аудиофайлов в публичный бакет audio.md>).
- [Architectural integrity](../rules/architectural_integrity.md) — image fallback и устойчивость media endpoints.
- [Study](study.md), [Cards](cards.md), [Sync](sync.md), [Admin architecture](../ADMIN_ARCHITECTURE.md).

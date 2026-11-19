# Отчёт по пилоту автономного Android APK Lerne (`experiment/android-offline-pilot`)

**Дата:** 2026-11-19  
**Финальный статус:** **ЧАСТИЧНО** *(вся кодовая база, модульные и регрессионные тесты, офлайн E2E в Chromium, Capacitor Android sync и стандартный регрессионный прогон веб-клиента проверены локально; сборка `.apk` через GitHub Actions Gradle и физические испытания на Android-устройствах ожидают разрешения владельца на `push` и ручной проверки на телефоне).*

---

## 1. Изоляция, ветки и аудит базового состояния

- **Новый изолированный worktree:** `C:\121\Lerne_projekt\tma-android-offline-pilot`
- **Новая локальная ветка:** `experiment/android-offline-pilot`
- **Неизменяемый базовый commit SHA:** `fafb36ff1da7820ce95519ffd81ffec16b4401e6` (`fix(sync): avoid retransferring card content on progress changes`)
- **Локальные коммиты в ветке пилота:**
  - Commit 1 (реализация, тесты, Android-конфигурация, workflow): `6448b0b682cdf28db730c73c5e49d6e7e5cf7c6f` (`feat(pilot): add isolated standalone offline Android pilot and progress backup`)
  - Commit 2 (данный отчёт и инструкция по испытаниям на Android): фиксируется следующим локальным коммитом после создания файла отчёта

### Аудит смежных worktree (не затрагивались)

| Worktree | Ветка | Состояние при аудите и после работы |
|---|---|---|
| `C:\121\Lerne_projekt\tma` | `main` (`fafb36f`) | Чистый, без незакоммиченных изменений (`ahead 2` относительно `origin/main` `3073743`) |
| `C:\121\Lerne_projekt\tma\local\test-data\native-v2-editor-final` | `codex/native-v2-editor-final` (`f765c15`) | Чистый, без изменений |
| `C:\121\Lerne_projekt\tma\local\test-data\save` | `codex/native-v2-save-fixes` (`deb2c72`) | 15 локальных незакоммиченных файлов сохранены полностью нетронутыми |

Операции `git push`, PR, `merge`, `rebase`, `deploy`, изменения production PostgreSQL/Supabase и установка JDK/Android SDK/Android Studio **не выполнялись**.

---

## 2. Архитектурные ограничения и список изменённых файлов

Ключевые инварианты, проверенные и соблюдённые на каждом этапе:
1. Автономное поведение включается **строго** при явной build-time переменной `VITE_LERNE_STANDALONE=1`. Использование `VITE_LERNE_LOCAL` вместе с `VITE_LERNE_STANDALONE` запрещено ошибкой сборки и runtime-проверкой.
2. Схема Dexie (`LerneLocalDB` версии 1–5) не изменялась; автономная сборка использует отдельный префикс БД `LerneStandaloneDB_900001`, а в Android — отдельный `applicationId = com.lerne.offlinepilot` и имя `"Lerne Offline Pilot"`, чтобы не затронуть установленную боевую версию Lerne (`com.lerne.app`).
3. Поддельные Bearer-токены и псевдосессии Supabase не создаются (`getAccessToken()` всегда `null`).
4. Каталог `api/` (серверные маршруты и контракты) и существующие тестовые регрессионные сценарии `scripts/tests/*_regression.mjs` не изменялись.

### 2.1. Изолированные новые файлы пилота (14 файлов)

| Файл | Назначение |
|---|---|
| `app/src/utils/standaloneMode.js` | Нулевой leaf-модуль (`IS_STANDALONE`, константы `STANDALONE_USER_ID=900001`, `STANDALONE_APPLICATION_ID`, `STANDALONE_DB_PREFIX`, локальный профиль без сетевых токенов) |
| `app/src/pilot/sha256.js` | Детерминированный чистый JS SHA-256 hex digest (UTF-8) для отпечатка колод и целостности бэкапа |
| `app/src/pilot/decks/de_a2_alltag.json` | Встроенная колода №1 (`9101`, 12 карточек Native V2, `de`, A2) |
| `app/src/pilot/decks/de_b1_vergangenheit.json` | Встроенная колода №2 (`9102`, 10 карточек Native V2, `de`, B1) |
| `app/src/pilot/decks/de_b1_nebensaetze.json` | Встроенная колода №3 (`9103`, 8 карточек Native V2, `de`, B1) |
| `app/src/pilot/standalonePack.js` | Сборка и отпечаток пакета `lerne-offline-pilot-de-v1` (v1) с фиксированными ID колод и карточек |
| `app/src/pilot/standaloneSeed.js` | Однократный идемпотентный и upgrade-safe seed в транзакции Dexie `rw` (`decks`, `cards`, `syncState`, без записи в `progress`) |
| `app/src/pilot/standaloneBootstrap.js` | Автономная инициализация приложения без запуска фонового `syncService` и auth-окон |
| `app/src/pilot/progressBackup.js` | Экспорт/валидация/превью/атомарное восстановление прогресса (формат `lerne-offline-progress-backup` v1, SHA-256, проверка `card_id` + `card_key`) |
| `app/src/pilot/progressBackupTransport.js` | Транспорт сохранения/открытия JSON: Android SAF (`OfflineBackupFile`) в Capacitor + fallback на Blob/`<input type="file">` в браузере |
| `app/src/pilot/StandaloneBackupSection.jsx` | UI в разделе «Профиль» для экспорта, импорта, предупреждения о перезаписи и подтверждения |
| `android/app/src/main/java/com/lerne/app/OfflineBackupFilePlugin.java` | Capacitor 8 плагин над Android `ACTION_CREATE_DOCUMENT` / `ACTION_OPEN_DOCUMENT` (с fallback режима записи `"wt"` → `"w"` для Google Drive DocumentProvider и лимитом чтения 5 МБ) |
| `app/src/services/__tests__/standaloneOfflinePilot.test.js` | Модульные тесты: проверка флага по умолчанию, схемы V2, идемпотентности seed, апгрейда v1→v2, целостности SHA-256, отклонения неверных форматов и восстановления |
| `scripts/tests/browser/standalone-offline-pilot.check.cjs` | Сквозной Playwright офлайн-тест автономной сборки (0 сетевых запросов, 22 оценки SRS, перезапуск, экспорт/порча/сброс/отмена/восстановление, скриншоты 375px и 320px) |

### 2.2. Минимальные изменения общих модулей (24 файла, +210 / -40 строк)

> **Примечание о VM-совместимости:** существующие тесты `scripts/tests/api_session_regression.mjs`, `auth_session_regression.mjs`, `auth_store_regression.mjs` и `library_store_regression.mjs` выполняют исходники `networkApi.js`, `api.js`, `auth.js`, `useAuthStore.js` и `useAppInitialization.js` через `vm.runInNewContext` после удаления строк `import ...;`. Поэтому в этих пяти модулях используется безопасная проверка `(typeof IS_STANDALONE !== 'undefined' && IS_STANDALONE)`, сохраняющая тестовую обвязку без правок.

| Файл | Изменение и причина | Риск конфликта с основным рефакторингом |
|---|---|---|
| `app/src/services/api.js` | В ветке `IS_STANDALONE` перенаправляет offline-читаемые/SRS эндпоинты в `offlineApi` (`dataSource: 'local'`), остальные отклоняет `ERR_STANDALONE_OFFLINE` без сети | Низкий (10 строк в одном перехватчике) |
| `app/src/services/networkApi.js` | Ранний `ERR_STANDALONE_OFFLINE` в request-перехватчике до обращения к `axios` | Низкий (5 строк) |
| `app/src/hooks/useAppInitialization.js` | При `IS_STANDALONE` делегирует в `runStandaloneBootstrap()`, не поднимая `syncService`, WebSocket/polling и auth-подписки | Низкий (5 строк в начале `useEffect`) |
| `app/src/store/useAuthStore.js` | Ветка `IS_STANDALONE` в `restoreSession`, `setAuthModalOpen`, `prepareTelegramChallenge`, `refreshAuthMethods`, `startProvider`, `checkPendingSession`, `initListeners` и подписке на хранилище | Средний (локальные ранние возвраты по флагу; логика веб-входа не менялась) |
| `app/src/services/localDb.js` | Префикс `LerneStandaloneDB` для `Dexie`, отключение `migrateLegacy` в `IS_STANDALONE`, `isOfflineMode() === true` | Низкий (8 строк, схема таблиц v1–v5 не тронута) |
| `app/src/services/syncService.js` | Ранний возврат в `syncService.sync()` при `IS_STANDALONE` | Низкий (2 строки) |
| `app/src/utils/auth.js` | Возврат `STANDALONE_USER_ID`, `STANDALONE_SESSION_IDENTITY`, `getStandaloneProfile()`, отключение `requireAuthSession` и `Telegram.CloudStorage` в `IS_STANDALONE` | Низкий |
| `app/src/services/cardNotes.js` | Отключение сетевого `syncCardNotes`/`refreshCardNotes` при сохранении локальной записи в Dexie | Низкий (4 строки) |
| `app/src/services/knowledgeContentService.js`, `app/src/hooks/useKnowledgeSync.js` | Отключение фонового knowledge sync в `IS_STANDALONE` | Низкий (по 2–3 строки) |
| `app/src/services/mediaCache.js` | Отключение сетевой подгрузки внешних медиа при `IS_STANDALONE` | Низкий (2 строки) |
| `app/src/store/useLanguageStore.js`, `app/src/store/useSettingsStore.js`, `app/src/i18n/i18nContext.jsx` | Отключение автопопапа выбора языка на холодном старте и фоновых `api.post('/user/...')` при смене языка/настроек | Низкий |
| `app/src/components/deckgrid/DeckGrid.jsx`, `DeckGridHeader.jsx` | Скрытие баннера «Библиотека ещё не подтверждена сервером», кнопки «Мои сообщения» и «Game Mode · Stadtbibliothek» в автономной сборке | Низкий |
| `app/src/components/study/StudyCard.jsx` | Скрытие серверных компонентов `CardQuestionComposer` (AI-чат) и `CardRating` (оценка качества карточки) в автономной карточке | Низкий |
| `app/src/components/settings/ProfileTab.jsx`, `app/src/components/modals/SettingsModal.jsx` | Отображение `StandaloneBackupSection` вместо облачной авторизации и скрытие вкладок `reminders` и `prompts` | Низкий |
| `app/vite.config.js` | Поддержка `VITE_LERNE_STANDALONE=1` (взаимоисключение с `LOCAL`), отключение `envDir`, вырезание `https://telegram.org/js/telegram-web-app.js` и Google Fonts только в standalone | Низкий |
| `android/app/build.gradle`, `AndroidManifest.xml`, `MainActivity.java` | Опциональный флаг Gradle `-PlerneOfflinePilot=true` (`applicationId com.lerne.offlinepilot`, placeholder `${appName}`, `versionCode`/`versionName`) + регистрация `OfflineBackupFilePlugin` | Низкий (при стандартной сборке значения не меняются) |
| `.github/workflows/android.yml` | Выборы `workflow_dispatch`: `offline-pilot` (по умолчанию) / `standard` + сборка пары `v1` и `v2` APK в одном запуске с общим debug keystore | Низкий |

---

## 3. Сборка Android Debug APK и важный нюанс по CI (`checks.yml`)

- **Почему `.apk` не скомпилирован на локальной машине:** по требованию владельца и согласно аудиту окружения JDK, Android SDK и Android Studio на этом ПК не устанавливались и отсутствуют; сборка `.apk` настроена через `.github/workflows/android.yml` (`runs-on: ubuntu-latest`, Java 21, Node 22).
- **Идентификаторы и версии пилотного APK:**
  - `applicationId`: `com.lerne.offlinepilot` (не пересекается с `com.lerne.app`)
  - Имя приложения в лаунчере Android: `Lerne Offline Pilot`
  - При `build_mode=offline-pilot` и `build_upgrade_test_pair=true` workflow собирает два APK в одной CI-сессии (с одним временным `~/.android/debug.keystore`, без хранения ключей в репозитории):
    - `lerne-offline-pilot-v1-debug.apk` (`versionCode = 1`, `versionName = 1.0.0-offline-pilot`)
    - `lerne-offline-pilot-v2-debug.apk` (`versionCode = 2`, `versionName = 1.0.1-offline-pilot`)
- **Команда для отправки ветки (ТОЛЬКО после отдельного разрешения владельца):**
  ```powershell
  git -C C:\121\Lerne_projekt\tma-android-offline-pilot push -u origin experiment/android-offline-pilot
  ```

> [!IMPORTANT]
> **Обнаруженный предсуществующий CI-блокер на базовом `main` (`api/admin_contract.json`):**  
> В `.github/workflows/android.yml` сохранена обязательная зависимость `needs: checks` (вызов `.github/workflows/checks.yml` → `npm run check`), мы намеренно не ослабляли CI и не меняли `api/admin_contract.json` в ветке пилота.  
> Однако на самом базовом коммите `fafb36f` (из-за родительского коммита `deb2c72`, изменившего `api/services/decks.py` без обновления `api/admin_contract.json`) проверка `python scripts/verify_admin_contract.py` уже падает и на чистом `main`, и в нашем worktree с ошибкой `RuntimeError: import contract changed: review compatibility/version and explicitly update artifact` (затрагивает `test_admin_contract.py` и `test_card_core_package.py`).  
> Перед запуском `Build Android APK` в GitHub Actions потребуется сначала на `main` (либо после отдельного ревью `deb2c72`) выполнить `python scripts/verify_admin_contract.py --update` и подтянуть этот коммит в ветку сборки.

---

## 4. Встроенные колоды Native JSON V2

- **Пакет:** `lerne-offline-pilot-de-v1` (версия `1`)
- **Контрольный отпечаток набора карточек (SHA-256):** `abec4efc9ae6e4be49ed86df91b6af15560f014c4958d82ee1f1a00c2a4a51dd`
- **Внешние медиаресурсы:** отсутствуют (`0` изображений/аудио/видео, `resources: []` — исключены сетевые ошибки в авиарежиме).
- **Состав пакета (3 колоды, 30 карточек):**

| ID колоды | Slug | Название | Карточки (ID) | Количество | Типы Native V2 |
|---|---|---|---|---|---|
| `9101` | `de-a2-alltag` | `Alltag & Kommunikation (A2)` | `910101`–`910112` | 12 | `theory`, `standard`, `trainer`, `quiz`, `match`, `puzzle`, `word_bank` |
| `9102` | `de-b1-vergangenheit` | `Perfekt & Plusquamperfekt (B1)` | `910201`–`910210` | 10 | `theory`, `standard`, `trainer`, `quiz`, `match`, `puzzle`, `word_bank` |
| `9103` | `de-b1-nebensaetze` | `Nebensätze & Konjunktionen (B1)` | `910301`–`910308` | 8 | `theory`, `standard`, `trainer`, `quiz`, `match`, `puzzle`, `word_bank` |

- **Честный охват механик:** проверены все **7 из 9** клиентских типов Native V2 (`theory`, `standard`, `trainer` [input/choice/mixed], `quiz` [single/multi], `match`, `puzzle`, `word_bank`). Типы `free_text` и `editable_text` **сознательно исключены** и не заявляются в пилоте, так как их оценивание зависит от серверного эндпоинта `POST /api/ai/evaluate-answer`.
- **Гарантии seed и апгрейда:** `ensureStandaloneSeed()` выполняется в одной транзакции Dexie (`decks`, `cards`, `syncState`), ставит маркеры готовности кеша `deck-cards:<id>` (`complete: true`), при повторном открытии пропускает запись (`skipped: true`, карточки не дублируются), а при повышении `packVersion` обновляет тексты карточек **без записи в `database.progress` и без сброса `is_learning`**.

---

## 5. Результаты автоматических проверок

Все проверки ниже выполнены непосредственно на финальном состоянии кода в `C:\121\Lerne_projekt\tma-android-offline-pilot`:

| Проверка | Команда | Наблюдаемый результат |
|---|---|---|
| Схема Native JSON V2 встроенных колод | `python -c "import json, pathlib, sys; sys.path.insert(0, 'api/card_core'); from lerne_card_core.structured_cards_v2 import Document; ..."` | **PASS**: `VALIDATED BUNDLED NATIVE V2 DECKS: [('de_a2_alltag.json', 12), ('de_b1_nebensaetze.json', 8), ('de_b1_vergangenheit.json', 10)]` |
| Синтетические фикстуры уроков | `python tests/fixtures/generate_lessons.py --check` | **PASS** (код `0`) |
| Модульные тесты (включая `standaloneOfflinePilot.test.js` и `networkDependencies.test.js`) и VM-регрессии фронтенда (`VITE_LERNE_STANDALONE` не задан) | `npm run test:frontend` | **PASS**: `app test` **368/368** (`0` fail, `0` skipped); регрессии JS-сторов/API (`*regression.mjs`, `autoplay_sequence.mjs`, `test_user_settings_sync.mjs`, `test_card_scroll_restoration.mjs`) **118/118** (`0` fail) |
| ESLint всего фронтенда | `npm --prefix app run lint` | **PASS** (код `0`, 0 ошибок) |
| Автономная сборка Vite (`VITE_LERNE_STANDALONE=1`) и проверка очистки HTML | `$env:VITE_LERNE_STANDALONE='1'; npm --prefix app run build` | **PASS**: `dist/index.html 1.13 kB`; `STANDALONE HTML has telegram.org: False`, `fonts.googleapis: False` |
| Синхронизация Capacitor Android | `npx cap sync android` | **PASS** (`Sync finished in 0.169s`) |
| Сквозной офлайн-прогон Playwright (автономная сборка, 375px + 320px) | `node scripts/tests/browser/standalone-offline-pilot.check.cjs` | **PASS**: `{ decks: 3, cards: 30, restoredProgress: 22, forbiddenRequests: 0, pageErrors: 0, consoleErrors: 0 }`; проверены: холодный старт без сервера и модальных окон входа/языка; изучение 22 карточек (все 7 типов); сохранение SRS после `reload()` без дублирования seed; экспорт JSON; отклонение изменённого JSON (`INTEGRITY_MISMATCH`) и файла колоды (`WRONG_ARCHIVE_FORMAT`); симуляция чистой установки (очистка IndexedDB/localStorage → 0 записей SRS); отмена восстановления (остаётся 0); подтверждение восстановления + перезапуск (точные 22 записи SRS); скриншоты без горизонтального переполнения в `local/test-data/standalone-pilot-evidence/` |
| Стандартная веб-сборка (`VITE_LERNE_STANDALONE` не задан) | `npm --prefix app run build` | **PASS**: `dist/index.html 1.20 kB`; `STANDARD HTML has telegram.org: True` |
| Стандартный браузерный регрессионный набор (обычная веб-версия) | `npm run test:browser` | **PASS**: **83/83** при чистом повторном запуске (`5.8m`) *(первый прогон был 82/83 из-за единичного тач-флейка перетаскивания в `native-card-editor.spec.cjs:467:3`, воспроизвести повторно не удалось)* |
| Backend-набор (`api/` не изменялся) | `npm run test:backend` (`python scripts/test_backend.py`) | **46/48 сьютов OK**; 2 ошибки в `test_admin_contract.py` и `test_card_core_package.py` вызваны предсуществующим рассинхроном `api/admin_contract.json` на базовом `main` (`fafb36f`) |

---

## 6. Непроверенные физически пункты

1. Фактическая компиляция `app-debug.apk` через `./gradlew assembleDebug` на раннере GitHub Actions (пока ветка не отправлена на GitHub).
2. Параллельная установка `com.lerne.offlinepilot` рядом с действующей Lerne (`com.lerne.app`) на реальном Android-устройстве.
3. Реальный запуск и длительное обучение на физическом телефоне в авиарежиме в Android WebView.
4. Сохранение IndexedDB / localStorage после принудительной остановки приложения ОС Android (`Force Stop`) и перезагрузки телефона.
5. Живое обновление `lerne-offline-pilot-v1-debug.apk` → `lerne-offline-pilot-v2-debug.apk` поверх установленного приложения без удаления данных и проверка сохранности SRS.
6. Реальный цикл сохранения и открытия файла через системный Android Storage Access Framework (`OfflineBackupFilePlugin`), включая выбор Google Диска через DocumentProvider.
7. Проверка переноса файла резервной копии между **двумя** физическими Android-устройствами.

---

## 7. Риски данных и минимальные изменения, пригодные для переноса после рефакторинга

- **Риски данных при пилоте:**
  - Прогресс хранится локально в WebView IndexedDB; удаление приложения или очистка данных приложения полностью стирает прогресс, если пользователь не сделал экспорт. Обязательно предупреждайте участников пилота делать экспорт перед переустановкой.
  - Debug APK разных запусков CI подписываются разными эфемерными ключами (`~/.android/debug.keystore`), поэтому обновление без удаления возможно только между APK из одной CI-сборки (пара `v1`/`v2`) либо при едином подписанном ключе позже.
  - Файлы `lerne-offline-progress-backup` v1 жёстко привязаны к `pack_id` и парам `(card_id, card_key)`. При смене ID карточек в будущих пакетах потребуется таблица маппинга или перенос на единый формат архива после стабилизации основной архитектуры.
- **Что стоит перенести в основную платформу после завершения её рефакторинга:**
  1. `android/app/src/main/java/com/lerne/app/OfflineBackupFilePlugin.java` + `app/src/pilot/progressBackupTransport.js` (надёжный SAF-мост для Android/Google Drive без Drive API/OAuth).
  2. Подход к проверке формата, SHA-256 и идентичности карточек с обязательным превью перезаписи (`app/src/pilot/progressBackup.js`).
  3. Build-time изоляция через явный флаг + параметризованный `applicationId`/`appName` в `android/app/build.gradle`.

---

## 8. Инструкция по сборке APK, установке и проверке на Android в авиарежиме

### Шаг A. Получение APK через GitHub Actions
1. Устранить на `main` (или в ветке перед сборкой) предсуществующее несоответствие `api/admin_contract.json` от коммита `deb2c72` (`python scripts/verify_admin_contract.py --update`), иначе обязательная джоба `checks` в `android.yml` завершится ошибкой на шаге `test:backend`.
2. Дать разрешение и выполнить отправку экспериментальной ветки:
   ```powershell
   git -C C:\121\Lerne_projekt\tma-android-offline-pilot push -u origin experiment/android-offline-pilot
   ```
3. В GitHub открыть **Actions → Build Android APK → Run workflow**:
   - **Use workflow from:** `experiment/android-offline-pilot`
   - **build_mode:** `offline-pilot`
   - **build_upgrade_test_pair:** `true`
4. После успешного прохождения `checks` и `build-android` скачать артефакт **`Lerne-Offline-Pilot-Debug-APK`** и распаковать из ZIP два файла:
   - `lerne-offline-pilot-v1-debug.apk`
   - `lerne-offline-pilot-v2-debug.apk`

### Шаг B. Установка рядом с основной Lerne и проверка в авиарежиме
1. Убедитесь, что на телефоне остаётся обычная Lerne (`com.lerne.app`), если она установлена. Установите `lerne-offline-pilot-v1-debug.apk`. Приложение должно установиться **отдельно** как **`Lerne Offline Pilot`**.
2. Включите **Авиарежим** (Wi-Fi и мобильная сеть выключены).
3. Откройте `Lerne Offline Pilot`:
   - На экране сразу видны 3 немецкие колоды (`Alltag & Kommunikation (A2)`, `Perfekt & Plusquamperfekt (B1)`, `Nebensätze & Konjunktionen (B1)`), без экрана логина, без баннеров авторизации и без приветственного окна выбора языка.
4. Откройте 1-ю и 2-ю колоды и оцените **не менее 20 карточек** (включая `theory`, `standard`, `trainer`, `quiz`, `match`, `puzzle`, `word_bank`).
5. **Тест kill / relaunch:** смахните приложение из списка недавних (или нажмите «Остановить» в настройках Android), не выключая авиарежим откройте его снова:
   - По-прежнему ровно 3 колоды (дубликатов нет).
   - Счётчики «нові / вивчаю / повторити» и очередь повторений SRS сохранены.

### Шаг C. Проверка безопасного обновления APK (v1 → v2)
1. **Не удаляя** `v1`, установите поверх него `lerne-offline-pilot-v2-debug.apk`. Android должен показать диалог обновления существующего приложения (подпись из одного CI-запуска совпадает).
2. Откройте приложение в авиарежиме: весь накопленный прогресс SRS и статусы колод должны остаться нетронутыми.

### Шаг D. Проверка резервного копирования и восстановления на чистой установке
1. Откройте **Настройки (⚙️) → Профиль**.
2. Нажмите **«Экспортировать прогресс (JSON)»**:
   - Откроется системный проводник Android (SAF). Сначала сохраните файл в локальную папку «Загрузки», затем повторите экспорт, выбрав в боковом меню проводника **Google Диск** (при наличии сети/клиента Drive).
   - Убедитесь, что при нажатии «Назад» / отмене выбора файла дата «Последний экспорт» не перезаписывается ложным значением.
3. Проверьте **восстановление на чистой установке** (и/или на втором Android-устройстве):
   - Удалите `Lerne Offline Pilot` с устройства (или установите v1 на второе устройство), откройте приложение — прогресс равен 0.
   - Перейдите в **Настройки → Профиль → «Восстановить из файла»**, выберите сохранённый `.json` (из «Загрузок» или с Google Диска).
   - Проверьте экран подтверждения (показывает имя файла, дату и число записей) → нажмите **«Подтвердить восстановление»**.
   - Перезапустите приложение и убедитесь, что все изученные карточки, интервалы SRS и статусы «вивчаю» полностью восстановились.
4. Бонус-проверка защиты: попробуйте подсунуть любой другой `.json` или отредактированный блокнотом бэкап — приложение обязано отказать с понятным сообщением об ошибке и не тронуть локальную базу.

# Отчёт по пилоту автономного Android APK Lerne (`experiment/android-offline-pilot`)

**Дата обновления:** 2026-11-20  
**Финальный статус:** **ГОТОВ К СБОРКЕ В GITHUB ACTIONS (ЧАСТИЧНО)** *(вся клиентская и контрактная база, режим чтения учебных материалов, ограничение очереди оценок, проверка метаданных и целостности резервных копий, офлайн E2E в Chromium, Capacitor Android sync и полный CI-прогон `npm run check` — включая 49/49 backend-сьютов — пройдены локально на 100%; компиляция `.apk` раннером GitHub Actions и физические испытания на Android-устройствах ожидают вашего подтверждения `push` и ручной проверки на телефоне).*

---

## 1. Изоляция, ветки и аудит базового состояния

- **Изолированный worktree:** `C:\121\Lerne_projekt\tma-android-offline-pilot`
- **Ветка:** `experiment/android-offline-pilot`
- **Неизменяемый базовый commit SHA (`main`):** `fafb36ff1da7820ce95519ffd81ffec16b4401e6` (`fix(sync): avoid retransferring card content on progress changes`)
- **История коммитов пилотной ветки (в порядке создания):**
  - `6448b0b` — `feat(pilot): add isolated standalone offline Android pilot and progress backup`
  - `0a697ba` — `docs(pilot): add offline Android pilot report and physical test guide`
  - Текущий коммит — исправления по итогам независимого аудита (см. раздел 2.3)

### Аудит смежных worktree (не затрагивались)

| Worktree | Ветка | Состояние |
|---|---|---|
| `C:\121\Lerne_projekt\tma` | `main` (`fafb36f`) | Чистый, без изменений |
| `C:\121\Lerne_projekt\tma\local\test-data\native-v2-editor-final` | `codex/native-v2-editor-final` (`f765c15`) | Чистый, без изменений |
| `C:\121\Lerne_projekt\tma\local\test-data\save` | `codex/native-v2-save-fixes` (`deb2c72`) | 15 рабочих файлов сохранены нетронутыми |

Операции `merge`, `rebase`, `deploy`, изменения production PostgreSQL/Supabase и установка JDK/Android SDK/Android Studio не выполнялись.

---

## 2. Архитектурные ограничения и внесённые изменения

Ключевые инварианты:
1. Автономное поведение включается **строго** при явной build-time переменной `VITE_LERNE_STANDALONE=1`.
2. Схема Dexie (`LerneLocalDB` версии 1–5) не изменялась; автономная сборка использует отдельную БД `LerneStandaloneDB_900001` и отдельный Android `applicationId = com.lerne.offlinepilot` (`"Lerne Offline Pilot"`).
3. Поддельные Bearer-токены и псевдосессии Supabase не создаются (`getAccessToken()` всегда `null`).
4. Существующие VM-тесты `scripts/tests/*_regression.mjs` и `api/services/*` не модифицировались.

### 2.1. Изолированные новые файлы пилота (14 файлов)

- `app/src/utils/standaloneMode.js` — leaf-модуль с константами и локальным профилем без сетевых токенов.
- `app/src/pilot/sha256.js` — чистый JS SHA-256 hex digest (UTF-8).
- `app/src/pilot/decks/de_a2_alltag.json`, `de_b1_vergangenheit.json`, `de_b1_nebensaetze.json` — 3 встроенные колоды Native JSON V2 (30 карточек, 0 внешних медиа).
- `app/src/pilot/standalonePack.js` — сборка пакета `lerne-offline-pilot-de-v1` (v1) и отпечатка набора карточек.
- `app/src/pilot/standaloneSeed.js` — однократный идемпотентный и upgrade-safe seed в транзакции Dexie (`role: 'viewer'`, `is_owner: false`, `is_global_readonly: true`, сохранение пользовательского `is_learning` и `progress`).
- `app/src/pilot/standaloneBootstrap.js` — автономная инициализация без запуска `syncService` и auth-модалок.
- `app/src/pilot/progressBackup.js` — экспорт/проверка/восстановление прогресса (`lerne-offline-progress-backup` v1, SHA-256).
- `app/src/pilot/progressBackupTransport.js` — транспорт Android SAF (`OfflineBackupFile`) + Web Blob fallback.
- `app/src/pilot/StandaloneBackupSection.jsx` — UI в разделе «Профиль» для экспорта, импорта и подтверждения перезаписи.
- `android/app/src/main/java/com/lerne/app/OfflineBackupFilePlugin.java` — Capacitor 8 SAF плагин (`ACTION_CREATE_DOCUMENT` / `ACTION_OPEN_DOCUMENT`, лимит 5 МБ, fallback `"wt"` → `"w"`).
- `app/src/services/__tests__/standaloneOfflinePilot.test.js` — модульные и data-safety регрессии пилота (11 тестов в запуске с `networkDependencies.test.js`).
- `scripts/tests/browser/standalone-offline-pilot.check.cjs` — сквозной Playwright офлайн-тест автономной сборки.

### 2.2. Исправления по итогам независимого архитектурного аудита

1. **Учебные материалы строго «только для чтения» в standalone-режиме:**
   - `app/src/pilot/standaloneSeed.js`: встроенные колоды создаются и мигрируются с `role: 'viewer'`, `is_owner: false`, `is_global_readonly: true` (при сохранении `is_learning`).
   - `app/src/services/cardOfflineQueue.js`: добавлен `isStandaloneDb(db)`; `isContentReadOnly`, `requireContentWrite`, `saveNativeCard`, `queueCardMove`, `queueCardLifecycle`, `queueCardSelection`, `saveNativeEdit`, `resolveCardEdit` блокируют любое изменение контента ошибкой `readOnly()`.
   - `app/src/services/offlineApi.js`: блокирует создание колод/папок (`POST /decks`, `POST /folders`), переупорядочивание (`reorder`), переименование/цвет/перенос/закрепление/метаданные/удаление (`change`, `DELETE`) и восстановление из корзины (`restore`); **разрешены только** личные учебные операции (`POST /study/grade`, `POST /cards/:id/flag`, `POST /decks/:id/toggle-learning`, `POST /decks/:id/reset`).
   - UI-защита: скрыты кнопки создания/редактирования и нижнее меню «Инструменты и служебные разделы» (Дубликаты/Корзина) в `DeckGrid.jsx`, скрыто редактирование интро в `DeckIntro.jsx`, заблокированы `openEditor`/`openCreator` в `useCardNavigation.js`.
2. **Синхронизация `api/admin_contract.json` в экспериментальной ветке:**
   - После проверки изменений `deb2c72` в `api/services/decks.py` выполнен `python scripts/verify_admin_contract.py --update`. Обновлён только `import.source_sha256` (`version: 6` сохранён), CI-проверки не ослаблялись и не отключались.
3. **Ограничение накопления `grade:` и `review:` в автономном режиме:**
   - `app/src/services/offlineApi.js` (`STANDALONE_MAX_GRADE_RECEIPTS = 64`): для standalone БД в `POST /study/grade` не создаются записи `review:*` (а старые удаляются), при сохранении защиты идемпотентности по `grade:${actionId}` и конфликта данных, с вытеснением самых старых квитанций `grade:*` сверх лимита 64.
4. **Проверка целостности метаданных и совместимость формата резервной копии:**
   - `app/src/pilot/progressBackup.js`: добавлен `PROGRESS_BACKUP_INTEGRITY_SCOPE = 'full-v1'` — `computeBackupHash` теперь покрывает `format`, `schema_version`, `exported_at`, `app`, `summary`, `records`, `deck_preferences`.
   - Сохранена обратная совместимость с более ранними v1-файлами без поля `scope` (`computeLegacyCoreBackupHash`), добавлены сверки согласованности `summary` (`total_records`, `reviewed_records`, `deck_count`), `app.mode`/`application_id`, формата `card_set_fingerprint` и совместимости версий `pack_version <= pack.packVersion` (включая точное совпадение `card_set_fingerprint` на той же версии).
5. **Добавлены регрессионные тесты:**
   - В `standaloneOfflinePilot.test.js`: проверки read-only миграции и отклонения всех content-мутаций при сохранении работы SRS/`flag`/`toggle-learning`/`reset`, лимит 64 `grade:*` без `review:*` с проверкой идемпотентности и конфликта, проверки целостности метаданных и обратной совместимости `core-v1` + апгрейд-совместимости `v1 -> v2`.
   - В `standalone-offline-pilot.check.cjs`: проверки скрытия `#tut-add-deck` и `.deck-intro-edit-btn`, отсутствия `review:*` и ровно 22 записей `grade:*` после 22 оценок.

---

## 3. Сборка Android Debug APK (GitHub Actions)

- **Статус сборки APK:** `.apk` не собирался локально (JDK/Android SDK не устанавливались). После вашего подтверждения `push` в `origin/experiment/android-offline-pilot` workflow `.github/workflows/android.yml` полностью готов к запуску (`needs: checks` теперь проходит все 5 стадий, включая `backend`).
- **Конфигурация:**
  - `applicationId`: `com.lerne.offlinepilot` (`"Lerne Offline Pilot"`)
  - Пара тестовых APK из одного запуска CI с общим debug keystore:
    - `lerne-offline-pilot-v1-debug.apk` (`versionCode = 1`, `1.0.0-offline-pilot`)
    - `lerne-offline-pilot-v2-debug.apk` (`versionCode = 2`, `1.0.1-offline-pilot`)
- **Команда для отправки после вашего разрешения:**
  ```powershell
  git -C C:\121\Lerne_projekt\tma-android-offline-pilot push -u origin experiment/android-offline-pilot
  ```

---

## 4. Встроенные колоды Native JSON V2

- **Пакет:** `lerne-offline-pilot-de-v1` (версия `1`), `card_set_fingerprint`: `abec4efc9ae6e4be49ed86df91b6af15560f014c4958d82ee1f1a00c2a4a51dd`.
- **Колоды (3 колоды, 30 карточек, 0 внешних медиа):**
  - `9101` (`de-a2-alltag`): `Alltag & Kommunikation (A2)` — 12 карточек (`910101`–`910112`)
  - `9102` (`de-b1-vergangenheit`): `Perfekt & Plusquamperfekt (B1)` — 10 карточек (`910201`–`910210`)
  - `9103` (`de-b1-nebensaetze`): `Nebensätze & Konjunktionen (B1)` — 8 карточек (`910301`–`910308`)
- **Проверенные типы:** 7 из 9 клиентских типов (`theory`, `standard`, `trainer` [input/choice/mixed], `quiz`, `match`, `puzzle`, `word_bank`). Типы `free_text` и `editable_text` исключены, так как требуют серверного `/api/ai/evaluate-answer`.

---

## 5. Результаты автоматических проверок (на финальном коде)

| Проверка | Команда | Наблюдаемый результат |
|---|---|---|
| Контракт и пакетные тесты backend (`admin_contract`, `card_core`) | `python scripts/verify_admin_contract.py`, `test_admin_contract.py` (5), `test_card_core_package.py` (3) | **PASS** |
| Целевые модульные тесты пилота и граф зависимостей | `node --import ./scripts/tests/no-network.mjs --experimental-test-module-mocks --test app/src/services/__tests__/standaloneOfflinePilot.test.js app/src/services/__tests__/networkDependencies.test.js` | **PASS**: **11/11** (`2` граф зависимостей + `9` тестов пилота) |
| Автономная сборка + проверка HTML + `cap sync` | `$env:VITE_LERNE_STANDALONE='1'; npm --prefix app run build` + `npx cap sync android` | **PASS** (`telegram.org` и Google Fonts вырезаны; Capacitor sync 0.219s) |
| Сквозной офлайн-прогон Playwright (автономная сборка) | `node scripts/tests/browser/standalone-offline-pilot.check.cjs` | **PASS**: `{ decks: 3, cards: 30, restoredProgress: 22, forbiddenRequests: 0, pageErrors: 0, consoleErrors: 0 }`; проверены скрытие `#tut-add-deck`/`.deck-intro-edit-btn`, 0 записей `review:`, 22 записи `grade:`, сохранение SRS после `reload()`, экспорт/отказ на подделке и колоде/отмена/восстановление, 375px & 320px |
| Полный регрессионный прогон CI (`VITE_LERNE_STANDALONE` не задан) | `npm run check` (`python scripts/check.py`) | **PASS: `All checks passed.`** (`frontend`: **372/372** app tests + **118/118** VM-регрессий; `backend`: **49/49** изолированных сьютов; `browser`: **83/83** Playwright critical за 5.5m; `lint`: **0** ошибок; `build`: стандартный веб-билд с `telegram-web-app.js`) |
| Фикстуры уроков | `python tests/fixtures/generate_lessons.py --check` | **PASS** |

---

## 6. Что осталось непроверенным физически

1. Запуск workflow `.github/workflows/android.yml` и компиляция `lerne-offline-pilot-v1-debug.apk` / `v2` на раннере GitHub Actions.
2. Параллельная установка `com.lerne.offlinepilot` рядом с `com.lerne.app` на реальном телефоне.
3. Реальное обучение в авиарежиме Android WebView, переживание `Force Stop` и перезагрузки ОС.
4. Обновление `v1 -> v2` поверх установленного APK без потери SRS.
5. Живой Android SAF picker (`OfflineBackupFilePlugin`) с сохранением/открытием в локальной папке и Google Диске и перенос между двумя телефонами.

---

## 7. Инструкция по сборке APK и ручной проверке на Android

1. Разрешите и выполните `git -C C:\121\Lerne_projekt\tma-android-offline-pilot push -u origin experiment/android-offline-pilot`.
2. В GitHub откройте **Actions → Build Android APK → Run workflow**: выберите ветку `experiment/android-offline-pilot`, `build_mode = offline-pilot`, `build_upgrade_test_pair = true`.
3. Дождитесь зелёного выполнения `checks` и `build-android`, скачайте артефакт **`Lerne-Offline-Pilot-Debug-APK`**.
4. Установите `lerne-offline-pilot-v1-debug.apk` рядом с обычной Lerne, включите **Авиарежим**, откройте `Lerne Offline Pilot`: колоды должны быть доступны только для чтения (без кнопки `+`, переименования, удаления и редактирования), но с рабочими кнопками обучения, флагов и оценки карточек.
5. Изучите ≥ 20 карточек, принудительно остановите приложение (`Force Stop`) и откройте заново в авиарежиме (прогресс сохранён, колод по-прежнему 3).
6. Установите `lerne-offline-pilot-v2-debug.apk` поверх `v1` без удаления (прогресс сохранён).
7. В **Настройки → Профиль** экспортируйте `.json` через системный проводник Android (локально и в Google Диск), переустановите приложение с нуля (или на втором устройстве) и восстановите прогресс из файла.

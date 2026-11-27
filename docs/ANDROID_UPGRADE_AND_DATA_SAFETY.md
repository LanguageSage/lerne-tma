# Стратегия обновления Android APK и сохранности данных (Этап B / R3)

**Дата аудита:** 2026-11-24  
**Область:** `C:\121\Lerne_projekt\tma` (Android/Capacitor, автономный пилот `com.lerne.offlinepilot`) и связка со сборщиком `C:\121\Lerne_projekt\lerne-admin`  
**Статус:** **ЗАВЕРШЕНО (АНАЛИЗ И ПРОЦЕДУРА ГОТОВЫ; LIVE-ТЕСТ НА ЭМУЛЯТОРЕ НЕ ВЫПОЛНЯЛСЯ ИЗ-ЗА ОТСУТСТВИЯ `adb`/AVD)**

> В документе строго разделены **Подтверждённые факты** (проверенные непосредственно по исходному коду, локальному toolchain и изолированным тестам) и **Ограничения и непроверенные области** (требующие эмулятора/устройства или будущей реализации в Этапах D–F). Никакие пароли, приватные ключи, сертификаты или иные секреты здесь не публикуются.

---

## 1. Контекст и цель (R3)

### Подтверждённые факты

1. **Зафиксированные идентификаторы Android-проекта** (изменению не подлежат по требованиям R1/R3):
   - `namespace = "com.lerne.app"` (`android/app/build.gradle:7`);
   - Java-пакет `package com.lerne.app;` (`android/app/src/main/java/com/lerne/app/MainActivity.java:1`, `OfflineBackupFilePlugin.java:1`, `OfflineMaterialArchivePlugin.java:1`);
   - `applicationId "com.lerne.offlinepilot"` (`android/app/build.gradle:10`, `capacitor.config.json:2`, `app/src/utils/standaloneMode.js:10`, `appName: "Lerne Offline Pilot"`).
2. **Сборочная модель:** единственный поддерживаемый режим Android APK в `tma` — автономный Offline Pilot (`VITE_LERNE_STANDALONE=1`, скрипт `build:android` в `package.json:17`). Задача `verifyStandaloneAndroidWebBundle` в `android/app/build.gradle:31-54` блокирует `package*`/`assemble*`/`bundle*`, если в `android/app/src/main/assets/public/index.html` отсутствует `name="lerne-android-mode" content="offline-pilot"` или присутствует `telegram.org`.
3. **Позиция по сохранности данных (требование R3):**
   - **Текущие тестовые данные на Android:** их сохранность **не обязательна** — в изолированной тестовой среде допустим их контролируемый сброс при обоснованной необходимости.
   - **Будущие пользовательские данные:** архитектура обязана гарантировать их защиту при обновлении APK поверх установленной версии, миграциях схемы IndexedDB, сбоях записи и отключении питания, прерывании синхронизации и повторной отправке запросов, работе с нескольких устройств, восстановлении резервных копий и конфликтах Android/Web.
4. **Ограничения безопасности:** несогласованные операции установки, очистки или удаления на реальном телефоне запрещены; тестирование на реальных данных пользователя не выполняется.

### Ограничения и непроверенные области

- Изменения в код и конфигурацию `tma` на данном этапе не вносились: описанные в разделах 2 и 3 доработки являются рекомендациями для следующих этапов после утверждения архитектуры (раздел 13 RFC).

---

## 2. Подпись APK, `applicationId`, `versionCode`/`versionName` и совместимость обновлений

### Подтверждённые факты

#### 2.1. Фактическое состояние сборки и подписи

| Компонент | Текущее состояние в коде | Источник |
|---|---|---|
| `namespace` / Java package | `com.lerne.app` | `android/app/build.gradle:7`, `MainActivity.java:1` |
| `applicationId` / `appId` | `com.lerne.offlinepilot` | `android/app/build.gradle:10`, `capacitor.config.json:2` |
| SDK уровни | `minSdkVersion = 24`, `compileSdkVersion = 36`, `targetSdkVersion = 36` | `android/variables.gradle:2-4` |
| `versionCode` | `pilotVersionCodeProp ? pilotVersionCodeProp.toString().toInteger() : 1` (fallback `1`) | `android/app/build.gradle:3,13` |
| `versionName` | `pilotVersionNameProp ? pilotVersionNameProp.toString() : "1.0.0-offline-pilot"` | `android/app/build.gradle:4,14` |
| `signingConfigs` | **Отсутствует** в `android/app/build.gradle` и во всём каталоге `android/` | `android/app/build.gradle:23-28`, `git grep signingConfigs` |
| `buildTypes.release` | `minifyEnabled false`, без `signingConfig` | `android/app/build.gradle:23-28` |
| Локальный keystore разработчика | Файл `%USERPROFILE%\.android\debug.keystore` присутствует на рабочей машине Windows | Локальная проверка (`Test-Path`) |
| Бывший CI workflow GitHub Actions | `.github/workflows/android.yml` удалён в коммите `ccaddba`; ранее на `ubuntu-latest` собирал `assembleDebug` с эфемерным `~/.android/debug.keystore` раннера | `git show ccaddba~1:.github/workflows/android.yml` |

#### 2.2. Поведение сборщика `lerne-admin` (`android_build.py`)

- **До Этапа A (`fc94c31`):** функция `_parse_android_metadata` в `lerne-admin/src/lerne_admin/services/android_build.py` искала в `tma/android/app/build.gradle` устаревшие тернарные выражения `isOfflinePilot ? ... : ...` (удалённые при отказе от режима `standard`), не находила их и откатывалась к жёстко заданным значениям `version_code = 1`, `version_name = '1.0.0-offline-pilot'`, `upgrade_pair_v2 = { version_code: 2, version_name: '1.0.1-offline-pilot' }`, одновременно предлагая удалённый режим `standard`.
- **С учётом Этапа A (локальный коммит `af39d18531bdf1a41d0b3ad878f2abc448988f7e` в `lerne-admin`):**
  - Режим `standard` удалён (`BuildMode = Literal['offline-pilot']`, `_validate_build_mode`, `_normalize_persisted_build_mode` в `android_build.py:28,49-72`; API-схемы `AndroidBuildConfigRequest`/`StartBuildRequest` в `lerne-admin/src/lerne_admin/routers/android_build.py:30,45` и UI-селектор в `lerne-admin/ui/src/AdminAndroidBuildTab.jsx:49,61,322-334`).
  - `_parse_android_metadata` (`android_build.py:610-657`) обновлена: читает `appId`/`appName` из `capacitor.config.json` и `applicationId`/`appName`/`versionCode`/`versionName` из `tma/android/app/build.gradle`. Однако, поскольку в `build.gradle:13-14` `versionCode` и `versionName` заданы через Groovy-тернарник от Gradle-свойств (`pilotVersionCodeProp ? ... : 1`), целочисленное регулярное выражение `m_vc` возвращает fallback `1` (`upgrade_pair_v2.version_code = pilot_ver_code + 1`, т. е. `2`).
  - `_run_build_worker` (`android_build.py:1074-1158`; вызовы `gradlew.bat assembleDebug --no-daemon -PlernePilotVersionCode=... -PlernePilotVersionName=...` для `v1` и `v2` на строках `1124-1158`) собирает APK с использованием локального debug keystore хоста.
  - `inspect_apk_file` (`android_build.py:954-1032`) проверяет целостность ZIP/DEX/ресурсов, `aapt2 dump badging` и `apksigner verify --verbose --print-certs` (извлекая `signer_dn` и публичный `signer_sha256`), но пока не сверяет `signer_sha256` и `version_code` с предыдущим выпущенным артефактом.

#### 2.3. Причины ошибок установки поверх существующего APK

1. **`INSTALL_FAILED_UPDATE_INCOMPATIBLE`:** Android разрешает обновление поверх установленного пакета `com.lerne.offlinepilot` только при полном совпадении сертификата подписи. Из-за отсутствия `signingConfigs` каждый `assembleDebug` подписывается локальным `debug.keystore` сборочной машины:
   - эфемерный `~/.android/debug.keystore` каждого запуска `ubuntu-latest` в прежнем GitHub Actions отличался от следующего запуска CI и от локального Windows-ключа `%USERPROFILE%\.android\debug.keystore`;
   - поэтому APK из CI-запуска №1, CI-запуска №2 и локальной сборки `lerne-admin` имеют одинаковый `applicationId`, но **несовместимые подписи**. Единственный обход на устройстве — полное удаление приложения (`uninstall`), которое безвозвратно стирает каталог данных приложения (`/data/user/0/com.lerne.offlinepilot/`, включая `LerneStandaloneDB_900001`, `localStorage` и `lerne-offline-media/`).
   - Исключение: тестовая пара `v1` и `v2`, собранная **в одном окружении** с одним и тем же `debug.keystore` (например, опцией `build_upgrade_test_pair` в `lerne-admin`), имеет одинаковый сертификат.
2. **`INSTALL_FAILED_VERSION_DOWNGRADE`:** возникает при попытке установить APK с `versionCode` строго меньше установленного (`new.versionCode < old.versionCode`) без флага `-d` (который разрешён только для debuggable-сборок и не применяется при обычной установке пользователем). При fallback `versionCode = 1` в `build.gradle` повторная сборка без явного увеличения `-PlernePilotVersionCode` не сможет обновиться поверх тестового `v2` (`versionCode = 2`) или любого ранее повышенного релиза.

### Рекомендации (без самовольного изменения кода на этапе B)

1. **Явная стабильная подпись (`signingConfigs`):**
   - Добавить в `tma/android/app/build.gradle` блок `signingConfigs` (отдельный `release` и при необходимости постоянный `pilot` для локальных/QA-сборок), считывающий путь к keystore, alias и пароли строго из переменных окружения или Gradle properties вне репозитория (например, `LERNE_KEYSTORE_PATH`, `LERNE_KEYSTORE_ALIAS`, `LERNE_KEYSTORE_STORE_PASS`, `LERNE_KEYSTORE_KEY_PASS`).
   - Для пользовательских сборок реализовать режим **fail-closed**: при отсутствии параметров подписи сборка должна завершаться ошибкой, а не тихо подписываться случайным `debug.keystore`.
2. **Управление ключами и контроль преемственности:**
   - Никогда не коммитить `.keystore`/`.jks`/пароли в Git (`tma` или `lerne-admin`) и не логировать учётные данные в `android_build.py` или CI-логах.
   - Хранить единый релизный keystore в защищённом локальном хранилище владельца с офлайн-резервной копией (и в защищённых Secrets, если когда-либо возобновится облачная сборка).
   - Зафиксировать публичный **SHA-256 fingerprint сертификата** (без секретов) как канонический идентификатор линии обновлений и добавить в `lerne-admin` (`inspect_apk_file`) предупреждение/блокировку при несовпадении `signer_sha256` с предыдущим артефактом.
3. **Монотонный `versionCode` и единый источник версии:**
   - Вынести версию Android-приложения в единый отслеживаемый источник в `tma` (например, `android/version.properties` с полями `VERSION_CODE` и `VERSION_NAME` либо явное чтение из единого конфига), устранив зависимость от fallback `1`.
   - Проверять монотонность `new_version_code > last_released_version_code` перед выпуском любого пользовательского APK.
   - Сохранять неизменными `namespace = "com.lerne.app"`, `package com.lerne.app`, `applicationId = "com.lerne.offlinepilot"` и `capacitor.config.json:server.androidScheme = "https"` (при дефолтном `localhost`), иначе WebView сменит origin и потеряет доступ к существующим IndexedDB и `localStorage`.

### Ограничения и непроверенные области

- Фактический SHA-256 fingerprint и поведение установки `v1 -> v2` на Android PackageInstaller в этом аудите на устройстве/эмуляторе не проверялись (см. раздел 4).

---

## 3. Сохранность данных при обновлении и сбоях (R3 матрица угроз и защиты)

### Подтверждённые факты: текущая архитектура хранения

| Контур данных | Место хранения / формат | Ключевые символы и инварианты в коде |
|---|---|---|
| IndexedDB (основная БД) | `LerneStandaloneDB_900001` на WebView origin `https://localhost` (`capacitor.config.json:6`) | `STANDALONE_USER_ID = 900001`, `STANDALONE_DB_PREFIX = 'LerneStandaloneDB'` (`standaloneMode.js:11-13`); `getLocalDb` и Dexie `version(1)`–`version(5)` (`localDb.js:10-128`): `folders`, `decks`, `cards`, `progress` (`[card_id+user_id]`), `syncState` (`key`), `media` (`url`), `knowledge_*`, `user_knowledge_state`, `card_notes`. |
| Настройки и состояние UI | WebView `localStorage` (`https://localhost`) | `lerne_standalone_profile_name`, `lerne_target_language`, `lerne_has_selected_language`, `native_language`, `native_language_selected`, `STUDY_STORAGE_MAP` (`useSettingsStore.js:64-84`), `lerne:personal-design:v2:<userId>`, `lerne:published-design:v2`, `lerne_temp_id_counter` (`localDb.js:137`). `@capacitor/preferences` не установлен (`package.json:19-23`). |
| Нативные медиафайлы | `getContext().getFilesDir()/lerne-offline-media/<folder>/archive_<sha256>.<ext>` | `OfflineMaterialArchivePlugin.java:68,535-541` (`images`, `audio`, `videos`, `backgrounds`); staging в `getCacheDir()/lerne-archive-staging/` (строки `69,543-563`); отображение через `Capacitor.convertFileSrc(...)` (`offlineMediaStore.js:58`, `/_capacitor_file_/...`); индекс в `syncState['offline-media:<folder>/<filename>']`. |
| SRS-оценки и квитанции | `db.progress` + `db.syncState` | `offlineApi.js:381-428`: атомарная запись `db.progress` (`dirtyFields` выставляет `is_dirty: 1`) и `syncState['grade:<actionId>']`; для standalone удаляются `review:*` (строка `407`), а `grade:*` обрезаются до `STANDALONE_MAX_GRADE_RECEIPTS = 64` (строки `41,408-421`). |
| Локальные/импортированные карточки | `db.cards`, `db.decks`, `db.folders`, `db.syncState` | `standaloneCardStorage.js:14-15,139-418`: ID строго `> 1_000_000` (`IMPORTED_ID_START` из `materialArchiveIdentity.js:4`), `is_dirty: 0`, `standalone_local_created: true` / `standalone_local_edit: true`, квитанции `standalone-card-op:<request_id>` с лимитом `STANDALONE_MAX_CARD_OP_RECEIPTS = 64`. |
| Резервные копии прогресса (JSON) | SAF (`OfflineBackupFilePlugin`, лимит 32 МиБ) / Web Blob | `progressBackup.js` обслуживает `lerne-offline-progress-backup` schema 1. Области целостности включают `core-v1`, `full-v1`, `full-v2` для импортного прогресса и `full-v3` для исходных свидетельств Knowledge. SHA-256 вычисляется от `canonicalJson`. |
| Архивы материалов (ZIP) | SAF (`OfflineMaterialArchivePlugin`, лимит 512 МБ) / Web (`zipCodec.js`) | `materialArchive.js:21-28`: `format: 'lerne-materials'`, `SUPPORTED_ARCHIVE_VERSIONS = {2, 3, 4}`, экспорт v4, дедупликация медиа по SHA-256, идемпотентный реимпорт по `standalone_origin_key` с сохранением `db.progress` и пропуском `standalone_local_edit` (строка `1231`). |

### Матрица угроз и защиты (сценарии R3)

| Сценарий R3 | Что происходит сейчас (подтверждено кодом) | Выявленные риски и пробелы |
|---|---|---|
| **1. Обновление APK (`v1 -> v2`)** | При одинаковом `applicationId`, сертификате подписи и `androidScheme: "https"` каталог приложения `/data/user/0/com.lerne.offlinepilot/` сохраняется. `ensureStandaloneSeed` (`standaloneSeed.js:174-247`) обновляет встроенные колоды/карточки только при повышении `packVersion` и сохраняет `is_learning`, `db.progress` и карточки с `standalone_local_edit`. | 1) Несовпадение подписи разных сборок блокирует обновление (риск переустановки с потерей всех данных). 2) Встроенные колоды нельзя удалять/переименовывать без последствий для бэкапов (см. сценарий 6). |
| **2. Миграции IndexedDB (`Dexie v1–v5 -> v6+`)** | В `localDb.js:99-128` заданы версии `1..5` только через `.stores(...)` без `.upgrade(...)`. `migrateLegacy` (`localDb.js:56`) немедленно выходит при `IS_STANDALONE`. | По всему `app/src/` **нет ни одного** обработчика `db.on('versionchange', ...)` или `db.on('blocked', ...)` (`git grep` подтверждает). При появлении `v6+` и наличии параллельного контекста (второго WebView/worker) обновление схемы может зависнуть без корректного закрытия соединения. |
| **3. Сбои записи и отключение питания** | `OfflineMaterialArchivePlugin.java:367-388,850-885` пишет медиа во временный файл `<target>.<uuid>.partial`, вызывает `fos.getFD().sync()`, проверяет размер, SHA-256 и заголовки, затем делает `partial.renameTo(target)`; при старте процесса `ensureStagingDir` (`548-560`) удаляет старый staging и зависшие `*.partial`. | 1) **Окно сбоя `localMediaWriter.js:50-60`:** на native сначала вызывается `storeMediaAsset(...)`, а `await database.syncState.put(metaRecord)` идёт отдельным шагом вне транзакции (и сохранение карточки в `createStandaloneCard`/`updateStandaloneCard` — третьим шагом). При падении между записью файла и `syncState.put` файл остаётся на диске без ключа `offline-media:<folder>/<filename>`, и последующий `buildMaterialArchiveExport` (`materialArchive.js:1744-1746`) падает с ошибкой `Отсутствуют метаданные локального медиафайла`. 2) **Осиротевшие медиа:** при импорте ZIP `commitMedia` выполняется **до** Dexie-транзакции (`mediaInTransaction: false` в `materialArchiveTransport.js:163`, `materialArchive.js:1051`); при откате Dexie-транзакции или при удалении локальной карточки (`deleteStandaloneCard`) файлы `archive_<sha256>.*` не удаляются (GC отсутствует). |
| **4. Прерывание синхронизации и повторная отправка** | В standalone сеть заблокирована (`networkApi.js:80`, `standaloneBootstrap.js:33-90`). Идемпотентность локальных записей обеспечивают `grade:<actionId>` (`offlineApi.js:383-421`) и `standalone-card-op:<request_id>` (`standaloneCardStorage.js:140-148,272-280,367-377`). | Квитанции ограничены 64 последними записями, `review:*` в standalone удаляются (`offlineApi.js:407`), локальные карточки имеют `is_dirty: 0` (`standaloneCardStorage.js:223,306,391`) и локальные ID `> 1_000_000` под `user_id = 900001`. При будущем включении синхронизации V3 наивный sync не увидит историю старых оценок и созданных карточек либо столкнётся с коллизией ID, если не будет отдельной миграции. |
| **5. Несколько устройств (Android ↔ Android / Android ↔ Web)** | Перенос возможен только вручную через пары файлов ZIP (`lerne-materials`) + JSON (`lerne-offline-progress-backup`). `materialArchive.js:1231` пропускает при реимпорте карточки с `standalone_local_edit: true`. | `applyProgressBackup` (`progressBackup.js:614-626`) **полностью заменяет** локальные строки `db.progress` для встроенных и сопоставленных импортированных карточек без слияния по времени/ревизии; более свежий прогресс на целевом устройстве может быть затёрт. Настройки `localStorage` между устройствами не переносятся. |
| **6. Восстановление бэкапов (JSON / ZIP)** | `validateBackupPayload` (`progressBackup.js:149-363`) проверяет SHA-256, `summary`, `pack_id`, `pack_version <= pack.packVersion`, точный `card_set_fingerprint` на той же версии и совпадение каждой встроенной `card_id` + `card_key`. `inspectProgressBackup` (`553`) предупреждает о перезаписи. | 1) Изменение встроенных карточек без инкремента `STANDALONE_PACK_VERSION` вызывает `PACK_MISMATCH`; удаление/переименование хотя бы одной встроенной карточки вызывает `CARD_IDENTITY_MISMATCH` для всех старых бэкапов. 2) Импортированные/локальные карточки, отсутствующие в целевой БД, попадают в `unmatchedImportedRecords` и не восстанавливаются (требуется предварительный импорт ZIP). 3) Настройки `localStorage` (`STUDY_STORAGE_MAP`, `lerne:personal-design:v2:*`, имя профиля) не входят ни в JSON-бэкап, ни в ZIP-архив. |
| **7. Android Auto Backup и переустановка** | В `AndroidManifest.xml:6` указано `android:allowBackup="true"` без атрибутов `android:fullBackupContent` и `android:dataExtractionRules`. | Android OS может выборочно/асинхронно резервировать и восстанавливать данные в пределах 25 МБ: при объёмных `lerne-offline-media/` (до 512 МБ) возникает риск частичного восстановления `app_webview/` без части медиафайлов либо тихого отката `LerneStandaloneDB_900001` и `syncState` к устаревшему состоянию после переустановки. |

### Рекомендации по безопасным миграциям и будущим тестам (для Этапов D–F)

1. **Закрыть риск Android Auto Backup:** явно установить `android:allowBackup="false"` в `AndroidManifest.xml` (либо задать строгие `dataExtractionRules` / `fullBackupContent`, исключающие `app_webview/` и `lerne-offline-media/`), полагаясь на проверяемые пользователем резервные копии JSON/ZIP и будущую контролируемую синхронизацию V3.
2. **Укрепить жизненный цикл Dexie (`localDb.js`):** добавить обработчики `versionchange` (`database.close()`) и `blocked`, а также обязательные идемпотентные `.upgrade(tx => ...)` + тесты миграции схемы (например, `v5 -> v6+` на `fake-indexeddb` и в Playwright) для каждого будущего изменения схемы.
3. **Устранить окно сбоя медиа и утечку сирот:**
   - В `localMediaWriter.js` и `materialArchive.js` обеспечить самовосстановление недостающих записей `offline-media:<folder>/<filename>` по фактическому дереву `getFilesDir()/lerne-offline-media/` (через инспекцию нативного плагина при старте или перед экспортом), раз контент адресуется по SHA-256.
   - Ввести явный и безопасный сборщик неиспользуемых медиафайлов (`archive_<sha256>.*`, не упоминаемых ни в одной активной/удалённой в корзину карточке, ресурсе колоды или метаданных) — запускаемый только при отсутствии активных транзакций импорта/сохранения.
4. **Зафиксировать дисциплину эволюции `standalonePack.js`:** никогда не менять состав/ID/ключи встроенных карточек без увеличения `STANDALONE_PACK_VERSION` и без сохранения старых `card_id`/`cardKey` в таблице соответствия, чтобы бэкапы прежних версий не получали `PACK_MISMATCH` / `CARD_IDENTITY_MISMATCH`.
5. **Спроектировать явную границу перехода `LerneStandaloneDB_900001` -> V3 (Этап D):**
   - Предусмотреть однократную управляемую миграцию локальных данных профиля `900001` при первом подключении аккаунта V3 (перенос прогресса SRS, сопоставление `standalone_origin_key` и ID `>= 1_000_001` с временными/серверными ID вместо потери `is_dirty: 0` записей).
   - Для мультиустройства в бэкапах и синхронизации предусмотреть режим безопасного слияния прогресса (по событиям/`last_reviewed`/`action_id`) вместо безусловного перезаписывания всей таблицы и рассмотреть экспорт/перенос настроек `STUDY_STORAGE_MAP` и `lerne:personal-design:v2:*`.

### Ограничения и непроверенные области

- Поведение реального Chromium WebView на Android (`app_webview/Default/` IndexedDB и `localStorage`) при `am force-stop`, `install -r` и Google Auto Backup не проверялось на устройстве/эмуляторе.

---

## 4. Статус локальной среды и воспроизводимая процедура проверки

### Подтверждённые факты о локальной среде

Проверка локального окружения выполнена 2026-11-24 в `C:\121\Lerne_projekt\android-toolchain` и `%USERPROFILE%\.android`:

| Инструмент / компонент | Статус | Фактический путь / версия |
|---|---|---|
| JDK 21 | **Присутствует** | `C:\121\Lerne_projekt\android-toolchain\jdk-21.0.13.1+2\bin\java.exe` (`OpenJDK 21.0.13.1+2-LTS`) |
| Gradle | **Присутствует** | `C:\121\Lerne_projekt\android-toolchain\gradle-8.14.3\bin\gradle.bat` (`Gradle 8.14.3`) |
| Android SDK `build-tools` | **Присутствует** | `sdk\build-tools\35.0.0`, `36.0.0` (содержат `aapt2.exe`, `apksigner.bat`) |
| Android SDK `platforms` | **Присутствует** | `sdk\platforms\android-36` |
| Локальный debug keystore | **Присутствует** | `%USERPROFILE%\.android\debug.keystore` |
| `platform-tools` (`adb`) | **ОТСУТСТВУЕТ** | Нет в `android-toolchain\sdk` и в глобальном `PATH` |
| `emulator`, `cmdline-tools` (`avdmanager`/`sdkmanager`), system images, AVD | **ОТСУТСТВУЮТ** | Нет в `android-toolchain\sdk`, `%USERPROFILE%\.android\avd` отсутствует |

**Вывод по среде:** в текущей локальной среде сборка APK и статическая проверка подписи/манифеста через `aapt2` и `apksigner` возможны, но **live-тест обновления на Android-эмуляторе локально невыполним** (и по условию R3 **не блокирует** дальнейший архитектурный аудит Этапа C и подготовку RFC Этапа D).

### 4.1. Воспроизводимая процедура (a): локальная проверка APK-пары `v1`/`v2` без эмулятора

Выполнять из `C:\121\Lerne_projekt\tma` при заданных `JAVA_HOME`, `ANDROID_SDK_ROOT` (`ANDROID_HOME`) и `GRADLE_USER_HOME` на `C:\121\Lerne_projekt\android-toolchain` (либо через UI/API `lerne-admin` с опцией пары обновления `v1 + v2`):

```powershell
$tc = "C:\121\Lerne_projekt\android-toolchain"
$env:JAVA_HOME = "$tc\jdk-21.0.13.1+2"
$env:ANDROID_HOME = "$tc\sdk"
$env:ANDROID_SDK_ROOT = "$tc\sdk"
$env:GRADLE_USER_HOME = "$tc\gradle"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

# 1. Сборка веб-бандла Offline Pilot и синхронизация Capacitor
npm run build:android

# 2. Сборка пары APK с одним локальным keystore и монотонным versionCode
Push-Location android
.\gradlew.bat assembleDebug --no-daemon -PlernePilotVersionCode=1 -PlernePilotVersionName=1.0.0-offline-pilot
Copy-Item app\build\outputs\apk\debug\app-debug.apk ..\local\test-data\lerne-offline-pilot-v1-debug.apk

.\gradlew.bat assembleDebug --no-daemon -PlernePilotVersionCode=2 -PlernePilotVersionName=1.0.1-offline-pilot
Copy-Item app\build\outputs\apk\debug\app-debug.apk ..\local\test-data\lerne-offline-pilot-v2-debug.apk
Pop-Location

# 3. Проверка манифеста, applicationId, versionCode и идентичности подписи
$bt = "$tc\sdk\build-tools\36.0.0"
& "$bt\aapt2.exe" dump badging local\test-data\lerne-offline-pilot-v1-debug.apk | Select-String "package:"
& "$bt\aapt2.exe" dump badging local\test-data\lerne-offline-pilot-v2-debug.apk | Select-String "package:"
& "$bt\apksigner.bat" verify --verbose --print-certs local\test-data\lerne-offline-pilot-v1-debug.apk | Select-String "SHA-256 digest"
& "$bt\apksigner.bat" verify --verbose --print-certs local\test-data\lerne-offline-pilot-v2-debug.apk | Select-String "SHA-256 digest"
```

**Критерии прохождения без эмулятора:**
1. Оба APK имеют `package: name='com.lerne.offlinepilot'`, при этом `versionCode='1'` у v1 и `versionCode='2'` у v2.
2. Обе команды `apksigner verify` завершаются с кодом `0`, а строка `Signer #1 certificate SHA-256 digest` у v1 и v2 посимвольно совпадает (и совпадает с эталонным отпечатком предыдущего выпуска).

### 4.2. Воспроизводимая процедура (b): изолированный тест обновления `v2` поверх `v1` на эмуляторе

Применять **только** после доустановки `platform-tools`, `emulator`, `cmdline-tools` и системного образа в `android-toolchain\sdk` и **только** против серийного номера эмулятора (`emulator-*`), не затрагивая реальный телефон без отдельного разрешения:

1. **Предусловие (read-only):**
   - `adb devices -l` и `emulator -list-avds` — убедиться, что целевое устройство имеет вид `emulator-5554`.
2. **Чистая установка `v1`:**
   - `adb -s emulator-5554 install <path-to-v1.apk>` -> ожидается `Success`;
   - `adb -s emulator-5554 shell dumpsys package com.lerne.offlinepilot | findstr versionCode` -> `versionCode=1`.
3. **Заполнение изолированных тестовых данных в `v1`:**
   - Включить на эмуляторе авиарежим / отключить сеть, открыть `Lerne Offline Pilot`.
   - Изучить и оценить не менее 5 встроенных карточек (проверка записи в `LerneStandaloneDB_900001.progress` и `syncState` ключей `grade:*`).
   - Импортировать синтетический ZIP-архив `lerne-materials` v4 с минимум 1 изображением и 1 аудиофайлом (проверка `getFilesDir()/lerne-offline-media/` + `decks`/`cards`).
   - Создать 1 локальную карточку с прикреплённым локальным медиа и отредактировать 1 карточку (`standalone_local_created` / `standalone_local_edit`).
   - Изменить минимум 2 настройки обучения/интерфейса в `localStorage` (например, имя профиля и параметр автопроигрывания/режим обучения).
   - Выполнить экспорт резервной копии прогресса (`.json`) и экспорт материалов (`.zip`) через Android SAF.
4. **Имитация принудительной остановки процесса до обновления:**
   - `adb -s emulator-5554 shell am force-stop com.lerne.offlinepilot`
   - Повторно запустить приложение, убедиться, что прогресс SRS, локальная карточка, медиа и настройки сохранились.
5. **Обновление `v1 -> v2` поверх установленного приложения (без `-d` и без `uninstall`):**
   - `adb -s emulator-5554 install -r <path-to-v2.apk>` -> ожидается `Success`.
   - Проверить `dumpsys package com.lerne.offlinepilot | findstr versionCode` -> `versionCode=2`.
6. **Пост-обновлённые проверки (все обязательны):**
   - Встроенные, импортированные и локально созданная/отредактированная карточки отображаются; прикреплённые изображения и аудио воспроизводятся из `lerne-offline-media/`.
   - Прогресс SRS (`progress`) и настройки в `localStorage` совпадают с состоянием до обновления.
   - Повторный экспорт `.zip` (включая локально созданную карточку с медиа) и `.json` (scope `full-v2`) завершается успешно.
   - Импорт `.json` бэкапа, снятого на шаге 3 (до обновления `v1 -> v2`), успешно проходит `validateBackupPayload` и `inspectProgressBackup`.
7. **Критерии провала (причины дефекта):**
   - `INSTALL_FAILED_UPDATE_INCOMPATIBLE` -> несовпадение сертификата подписи `v1` и `v2`.
   - `INSTALL_FAILED_VERSION_DOWNGRADE` -> `versionCode` не увеличен монотонно.
   - Потеря `LerneStandaloneDB_900001` или `localStorage` -> изменились `applicationId` либо WebView `androidScheme`/`hostname`.
   - Пропажа медиафайлов или ошибка экспорта ZIP -> потеря/рассинхронизация `getFilesDir()/lerne-offline-media/` или ключей `offline-media:` в `syncState`.

### 4.3. Автоматические тесты совместимости в `tma` (без эмулятора)

#### Подтверждённые факты (запущено при подготовке данного отчёта, read-only)

- Изолированные unit-тесты автономного пилота, архивов материалов, локального медиахранилища, редактора карточек и бэкапов прогресса:
  ```sh
  node --import ./scripts/tests/no-network.mjs --experimental-test-module-mocks --test app/src/services/__tests__/standaloneOfflinePilot.test.js app/src/services/__tests__/standaloneMaterialArchive.test.js app/src/services/__tests__/standaloneCardEditor.test.js
  ```
  **Фактический результат (2026-11-24):** **PASS — `24/24` тестов (`3/3` suites)** без модификации файлов.

#### Дополнительные профильные команды в репозитории (в рамках Этапа B не запускались)

- Совместимость формата архива с Admin/backend:
  `python scripts/test_backend.py scripts/tests/test_android_admin_archive_compat.py`
- Сквозные браузерные Playwright-проверки standalone-сборки (после `VITE_LERNE_STANDALONE=1 npm --prefix app run build`):
  - `node scripts/tests/browser/standalone-offline-pilot.check.cjs`
  - `node scripts/tests/browser/standalone-offline-materials.check.cjs`
  - `node scripts/tests/browser/standalone-card-editor.check.cjs`
- Генерация карточек, озвучка и сохранение WAV после перезапуска Chromium:
  `node scripts/tests/browser/standalone-ai-tts.check.cjs`. Тест поднимает локальный Vite
  в режиме Android Offline и подменяет ответы Gemini. Для Piper на Android используется
  нативный плагин `AndroidPiperTts`.

### Ограничения и непроверенные области

- Сборка пары APK (`v1`/`v2`), прогон `aapt2`/`apksigner` над свежесобранными APK, а также прогоны `test_android_admin_archive_compat.py` и Playwright `standalone-*.check.cjs` в рамках данного документационного задания не выполнялись.
- Живой тест на Android-эмуляторе или физическом устройстве не проводился по причине отсутствия `adb`, `emulator` и AVD в локальной среде.

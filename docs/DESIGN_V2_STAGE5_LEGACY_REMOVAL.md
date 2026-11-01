# Design V2 — этап 5: прекращение поддержки V1 оформления

Решение пользователя от 2026-11-01: старое личное оформление не требуется сохранять или переносить. Общий опубликованный V2 применяется ко всем; аудит охвата V1 не является условием rollout. Эта политика заменяет условия ожидания cutoff в отчётах этапов 3–4D.

## Изменения

- Удалён legacyAdapter.js: defaults/map и конвертер V1 → V2 больше не входят в приложение.
- Личные документы создаются непосредственно из V2 defaults; старые localStorage и server flat settings не импортируются.
- Удалены restorePersonalDesignFromBackup, importLegacyPersonalDesign и кнопка «Импорт прежних настроек». Импорт/экспорт нативного V2 JSON, общий опубликованный дизайн, admin draft и V2 пресеты сохранены.
- Удалены fallback загрузки admin draft/preview из старого V1 snapshot.
- Старые localStorage design keys и source claim удаляются после успешной записи V2 record. Из существующего record удаляются V1 local/server/serverUpdates копии. Актуальный V2 config/preset и очередь offline-правок сохраняются.
- Сервер больше не создаёт и не выдаёт USER_DESIGN_V1_BACKUP. Endpoint /user/settings/design-backup удалён.
- read_user_settings фильтрует retired design fields, включая bootstrap /api/init. save_user_settings атомарно удаляет эти поля из текущего JSON и входящего payload, удаляет V1 backup данного аккаунта и сохраняет V2 с прежними CAS/revision guards. Настройки обучения, языка, неизвестные не-дизайнерские поля сохраняются.
- Конвертерные тесты удалены как тесты отменённого контракта; тестовые сцены упражнений теперь задают нативный V2. Сохранены browser проверки offline, account isolation, common precedence, фонов, typography и взаимодействий. Добавлены проверки отказа от V1 и безопасной очистки.

## Границы

Изменения подготовлены в codex/design-v2-personal-migration, без commit/push/deploy. Production БД напрямую не изменялась. Очистка серверных данных выполняется для аккаунта при следующем сохранении настроек после deploy; неактивные строки автоматически массово не переписываются, но их V1 поля уже не используются и не возвращаются клиенту. Отдельная массовая операция здесь не нужна для отображения общего V2.

Сохранены актуальные личные документы V2 и наследование их фона при пустом background. Это нативная V2-функция. Старые global.appBg/glassBg/glassBorder/background.mode=legacy являются работающим форматом документов V2, а не flat V1 renderer; их удаление потребовало бы отдельного преобразования V2. Legacy учебного контента не затронут. Общие revision backups публикаций, включая GLOBAL_DESIGN_V2_BEFORE_COMMON_20261030_R22, не затронуты.

## Проверки

- Полный frontend suite: 545 PASS до двух дополнительных cleanup regressions; последующая targeted проверка personal V2/cleanup — 9 PASS.
- 7 backend tests SQLite: PASS; rollback очистки/записи, retired fields, старый клиент, CAS, validation, permissions.
- Эти же 7 tests на новом временном PostgreSQL: PASS. Concurrent writes: 200/409. pg_dump/pg_restore в другую новую БД: PASS, V2 revision recovery: PASS. Артефакты: local/test-data/personal-design-pg-3ddf5a8b25c84770b36c79dd9941385f.
- Isolated Vite build: PASS, local/test-data/design-v2-cutoff-build. Предупреждения смешанных static/dynamic imports сохраняются.
- py_compile, targeted ESLint и git diff --check: PASS.
- Browser: 84 уникальных сценария PASS по совокупности прогонов. Первый прогон: 79 PASS / 4 FAIL из-за неполного переноса цветов fixtures с конвертера на V2; точные native поля freeText.input, match.item/matchRightText и speech.mainText исправлены без изменения assertions. Повтор: 6 PASS (4 исправленных, 1 ранее проходивший и 1 новый legacy-only сценарий).
- Отдельный визуальный просмотр screenshots этого этапа не выполнялся; browser проверяет реальный UI, размеры, CSS, отсутствие старой кнопки и сохранение взаимодействий.

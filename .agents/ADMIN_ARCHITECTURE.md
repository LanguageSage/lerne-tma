# Независимая админка lerne-admin

Проект `C:\121\Lerne_projekt\lerne-admin` содержит UI, HTTP perimeter, workers,
импорт/перенос/backup и собственный domain core в `src/lerne_admin/core`.
TMA не является устанавливаемой зависимостью админки. TMA предоставляет своё
приложение, API, LOCAL dev/test и собственную серверную логику независимо.

Общая граница — формат данных/прав/импорта и DB contract, а не Python imports.
`api/admin_contract.json` и `scripts/verify_admin_contract.py` фиксируют reviewed
versions/source fingerprints; backend gate проверяет artifact. Подробный lifecycle
изменений — `docs/ADMIN_COMPATIBILITY.md`, в админке — `docs/COMPATIBILITY.md`.

Runtime не ищет sibling TMA, .env или Git checkout. Admin snapshots обновляются
только отдельной candidate/review/test процедурой. Admin-owned diagnostics v2 и
`core/compatibility_profiles.json` версионируют проверенные LOCAL/Supabase schemas.
UI показывает отчёт по операциям; warnings требуют подтверждения в локальном
журнале, critical блокируют только затронутые операции. Перед записью проверка
повторяется; изменившаяся схема инвалидирует старое подтверждение. DB marker
`LERNE_ADMIN_CONTRACT` больше не обязателен. Metadata, schema/RLS/grants и
Production-настройки автоматически не меняются. Saved jobs сохраняют base contract.
Админка ориентирована на desktop; мобильное/удалённое управление — отдельная
будущая задача. Её правила: `lerne-admin/AGENTS.md` и проектный `admin-ui` skill.

Единственная необязательная UI-связь — LOCAL HTTP-переход на loopback 8050.
TMA-owned tests LOCAL permission link/media redirect остаются в TMA, admin tests
и fixtures полностью принадлежат отдельному проекту. Исправления baseline main
для offline flag, auth/session и frontend harness интегрированы; source fingerprint
import обновлён после review, без автоматического изменения DB marker.

Config, checkpoint, LOCAL/облачные базы, media и backups остаются внешними.
История этапа editable core: docs/ADMIN_EXTRACTION_AUDIT.md (superseded).

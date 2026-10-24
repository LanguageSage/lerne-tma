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
только отдельной candidate/review/test процедурой. При неизвестном DB contract,
изменённой physical schema или несовместимом saved job запись админки блокируется.
DB metadata не регистрируется и Production migrations не применяются автоматически.

Единственная необязательная UI-связь — LOCAL HTTP-переход на loopback 8050.
TMA-owned tests LOCAL permission link/media redirect остаются в TMA, admin tests
и fixtures полностью принадлежат отдельному проекту. Исправления baseline main
для offline flag, auth/session и frontend harness интегрированы; source fingerprint
import обновлён после review, без автоматического изменения DB marker.

Config, checkpoint, LOCAL/облачные базы, media и backups остаются внешними.
История этапа editable core: docs/ADMIN_EXTRACTION_AUDIT.md (superseded).

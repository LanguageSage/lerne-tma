# Независимая админка lerne-admin

Проект `C:\121\Lerne_projekt\lerne-admin` содержит UI, HTTP perimeter, workers,
импорт/перенос/backup и собственный domain core в `src/lerne_admin/core`.
TMA не является устанавливаемой зависимостью админки. TMA предоставляет своё
приложение, API, LOCAL dev/test и собственную серверную логику независимо.

Общая граница — формат данных/прав/импорта, DB contract и чистый пакет lerne-card-core.
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


## Shared card package — 2026-10-25

JSON V2, passport validators, answer contracts, legacy parsing and conversion now
have one implementation in `api/card_core/lerne_card_core` (lerne-card-core 0.1.0).
The five old `api/services` modules are compatibility aliases. Admin consumes an
exact wheel release; its DB/models/permissions/runtime remain independently owned.
TMA uses the same package sources inside the existing Vercel `api/` input tree;
no pip registry, sibling checkout or new deployment entry point is required.
Release procedure and scope: `api/card_core/README.md`.

The contract verifier follows the implementation and normalizes relative imports
back to logical service names, so an extraction alone preserves fingerprints and
saved jobs. It also checks aliases; future logic changes still require review.
Database schema, SRS/progress, receipts, permissions and deployment config are unchanged.

## Card suggestions — 2026-10-26

Admin owns `/api/admin/card-suggestions` (list/status/reply) and the «Предложения»
tab, with a link to the existing card editor. It reads only `kind=suggestion` in
new `tma_card_note`; personal notes are excluded. The trusted loopback console
operator is the existing administrative authority. Host/Origin, alternate-source
read-only dispatch, DB compatibility and revision conflict checks remain
enforced; there is no remote moderator login or new role system. TMA owns
additive migration 87; Admin never migrates this table. Schema contract v2 and
optional profiles are reviewed in Admin's
`reviews/card-notes-2026-10-26/README.md`. Missing/unknown annotation schemas block
only annotation writes. Sources and UI tests are owned by `lerne-admin`, with no
runtime TMA import.

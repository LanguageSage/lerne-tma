# Независимая админка lerne-admin

Проект `C:\121\Lerne_projekt\lerne-admin` содержит UI, HTTP perimeter, workers,
импорт/перенос/backup и собственный domain core в `src/lerne_admin/core`.
TMA не является устанавливаемой зависимостью админки. TMA предоставляет своё
приложение, API и серверную логику независимо.

Общая граница — формат данных/прав/импорта, DB contract и чистый пакет lerne-card-core.
`api/admin_contract.json` и `scripts/verify_admin_contract.py` фиксируют reviewed
versions/source fingerprints; backend gate проверяет artifact. Подробный lifecycle
изменений — `docs/ADMIN_COMPATIBILITY.md`, в админке — `docs/COMPATIBILITY.md`.

Runtime не ищет sibling TMA, .env или Git checkout. Admin snapshots обновляются
только отдельной candidate/review/test процедурой. Admin-owned diagnostics v2 и
`core/compatibility_profiles.json` версионируют проверенные схемы SQLite и Supabase.
UI показывает отчёт по операциям; warnings требуют подтверждения в локальном
журнале, critical блокируют только затронутые операции. Перед записью проверка
повторяется; изменившаяся схема инвалидирует старое подтверждение. DB marker
`LERNE_ADMIN_CONTRACT` больше не обязателен. Metadata, schema/RLS/grants и
Production-настройки автоматически не меняются. Saved jobs сохраняют base contract.
Админка ориентирована на desktop; мобильное/удалённое управление — отдельная
будущая задача. Её правила: `lerne-admin/AGENTS.md` и проектный `admin-ui` skill.

Config, checkpoint, базы, медиа и резервные копии Admin находятся вне TMA.
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

## Personal messages — stages 1–2, 2026-10-26

TMA migration 90 separates private `tma_card_note` from `tma_user_message`.
Suggestions and replies use the shared message table and retain a card ID/link
without a card FK. Admin uses `/api/admin/messages` for list, conversation,
read and reply. Its writes use the migration 90 message-table compatibility
profile and the existing loopback perimeter. TMA exposes owner-only
`/api/messages`; TMA now has a "Мои сообщения" view and opens suggestions from
the card action menu. Admin never runs TMA migrations.


## Unified Native V2 storage — 96

Admin-owned models and exact profiles now use tma_deck/tma_card for personal and
library material. Scope lives on the deck; library_category remains the catalog
hierarchy. Existing lib_<id> route keys are presentation keys for scoped reads,
not a second ID space or storage adapter. Unknown scope/catalog still fails closed.
Admin does not apply 96. Copied material is independent; linked regeneration is
removed from the controls and rejected by request schemas. Existing jobs carrying
the previous base contract need a new preview. Shared card-core is unchanged.
Selected independently reviewed core candidates live in Admin's
reviews/native-unified-storage96; its release-pair manifest describes both contracts.

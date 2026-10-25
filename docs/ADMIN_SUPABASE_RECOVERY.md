# Supabase / independent Admin recovery — 24 October 2026

> Superseding Admin compatibility update, 24 October 2026: the new diagnostic
> candidate works with the existing reviewed Supabase schema without the 17-column
> repair or DB contract registration described below. Those SQL drafts are historical,
> not prerequisites. Runtime diagnostics/explicit warning acknowledgement replace the
> marker gate; no hosted changes were applied. See the independent Admin's
> `docs/DIAGNOSTICS_REPORT.md` and `docs/COMPATIBILITY.md`. Nullable model changes
> and a simplified Continue/Cancel interface were deferred by the user.

Production was used for SELECT and HTTP GET only. No production data, schema,
grants/RLS, DB marker, Storage objects, billing settings or cloud-write flags
were changed. Final read-only check: **33,915 cards; zero Admin contract markers**.
The existing installed Admin wheel and the user's `run_admin.bat` edits were preserved.

## Fresh PostgreSQL backup and recovery evidence

Artifacts are outside Git in
`C:\121\Lerne_projekt\tma\backups\supabase-recovery-20261024`.

- `supabase-full.dump`: complete custom-format pg_dump, **32,488,657 bytes**,
  SHA-256 `a05acb97d7467f9570ae23511a9189c61846f9d1024b3b8f24d03ed6e5937606`.
  Created 2026-10-24 around 16:14 UTC, not from the historical JSON.
- `roles-no-passwords.sql`: separate role definitions/memberships, excluding role
  passwords. `backup-manifest.json`: counts and row checksums for all **80 tables**
  from the same exported REPEATABLE READ snapshot used by pg_dump.
- TLS/read-only session pooling was used. Native libpq's outbound network call
  was blocked; a local Python TCP relay carried its end-to-end TLS connection.
- A new loopback PostgreSQL cluster was initialized under `verification-cluster`.
  The existing LOCAL server/database was not used or overwritten.
- Full native restore stops at unavailable Windows extension `supabase_vault`.
  A clean portable restore completed with exit 0 after excluding exactly eight
  Vault extension/data/ACL TOC entries. **79 tables** were restored; every row
  count and aggregate checksum matched. The excluded `vault.secrets` was empty.
  Hosted role bootstrap/grantor handling also needed a local-only adjustment.
- This verifies application recovery, not a faithful full Supabase platform
  restore. Full platform recovery still requires an environment with the real
  Vault extension and hosted role bootstrap. No substitute extension was installed.
- PostgreSQL archives contain Storage metadata and DB blobs, **not external
  Storage object bytes**. Storage assets could not be recovered/tested through
  the restricted HTTP service.

Evidence: `portable-exclusions.json`, `schema-verification.json`,
`original-rows-after-import.json`, logs and `artifact-checksums.json`.
After all import tests, all **92,094 original rows** in the 79 recovered tables
were still present with identical row hashes. Added rows belonged to test jobs.

## All 17 schema/model differences

Both TMA and Admin require the same fields. There are no missing content columns.
The sixteen columns below admit NULL in Supabase but are non-nullable in both
models; every current NULL count was **zero**:

| Table | Columns requiring NOT NULL |
| --- | --- |
| `tma_user` | `has_selected_language`, `default_decks_initialized` |
| `tma_folder` | `position` |
| `tma_deck` | `user_id`, `is_inbox`, `is_pinned`, `position`, `created_at`, `metadata` |
| `tma_card` | `is_deleted`, `want_to_learn`, `history`, `position`, `flag` |
| `tma_collaborator` | `can_edit_audio` |
| `tmasetting` | `value` |

Difference 17: `tma_offline_batch.payload_hash` is `varchar(64)` in Supabase,
while the existing model contract requires capacity 255.

Prepared operator-only SQL: [`prepare_admin_schema.sql`](../scripts/maintenance/prepare_admin_schema.sql).
It adds those NOT NULL constraints and widens the varchar to 255 in one bounded
transaction, reusing the migration advisory lock. There are no row updates,
backfills, default changes, grants, RLS changes or marker writes. Existing defaults
already match the required behavior. It is deliberately outside startup migrations.

Tested on the restored copy: all 17 checks pass, original row hashes remain
identical, rerunning approval succeeds. A NULL injected into another disposable
copy makes the SQL fail and roll back without schema changes. Unexpected NULLs
in Production must likewise abort for review; do not invent owner/default backfills.

## Contract registration prepared, never applied to Production

`proposed-production-contract.json` and `register-admin-contract.DRAFT.sql` are in
the artifact directory. The draft INSERT includes required `updated_at`, and an
unexpected existing marker aborts instead of being overwritten.

There are five equivalent CHECK-expression rendering differences between the
hosted PostgreSQL 17.6 and restored Windows PostgreSQL 17.11. Columns, defaults
and indexes otherwise compare exactly. **Do not copy the test DB fingerprint
to Production and do not normalize/relax the guard.**

- Current Production schema fingerprint:
  `16e810525c7b2d91bb6591500eafe5d5f90cb42a1f4bc580a236ad1179daa83c`.
- Expected Production fingerprint after only the 17 reviewed alterations:
  `a3ac9a199ec9a66b38201b18819d5267bc0326b64d58f66de390e5c9158331b6`.
- Restored/test schema fingerprint after repair:
  `3534edf02ccf6d6de928798d46f555b1e8e33dd728bd53220a67119ac1c423a2`.

The Production candidate was calculated from Production catalog rows with only
the reviewed column changes. After an authorized migration, regenerate the actual
proposal with Admin `--mode cloud --env-file ABSOLUTE_ENV --prepare-contract`.
Its whole output must equal the reviewed Production candidate before registration.
Any difference requires review. The bundled TMA/Admin compatibility artifacts match
exactly; neither snapshot nor contract versions/source hashes were changed.

On the disposable copy only, a test marker was registered. Missing marker blocked
writes before registration; adding a column afterward blocked writes again. These
checks use the original guard without caching or bypasses. Catalog checks also
confirmed the configured Production role already has required import table and
sequence privileges; no grants were issued.

## Storage and import verification

Storage GET `/storage/v1/bucket` still returns **HTTP 402** with the explicit
violation **`exceed_egress_quota`**. This is outbound traffic restriction, not an
observed storage-capacity or unpaid-invoice diagnosis. Supabase's
[HTTP status documentation](https://supabase.com/docs/guides/troubleshooting/http-status-codes)
and [egress documentation](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
describe these restrictions. Billing/spend caps were left unchanged.

The direct text importer requires no Storage assets. Three prepared lessons
(source deck IDs 7100/7101/7102) from the latest material JSON
`C:\121\Lerne_projekt\data\full_db_backup_20261021_081413.json` passed actual
**Production READ ONLY preview: 117 cards, no problems, zero Storage assets**.
The guard still blocks Production apply. The same files passed actual apply and
response replay on the restored PostgreSQL copy, without external HTTP calls.

| Flow | Verified limit |
| --- | --- |
| LOCAL ↔ Supabase transfer | 2000 cards / 1000 decks / 200 folders per job |
| Direct folder/file import | 5000 cards across selected files per request |
| New `lerne-admin-import` CLI | Multiple bounded transactions; default 200 cards per batch, configurable 1..500 |

Source validation accepts 5000 and rejects 5001 before DB access. The direct UI
limit and transfer limits remain unchanged. A local 100-card guarded direct import
took about 2.8 seconds; large jobs otherwise hold a single transaction and lack
intermediate progress/recovery checkpoints.

The independent Admin now has an additional content-only backup import CLI using
the existing content gateway, permission checks and atomic receipts. It prints
progress after each commit and supports explicit manual resume with the same
preview job ID. Failed batches roll back together; completed batches remain.
It never creates users, copies SRS/grants/identities or uploads Storage objects.
See [Admin operator instructions](../../lerne-admin/docs/MATERIAL_IMPORT_RECOVERY.md).

On the restored copy: **154 B1 decks / 7128 cards / 154 committed batches** from
that JSON were imported in about **241 seconds including resume and full replay**.
An injected post-COMMIT response loss resumed correctly. A full repeated run
created no duplicate cards/decks/folders; external HTTP calls were blocked.
Seventeen source cards had media fields omitted by the explicit text-only projection.

The new wheel was built and unpacked for isolated checks. Its new CLI entry point
and bundled assets/core load without sibling source paths; the running installed
Admin was not replaced. The candidate retains version 0.2.1 and is not a published
release. Tests passed: 5 new importer, 27 existing file importer, 7 compatibility,
21 transfer tests; the 5 new tests also passed from the built wheel. Changed Python
files compile. No UI was changed; no UI verification or paid AI/TTS was performed.

## Secondary LOCAL preparation

`materials_sandbox` is another new database in the isolated verification cluster.
It contains **627 cards / four decks** (1926, 7100, 7101, 7102), one synthetic account,
and zero copied users, grants, auth, SRS/review records or media. One 510-card deck
was actually written as 200/200/110-card transactions. Progress for the entire job:
200, 400, 510, 546, 579, 627. `materials-only.dump` contains only this sandbox.
It can be restored into a fresh test database/cluster for LOCAL preparation; do not
restore it over existing LOCAL. Its own restore into `materials_restore_verify`
completed with exit 0 and verified all 627 cards / one synthetic user. Recheck
the DB marker after any restore.

The verification cluster is stopped when work finishes; its files are retained.
The original LOCAL configuration and database have not been changed.

## Separate authorizations still required

1. Complete the faithful full platform restore check in a Vault-capable recovery
   environment before enabling cloud writes. A new paid cloud environment would
   require separate cost approval; none was created here.
2. Stop Admin writers and apply the reviewed 17-column repair to Production,
   after checking a fresh backup and current preflight. No content backfill is proposed.
3. Regenerate/review the exact Production proposal and separately register
   `LERNE_ADMIN_CONTRACT` using the prepared draft.
4. Deploy/install the reviewed Admin candidate as desired, then authorize an
   actual small Production lesson import and verify its result. Transfer cloud-write
   flags, if needed, require an explicit separate change; this work did not enable them.
5. Any plan upgrade or spend-cap/billing change to remove the Storage restriction
   needs separate authorization. Text-only importing does not call Storage, but
   a Production write has intentionally not been performed to prove final availability.

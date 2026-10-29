# Review admin contract и персонального «Учить» — 29.10.2026

Stage 1 was saved independently: TMA `41d1058`, Admin `e85de50`. Its card-core
0.1.3 wheel is unchanged. `lerne-admin/reviews/tma-contract-2026-10-29/release-pair.json` records the exact
reviewed peer contract separately from Admin's own contract.

TMA schema 2 → 3 is a real incompatible change to the former note/suggestion
table: TMACardNote loses moderation fields, TMAUserMessage owns conversations
and historical card links, and auth challenges gain nullable verified_profile.
The schema review uses `git diff 1e0d27d -- api/models.py`. The contract's schema
fingerprint is `0684a02f0b3155062478603f016a8ab782193e9e07afe5c181d2ec32738d0fbf`.

TMA import 1 → 2 was reviewed against `a0179fc`, the source of the previous
fingerprint: card-content audio invalidation can be deferred; new/changed audio
links are checked before saves/copy/overwrite; personal learning is exclusively
in TMASetting, with explicit upsert and no canonical metadata opt-in.
Author parsing, content-update orchestration and folders are unchanged in this
comparison. The fingerprint is
`58e635094a13859d2114fdac270afe7a4a2d323dca165c4bd31a9ac648a30a5c`.
Permissions and card-format contracts retain their current versions and hashes.

Admin compatibility is a consumer-capability review, not a claim that the two
backends have identical full source fingerprints:

- Ten common model declarations agree on columns, field classes, nullability,
  lengths and primary keys except the pre-existing receipt `payload_hash`
  declaration: Admin varchar(64), TMA varchar(255). Both write 64-character
  SHA-256 values; Admin's existing DB profiles still require the exact reviewed
  real schema. This precise difference is allowlisted; any new difference fails.
- Admin does not own or read personal notes/auth challenges. It accesses messages
  through its separate SQL adapter. Its existing migration-90 message profile
  matches current TMA columns, types, lengths and nullability; router columns
  must match that profile. Existing isolated conversation tests remain active.
- Admin import/media orchestration verifies Storage separately. Its own actor,
  receipts, write guard and profiles are not replaced by TMA services.
- Admin's historical base contract and profile binding stay unchanged. Existing
  jobs still validate against that exact Admin release; the peer TMA contract
  cannot be substituted into a checkpoint. No blanket acceptance of schema 3.

The optional `tools/verify_card_core_interop.py --tma-root ...` runs TMA's strict
source verifier, compares the exact peer contracts and model capabilities, and
repeats card/V2/save/export regressions in isolated separate processes.
Ordinary Admin tests check profile/checkpoint integrity without a TMA checkout.

No live database catalog was read or changed, and no migration, material update,
push or deployment was performed. This source/model review does not claim live
PostgreSQL or external Storage/AI verification.


## Backend regression changes

Two sync tests expected legacy deck metadata to opt the owner into learning.
The existing learning/reminder contract intentionally rejects that behavior.
The fixture now contains explicit personal off/on settings and a third deck
with no setting, whose expected value is false despite metadata=true.
`pull_offline` reads only its batched personal settings map; its obsolete call
into the metadata resolver was removed. It already returned false for absent
settings because that resolver strips the legacy key. No user data is rewritten.

New regressions cover owner/editor/viewer independence and an inaccessible user;
turning learning off preserves all existing card/deck, SRS and review-history
rows and another user's preference. Raw metadata and resources still round-trip,
media is not resolved by the flag, and query counts stay bounded.

The verifier implementation and all old assertions remain active. New mutation
checks reject changes to nullable verified_profile/message card_id, deletion of
validate_new_audio_path, and attempts to default personal learning to true.
Only the reviewed schema and import versions/hashes are changed. Existing
permissions and cards fingerprints are unchanged. No --update shortcut was used.


## Final verification

- TMA full isolated backend: 37 suites, 468/468 tests, Backend passed.
- Admin full isolated backend: 23 suites, 254/254 tests, All admin suites passed.
- Optional interop gate: identical 10 LF/CRLF observations; V2/save/export/reimport;
  exact contract pair, ten common model projections with the single reviewed
  receipt-width difference, and message column/type/nullability profile match.
- py_compile of five changed Python files and both diff --check gates: PASS.
- Admin --check-install and pip check: PASS; wheel 0.1.3 unchanged.

Tests use disposable SQLite with network, dotenv and real PostgreSQL blocked.
No live database/catalog or educational materials were accessed or changed.
No migrations, push or deployment. Review and fixes are saved separately from
stage 1; independent Admin schema/profile/checkpoint gates remain unchanged.

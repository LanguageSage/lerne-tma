# Game Mode: Stadtbibliothek MVP 2

## Entry points

- UI: `app/src/components/game/GameView.jsx`, `GameView.css`; entry in `DeckGridHeader.jsx`.
- Navigation: `app/src/App.jsx`, `app/src/utils/navigation.js`; client: `app/src/services/gameService.js` through existing authenticated API.
- Routes: `api/routers/game.py`, mounted under `/api/game` in `api/main.py`.
- NPC/scene/catalog: `api/game_config/library.json`; authoritative transitions: `api/services/game_scene.py`.
- AI: `api/services/game_dialogue.py`, existing `configured_ai`/`AIService` and admin provider/model settings.
- Persistence/budgets: `api/services/game_service.py`, `TMAGameAttempt` in `api/models.py`; migration 87: `api/game_migration.py`.

## Contracts and ownership

`GET /game/scene` returns public metadata and `ai_mode` (live/mock/unconfigured/unavailable).
`POST /game/attempts` takes UUID `attempt_id`; retries return the same owned attempt.
`GET /game/attempts/{id}` resumes it. `POST /game/attempts/{id}/turns` takes UUID `request_id`,
current `version`, `action` (message/hint) and at most 1000 message characters. Extra request fields are rejected.
The client cannot submit a catalog, scene, outcome or user ID.

Every endpoint requires strict existing v2 Bearer authentication and every attempt query checks owner.
`X-User-ID` alone is insufficient. This approved MVP is online only; no Game Mode Dexie/outbox is added.
Classic sync, SRS and Knowledge Attempts remain independent.

The model extracts semantic preferences/actions, confidence and a verbatim current-message evidence span.
The server combines explicit preferences across turns, resolves a unique catalog entry, checks availability
and records a loan. Confirmation requires an actual server offer. Low confidence/invented evidence cannot
issue a book. Only the target book yields `success`; another available book yields `other_book`.
Catalog/loan speech uses server facts. AI generates off-topic conversation, gentle catalog-based clarifications
and simpler explanations, without grammatical scoring. NPC data is separate from service logic.

## Persistence and failures

One row stores owner/NPC/situation IDs, server scene, latest 24 messages, outcome, hints/clarifications,
UTC timestamps, previous attempt date, version and retry/budget metadata. No profile fields or keys are stored.
There is no full transcript archive or retention/deletion scheduler yet. Current attempt ID uses account-specific
sessionStorage. Leaving/reloading resumes it; New dialogue starts a clean attempt and links the previous date.

A transactional per-user lock reserves a turn/budget before network I/O. No transaction is held during AI.
A lease prevents simultaneous turns; optimistic versions reject stale updates. Latest completed request ID/hash
can be replayed; older requests are protected by version checks. Failure preserves scene/history, releases the
lease and keeps the input/request ID available for retry.

Limits: 40 turns including hints/attempt, 20 new attempts/day, 120 reserved AI calls/day (UTC), one second
between requests, at most two model calls/turn, one key/transport attempt per call, 25 seconds total AI time,
400 interpretation/250 dialogue output tokens. AI history is at most 12 bounded messages. Failed requests retain
their reserved budget. These are request/token limits, not a monetary budget.

Migration 87 transactionally creates only the new table/indexes and marker; reruns validate required columns.
PostgreSQL enables RLS and revokes PUBLIC/anon/authenticated table access. Existing privileged backend DB
connections check ownership; no Supabase Auth JWT policies are introduced. Startup `create_all_tables` runs it;
explicit command: `python -m api.game_migration`.

## Voice and development

MVP 2 uses `app/src/components/game/useGameVoice.js` for conversation timing, not card grading.
Explicit voice enable requests getUserMedia permission and releases those tracks immediately.
German Web Speech API (SpeechRecognition/webkitSpeechRecognition, de-DE) then listens only after
NPC audio ends, with a 350 ms speaker tail delay. After 1.8 s without new STT results it calls stop(),
waits for onend/final results, and submits through the existing version/request_id dialogue API.
Native browser onend can finish earlier. Interim/empty/non-letter/oversized/low-confidence results
pause for manual review; confidence is never a language or pronunciation grade.

Voice enable is never persisted. Autoplay and automatic sending preferences are local; restored
history does not start audio or the microphone. Turning off automatic sending enables explicit
Finish -> review draft -> Send. Focusing text pauses recording. Repeat plays the actual latest NPC
text without AI cost. TTS reuses `/media/generate-audio`, getAudioUrl and useAudio, cached in this view.
The fixed NPC voice is `npc.tts_voice` in `api/game_config/library.json`, exposed by GET /game/scene;
Frau Müller uses de-DE-KatjaNeural, independently of card voice selection. Existing speed settings
and Bitte langsamer remain respected.

Pause/off, hiding/leaving the view and reset retire recognition callbacks, timers, audio and TTS HTTP
requests. Late results cannot submit or play. useAudio cancels delayed retries/old play promises after
stop. AI failures preserve draft/request_id and pause; resumption is explicit. Watchdogs bound
permission (30 s), STT (45 s), stop finalization (3 s) and TTS/playback. No raw recordings are stored
by Lerne. Some browsers send recognition audio to their own service; UI discloses this before enable.
Browser STT support, live microphone quality, echo and autoplay restrictions need manual verification.

NPC rules/interpretation distinguish topic changes from book preferences; uncertain meaning asks
neutrally for rephrasing. Chat stays free before/after loans and simple_language persists. Catalog,
availability and loans still use authoritative server facts; no new assessment/progress logic is added.

`GAME_MODE_MOCK=1` enables labeled deterministic replies only outside `ENVIRONMENT=production`.
The browser cannot select mock/provider. Live mode uses admin AI_PROVIDER, DEFAULT_MODEL/AI_MODEL and
existing server keys. Manual procedure and limitations: `project_docs/GAME_MODE_MVP2.md`.

## Verification

- Isolated backend: `python -m unittest tests.test_game_mode tests.test_answer_evaluation -q`.
- Browser (fully intercepted API, no external calls): `npx --no-install playwright test scripts/tests/browser/game-mode.spec.cjs scripts/tests/browser/guest-entry.spec.cjs scripts/tests/browser/autoplay-ui.spec.cjs --workers=1`.
- Browser covers success, repeat without a call, hint, reset, TTS failure, AI failure/draft/request replay,
  unconfigured/live states, guest login, restored history, Back, RU/EN/UK and 320/375/430/768/1280px.
- MVP 2: 48 isolated backend tests, 15 browser tests (11 Game, 1 Classic autoplay, 3 guest-entry), full lint/build and Python compilation passed. Voice lifecycle/failure/retry/limit scenarios use fake STT/audio and intercepted API. Full Node suite has 3 pre-existing parser failures reproduced on HEAD. Details/manual verification: `project_docs/GAME_MODE_MVP2.md`. MVP 1 live-model/migration evidence remains in `project_docs/GAME_MODE_MVP1.md`.

## MVP 3: independent memory and communication evidence (not integrated)

- Entry points: `api/game_mvp3/memory.py` (NPCMemoryService), `progress.py`
  (LanguageProgressService), `catalog.py` (server-owned task/skill definitions).
- Storage: `api/game_mvp3/models.py` owns NPCMemory/CommunicationResult, referencing
  existing TMAGameAttempt. No duplicate conversation/attempt store or Classic scoring.
- Migration 88: `api/game_mvp3/migration.py:run_migration(database)`; prepared only,
  explicitly supplied DB, absent from startup/create_all_tables and existing migrations.
  PostgreSQL RLS plus no PUBLIC/anon/authenticated grants; no Supabase Auth policies.
- `api/game_mvp3/router.py` defines Bearer v2 read/delete routes under
  /game-foundation, but is NOT mounted in api.main. Evidence writes are internal only.
- NPC memory uses allowlisted facts/provenance, excludes model guesses from relevant
  context, and supports TTL, revision-safe update, tombstone-safe clear and full deletion.
  It never reads communication skill assessments.
- Progress preserves objective facts separately from model findings. Unknown help/
  modality stays unknown; task outcome alone does not confirm individual skills.
  Comparisons require approved task equivalence, same known difficulty/rubric/language/
  modality, multiple task events and complete assistance tracking. No pronunciation
  inference from STT, response-time grading or visit-based growth.
- There are no hooks in active dialogue/voice, no background processing and no UI changes.
- Safe checks: `python scripts/test_game_mvp3.py` (97 isolated tests: 49 MVP 3,
  48 existing Game/answer evaluation). Runner blocks legacy model DB initialization
  and outbound sockets, allowing Windows asyncio socketpair setup only.
- Full contracts, examples, migration limits and later integration:
  `project_docs/GAME_MODE_MVP3.md`. PostgreSQL/RLS execution remains a pre-integration check.

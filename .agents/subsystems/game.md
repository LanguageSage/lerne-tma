# Game Mode

## B1 exam dialogue (Game Test)

GameView adds separate free-conversation and exam tabs. `POST /game/attempts` accepts
optional `mode` (`neighbor` default, `b1_exam`) and `topic` (required for exam, up to
6000 characters). `b1_planning_v1` uses `api/services/game_exam.py`; Alex is an equal
planning partner, with no corrections during dialogue. One bounded structured AI
call responds using the topic and full attempt history. Agreement can close after
six exchanges; the prompt aims for 8–12, with a safety cap of 16 or 40 requests.
Explicit user goodbye and the existing End button also finish. Voice hook, manual
send and media generation are reused unchanged.

Exam history is retained in full in the existing TMAGameAttempt row; other scenarios
keep their existing retention. No schema migration or SRS/mastery writes. The existing
owner, lease, version, daily budgets and request replay protect all mutations.
After ending, `action=review` generates a provisional Russian `learning_result`
(task completion, grammar/vocabulary with quote-validated user evidence, expressions,
recommendations). Review uses one reserved AI call, increments version but neither
conversation history nor turn count; failure preserves the completed conversation
and supports retry, including at the request cap. The client requests it automatically
after ending and exposes a retry/recovery button on restored unfinished reviews.
`GET /game/exam-attempts` lists the current visitor's latest 20 exam attempt summaries;
the UI can reopen their complete history/results and repeat with the same/edited topic.
Browser storage keeps separate current IDs for neighbor/exam. Clearing visitor storage
loses access to prior anonymous attempts, as with existing Game Test.

The start contract (`mode`, `topic`) is the future lesson-card entry seam; no lesson
integration is implemented. See `project_docs/GAME_MODE_B1_EXAM.md` and
`tests/test_game_exam.py`; browser cases are in `scripts/tests/browser/game-mode.spec.cjs`.

## Neighbor introduction (current default)

New attempts use `api/game_config/neighbor.json`: Frau Müller, 52, a friendly, calm,
slightly curious neighbor. NPC passport, optional goals and 6–10-exchange rules are
configuration data. Existing library rows resume their prior scenario. Public attempt
responses add `scenario` metadata, `ended` and `learning_result`; GameView uses owned
attempt metadata on restore, while GET /game/scene describes the new default.

`api/services/game_conversation.py` owns social state, grounded model observations,
question tracking, closing and provisional results. `game_dialogue.social_turn` uses
the existing provider with two bounded calls (850 interpretation/300 reply tokens,
same 25-second timeout). History (up to 24 messages), quoted explicit user facts,
asked topics/questions support current-conversation memory. Previously asked/already
supplied tagged topics and exact duplicate questions are suppressed except support
requests. Replies remain free AI dialogue; server farewell is deterministic.

Messages count as exchanges; hints do not. After six exchanges, introduction/about
self/question/response observations can initiate closing; at ten closing is mandatory.
Support before ten postpones early closing. The model answers the current turn without
a new question; the server removes remaining question sentences and appends a farewell.
The 40-request limit also produces a farewell. `action=end` needs no AI. Spoken goodbye
requires current-message evidence. Replay stays idempotent; new requests after closing
return 409 game_conversation_ended. Final TTS runs normally, then the ended guard prevents
STT restart; pause timing/manual sending/recognition are unchanged.

Results stay in TMAGameAttempt.scene_state under the existing transaction/version and
owner guards, with no schema change. Goals/errors are quote-validated unconfirmed model
findings, missing goals mean not observed, support is recorded separately. No user level,
verified listening, pronunciation or mastery is inferred. Current profile/settings have
no user German level; learner_level is null (deck levels are not user levels).
The isolated MVP 3 collector skips scenarios without reviewed task rubrics, preserving
its engine-only skill semantics. This is preparation for future assessment, not another
persistence/evaluation service. See `project_docs/GAME_MODE_NEIGHBOR.md` for result fields,
changed files, test commands and manual checks. `tests/test_game_neighbor.py` covers all
requested behavioral cases; browser neighbor fixtures cover speech/manual ending,
final TTS/no STT restart, restore/reset, no-AI finish and RU/EN/UK at 320–1280px.

The following sections describe legacy Stadtbibliothek, preserved for existing attempts.
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
connections check ownership; no Supabase Auth JWT policies are introduced. Startup `create_all_tables` runs it only when migrations are allowed (explicit `RUN_MIGRATIONS=false` always skips DDL);
explicit command: `python -m api.game_migration`.

## Voice and development

MVP 2 uses `app/src/components/game/useGameVoice.js` for conversation timing, not card grading.
Explicit voice enable requests getUserMedia permission and releases those tracks immediately.
German Web Speech API (SpeechRecognition/webkitSpeechRecognition, de-DE) then listens only after
NPC audio ends, with a 350 ms speaker tail delay. Manual completion is the default: pauses never
submit, Finish calls stop(), waits for final results/onend and submits once. Automatic mode uses
a locally saved 2–5 second pause (default 4). Interim/final results and speech start/end update
the pause timer. A native onend/no-speech restarts recognition after 350 ms within the same user
utterance, preserving session result snapshots and the existing pause timer. Repeated cumulative
result events replace their session snapshot, rather than append duplicate fragments. Unresolved
interim/empty/non-letter/oversized/low-confidence results pause for manual review; confidence is
never a language or pronunciation grade. Recognition during restart gaps is not guaranteed.

Voice enable is never persisted. Autoplay and automatic sending preferences are local; restored
history does not start audio or the microphone. Turning off automatic sending enables explicit
Finish -> send (or review draft -> Send for uncertain text). Cancel clears the utterance and pauses;
pause/off preserve its draft. Focusing text pauses recording. Repeat plays the actual latest NPC
text without AI cost. TTS reuses `/media/generate-audio`, getAudioUrl and useAudio, cached in this view.
The fixed NPC voice is `npc.tts_voice` in `api/game_config/library.json`, exposed by GET /game/scene;
Frau Müller uses de-DE-KatjaNeural, independently of card voice selection. Existing speed settings
and Bitte langsamer remain respected.

Pause/off, hiding/leaving the view and reset retire recognition callbacks, timers, audio and TTS HTTP
requests. Late results cannot submit or play. useAudio cancels delayed retries/old play promises after
stop. AI failures preserve draft/request_id and pause; resumption is explicit. Watchdogs bound
permission (30 s), initially empty STT (45 s), stop finalization (3 s) and TTS/playback. After text
arrives the empty watchdog is cancelled; five consecutive empty browser sessions pause instead
of restarting indefinitely. No raw recordings are stored
by Lerne. Some browsers send recognition audio to their own service; UI discloses this before enable.
Browser STT support, live microphone quality, echo and autoplay restrictions need manual verification.

NPC passport (`npc`: identity, knowledge, habits, speech style) is separate from optional
`scene.suggested_topic`; `target_book_id` remains solely the server's outcome criterion. The shared
NPC prompt treats the story as an invitation for every character, allows everyday discussion and
user-initiated returns, and prohibits fabricated world facts and universal-assistant behavior.
Response generation receives simple_language, not unfinished search criteria or outcome pressure.
Book subjects outside the catalog are supported as bounded subject names: no match produces a
deterministic server fact, clears a previous offer and cannot issue a book.
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
- MVP 2 testing fixes: 53 isolated backend tests, 21 browser tests (17 Game, 1 Classic autoplay, 3 guest-entry), full lint/build and Python compilation passed. Voice lifecycle/failure/retry/limit scenarios use fake STT/audio and intercepted API. Full Node suite has 3 pre-existing parser failures reproduced on HEAD. Details/settings/changed files/manual verification: `project_docs/GAME_MODE_MVP2_TESTING_FIXES.md`; original MVP 2: `project_docs/GAME_MODE_MVP2.md`. MVP 1 live-model/migration evidence remains in `project_docs/GAME_MODE_MVP1.md`.

## MVP 3 integration preparation (isolated, disabled by default)

`api/game_mvp3/` contains the memory/progress foundation and a shadow collector.
`begin_capture` runs only on NEW opted-in attempts; `capture_turn` runs inside the
same transaction as `game_service.finish_turn`. Completed engine events are stored
with owner, attempt, request ID and version. No STT success, transcript length or
model finding becomes a skill. Only a real `borrowed` transition registers the
immutable task result. Social dialogue may continue after that boundary.

Migration 88 explicitly adds `NPCMemory`, `CommunicationResult`, `GameCapture`,
`GameInteraction`; no startup migration is added. Capture marks eligibility and
retains a non-content erasure barrier. Interaction stores bounded engine facts,
book IDs and support codes, not utterances/audio. Existing marker 88 with a different
table set fails closed. FK/CASCADE, primary/unique constraints and private RLS/grants
are validated; PostgreSQL execution is still a blocker in this environment.

Pilot requires all of `GAME_MVP3_ISOLATED=1`, `GAME_MVP3_ENABLED=1`, exactly one
`GAME_MVP3_TEST_USER_ID`, and a non-production environment. Defaults are disabled.
Game API/response, scene, dialogue prompt, GameView, voice/STT/TTS are unchanged.
NPC context is prepared via `relevant()` but not sent to the active NPC prompt.
Task IDs identify the library objective; chat is not proof of task performance.
Observed help IDs refer to real hint/simplify/slow/repeat requests. Missing modality,
translations and other help stay unknown; support tracking remains incomplete.
Observed help yields `with_help`, otherwise independence is unknown; no skills are
emitted by the collector. Comparisons cannot claim improvement from these snapshots.

`/api/game-foundation` is mounted only in isolated mode; all read/delete endpoints
require strict v2 Bearer, the pilot flag/account, and ownership. Added endpoints:
GET `/attempts/{id}/events`, DELETE `/data?include_source_attempts=false`.
Data erasure removes memory/results/events and prevents collection on old erased
attempts; `include_source_attempts=true` also removes attempts and capture barriers.
Account deletion erases all Game data even with flags off and now requires strict
Bearer (legacy X-User-ID alone rejected). Deletion uses the same user lock and
transaction/connection as the engine; nested services never close an outer connection.

Protected tests: `python scripts/test_game_mvp3.py` (132 tests, disposable SQLite,
no dotenv/production DB/AI/network). PostgreSQL probe:
`python scripts/test_game_mvp3_postgres.py` requires an explicit local disposable DB,
rolls back all schema/data writes and currently reports missing environment.
Safer local API pilot: `scripts/run_game_mvp3_pilot.py`; suppresses legacy startup,
requires an explicit test DSN, uses mock dialogue, exposes no media/Classic routes.
Its `--prepare-schema` applies 88 only to the explicitly validated test DB; `--check`
does not start a server. Full procedure and limitations:
`project_docs/GAME_MODE_MVP3_INTEGRATION.md`.

## Public Game Test preparation (2026-10-15)

`project_docs/reports/GAME_TEST_FIRST_LAUNCH.md` records the isolated Supabase/Vercel preparation and remaining first-launch requirements. `scripts/prepare_game_test.py` bootstraps only the pinned empty test project from canonical models and legacy migrations; never rerun it on the prepared schema. Auth 76–79 and Game/MVP3 87–88 are prepared; MVP3 capture remains disabled. The initial authenticated release is superseded by the standalone no-login entry below. The exact test database and no startup DDL remain required. Public API errors omit internal exceptions. The first public deployment remains subject to separate owner authorization.

## Standalone Game Test without login
Game Test starts GameView directly. No SSO, login, registration or account API is mounted. api/index.py selects api/game_test.py only for LERNE_DEPLOYMENT=game-test; it reuses game routes and speech media. A browser-local negative visitor ID groups attempts in the isolated test DB without creating TMAUser or Auth v2 sessions. Clearing browser storage starts a new visitor; no cross-device progress or Lerne account linking exists. The integrated Lerne deployment retains its existing strict account dependency. Main Production is not modified by this release.

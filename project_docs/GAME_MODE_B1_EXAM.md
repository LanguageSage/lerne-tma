# Game Test: B1 exam dialogue

Implemented in the existing `game-mode` worktree (`scratch/game-no-login`).
`git worktree list` confirms the main checkout remains on `main`; `scratch/` is
ignored by Git. This is a linked worktree sharing the repository, not an independent
clone. No branch creation, commit, push, database migration or deployment is needed
for these local changes.

## Test flow

1. Open Game Test, select **Экзаменационный диалог**.
2. Paste the situation and all planning points from a PDF as text (up to 6000 characters).
3. Start and converse in German. Alex contributes proposals, alternatives, reasoned
   disagreement and compromises using the configured Game AI provider. There is no
   grammar feedback during dialogue. Existing manual send, voice finish, automatic
   pause setting, repeat and TTS controls are reused.
4. The partner aims for 8–12 exchanges. Agreement after six may close naturally;
   sixteen exchanges/forty requests are safety bounds. The learner may end at any time.
5. After completion a separate AI request creates a Russian review. It covers the task,
   learner participation, errors, grammar, vocabulary, useful expressions and advice.
   It is provisional text-based feedback, not an official exam result. Pronunciation,
   listening and learner level are not assessed. Quoted error evidence must occur in
   learner messages; partner and hint messages cannot supply that evidence.
6. If review generation fails, the completed conversation stays saved. **Получить разбор**
   retries; reloading also exposes this button. **Пройти ещё раз** creates a clean attempt
   using the same or edited topic. **Сохранённые попытки** opens the latest 20 attempts,
   including complete history/results. Free conversation with Frau Müller remains separate.

## Implementation and future entry

`api/services/game_exam.py` owns the exam prompt, bounded dialogue state and review
schema. `game_service.py` retains its transaction, owner, budget, lease and replay
mechanisms. Exam history and result use existing text/JSON columns; no new table or
schema migration. Exam dialogue reserves two calls conservatively but uses one;
review reserves one and does not consume a conversation turn. Review timeout is 25s,
same as Game dialogue; output limits are 650/3200 tokens for partner/review.

New start request: `{attempt_id, mode: "b1_exam", topic: "..."}`. Existing callers
without mode still start the neighbor scenario. This contract provides the seam for
a later last-lesson-card launch; no lesson, Classic, sync or mastery integration exists.
`action: "review"` is allowed only for ended exam attempts; results are idempotent.
`GET /api/game/exam-attempts` returns owned summaries only. Visitor identity remains
local to the browser; clearing browser storage loses access to earlier anonymous attempts.

## Verification

- `python -m unittest tests.test_game_exam tests.test_game_neighbor tests.test_game_mode -q`
- `python -m py_compile api/routers/game.py api/services/game_scene.py api/services/game_exam.py api/services/game_dialogue.py api/services/game_service.py tests/test_game_exam.py`
- From `app/`: `npx --no-install eslint src/components/game/GameView.jsx src/services/gameService.js`
- From `app/`: `npm run build`
- `npx --no-install playwright test scripts/tests/browser/game-mode.spec.cjs --workers=1`

Backend tests use disposable SQLite and mocked providers. Browser tests intercept API,
AI and media, block nonlocal requests and fake microphone/audio. They cover topic start,
manual send, archive, reset, review failure/replay, final TTS and no microphone restart;
screenshots cover 320/375/430/768/1280px. Live-provider conversational quality, real
microphone quality and actual device playback still need a test-deployment smoke run.
No Production services or database are changed by these checks.

Final local results (2026-10-19): **61 backend tests, 29 browser tests passed**;
targeted ESLint, Python compilation and final Vite build passed. Exam layouts were
exercised at 320/375/430/768/1280px in RU/EN/UK; Russian result screenshots were
visually reviewed on phone and desktop. The initial broader browser run had one
page-load failure; its isolated rerun and the final complete 29-test run passed.
The three new exam browser cases passed, including review retry and final TTS.
The local version is ready for a test deployment and a live-provider/device smoke
test; no deployment, commit or push was performed.

# Game Test without login

Open https://lerne-game-test.vercel.app/ and the conversation starts directly. There is no login, registration, Lerne redirect or profile screen. Text works immediately; voice asks only for browser microphone permission.

The frontend entry contains GameView, language choice and feedback. gameService uses a local visitor ID and an HTTP client without access/refresh tokens. A random negative browser-local ID groups conversations in the test DB, without a TMAUser or Auth v2 account/session. Reload and reopening in the same browser preserve the conversation. Clearing site storage or using another browser starts a new visitor. Previous account progress is not linked automatically.

LERNE_DEPLOYMENT=game-test selects api/game_test.py. It reuses game routes, POST /api/media/generate-audio and GET /api/media/audio/{filename}. No account or Classic APIs are mounted. The DB is still pinned to rkkviifehykdeugovlgp and RUN_MIGRATIONS=false. No migration/data deletion is needed. SSO variables are unused. The integrated Lerne deployment retains its existing strict account dependency.

Removed SSO implementation, callbacks, provider additions, migration script and SSO-only tests/docs from Game sources. Ordinary shared Lerne authentication code is retained for Lerne, and is absent from the Game frontend bundle.

Verified: 49 isolated backend tests, 26 intercepted browser tests, targeted ESLint and production build. Browser tests cover empty storage/no tokens, direct entry, no auth requests, messages, errors/retry, hints, ending, reset, reload, mobile Array compatibility, fake speech/audio lifecycle, RU/EN/UK at 320-1280px. External DB/AI/TTS are blocked in automated tests. Actual Android microphone recognition depends on the device/browser.

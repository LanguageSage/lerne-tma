# Lerne SSO release — 2026-10-19

Status: both stable domains are published and READY. Migration 89 was explicitly
approved by the user and applied only to Game Test `rkkviifehykdeugovlgp`.

## Source and recovery

- Previous stable main deployment: `dpl_CKextdmoXMcVRh6wNnw7jHBfFHxw`,
  base `1063d67f3e726102891e5b700e9e546c05121078`.
- Previous stable Game Test deployment: `dpl_DSR5v5LnzZkhnRWrb9LkQ8KEkQrF`,
  base `68eea853101438333f1a15b0ec93591578541c3a`.
- SSO files were preserved in `stash@{0}` (`c62b111`), not main. They were restored
  selectively to game-mode, preserving the stash and excluding unrelated Quiz work.
- Issuer is built from the currently published main source plus only the SSO
  confirmation endpoints, consent component, config loader, translations and
  cryptography dependency. Existing main auth service, provider checks and session
  flows were retained. Reproducible source delta: [issuer patch](lerne-sso-issuer.patch).
- Game client uses restored game-mode SSO source. No SSO commit or push was made.

## Published deployments

| Project | Deployment | URL |
| --- | --- | --- |
| Main issuer | `dpl_F6goUxBfHpViX2G1epH6uDAYNNm5` | https://tma-b9h4ku3fn-u6141216213-maxs-projects.vercel.app |
| Game client | `dpl_HJwbs5dXEB9nVbx4V4xGc9D2VUjy` | https://lerne-game-test-rkl0rw0to-u6141216213-maxs-projects.vercel.app |

Both used Production Vercel environment with `--skip-domain`, then were promoted
to `https://tma-amber.vercel.app` and `https://lerne-game-test.vercel.app`.
This is a CLI source
release; git metadata reflects the enclosing working tree. The explicit
`lerneBaseCommit` and `lerneRelease` deployment metadata identify the actual base
and role. The uploaded issuer source tree was checked: it contains no GameView or
game_mvp3 files; its vercel.json SHA1 matches the main staging source.

SSO origins and roles are configured. A new signing key was generated and stored
as a sensitive Production variable only on main; Game has only the public key.
No key material is included here. Both use VITE_API_URL=/api and RUN_MIGRATIONS=false.
Main DB schema has not been changed.

## Checks actually performed

- 61 isolated backend tests passed, including the final /api/init regression.
- 28 client auth regression tests passed.
- 2 local browser scenarios passed, including stable local identity, reload,
  explicit consent, cancellation, invalid requests and mobile/desktop layouts.
  First run exceeded the overall 30-second timeout while other full checks ran;
  a rerun with 60-second test timeout passed both (13.1s and 8.1s) without changes
  to assertions or product code.
- Main issuer and Game lint/build passed. Build warnings concern existing chunk
  size and ineffective dynamic imports.
- Staged server checks: each returns its correct public SSO role/origins;
  anonymous POST confirmation returns 401; Game callback is isolated HTML with
  CSP, HTTP 200, Cache-Control no-store and Referrer-Policy no-referrer.
- Before migration, Game had 0 identities, 6 challenges, 4 user rows. Its two
  provider CHECK definitions allow only telegram/google. Migration 89 is absent.
- Hosted browser round trip completed with an existing main browser session:
  Game → Lerne → explicit confirmation → Game. No password was entered or copied.
  One local `lerne` identity was created. Session survived reload and opening a
  second tab, and the normal test profile was visible without the guest banner.
- Real /api/init initially overrode nameless authenticated accounts with guest
  status based on missing display name. Fixed api/main.py to use stored is_guest;
  the final Game deployment includes this correction. The new regression executes
  the actual init handler against a disposable SSO account without provider startup.
- Both stable domains return correct SSO roles. Callback and anonymous-confirmation
  checks pass. Main and final Game error-log scans returned zero error entries.
- Additional hosted logout/repeat was not completed: automatic review declined
  resetting the user's test session. The browser's confirm dialog remained open;
  attempts to dismiss it hit the browser tool's focus timeout. No reset was accepted.
  Repeat identity/reload behavior passed the isolated browser and backend tests.

## Database verification and recovery

Migration 89 is recorded and both provider checks include lerne. Counts immediately
before/after the migration were identical (0 identities, 6 challenges, 4 user rows).
Subsequent authorized smoke checks created SSO challenges and the first local test
identity. Main DB schema was not migrated. To disable SSO, unset the role or roll
back the deployment; retain the expanded checks and linked identities. Source
changes remain uncommitted; preserve/review the issuer patch when integrating
them into main so future deployments retain SSO.

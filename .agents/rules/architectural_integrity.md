# Rule: Architectural Integrity & Verification Standards (Lerne TMA)

## 1. Zero Verification Tax Policy
- Every generated code block must be validated by running concrete verification commands (e.g., `npm --prefix app run lint`, Vite build checks, FastAPI endpoint checks).
- Agents must inspect execution logs completely before reporting success.
- If a build or test fails, diagnose the root cause instead of suppressing errors.

## 2. Context Engineering
- Limit token bloat by focusing strictly on relevant files and direct dependencies in `/app` or `/api`.
- Read exact symbol definitions (FastAPI routes, Pydantic schemas, Zustand stores) rather than relying on high-level assumptions.

## 3. Offline & Sync Safeguards
- TMA operates both online and offline (backed by Dexie.js in `/app` and `offlineApi.js`).
- Never break offline fallback compatibility when introducing new API endpoints or data sync logic.

## 4. Safety Guardrails & Human-in-the-loop
- Destructive DB operations (altering Supabase tables, dropping indexes) require explicit human confirmation.

## 5. Media Resolution & UI Resilience Standards
- **Normalized Fallbacks**: Any code dealing with card media must use the canonical cascade: `card.image_url || card.media_url || card.image_path || card.image` (converting relative paths to `/api/media/images/<filename>`). Never assume `image_url` is pre-populated, especially when cards are loaded from Dexie, fast-path navigation, or raw records.
- **No Raw Broken Images**: Never render raw `<img src={imageUrl} />` directly without error handling in study components. Always use `StudyCardImage` which encapsulates auto-retry with cache-busting, loading skeleton, and fallback with a reload button.
- **DB Liveness in Media Endpoints**: All FastAPI endpoints serving media (`/api/media/images/`, `/api/media/audio/`) must include DB reconnect resilience to guard against dropped connections on Supabase/PostgreSQL.

## 6. Scroll Position & Navigation Context Preservation Standards (CRITICAL INVARIANT)
- **Zero Scroll Reset on Detail Navigation**: When a user scrolls to any item in a list (e.g. `CardList`, `DuplicateManager`), opens it into detail/study/editor view, and navigates back (via back button, Telegram BackButton, or gesture), the UI **MUST NEVER reset to the top of the list**.
- **Pagination / Lazy-List Safeguard (`visibleCount`)**: If a list uses progressive pagination (`visibleCount`), returning to the list **MUST NEVER truncate items before the target card**. `visibleCount` must adapt to `lastSelectedCardId` and `cardsScrollTop` so the selected item is guaranteed to exist in the rendered DOM.
- **Scroll Listener Protection (`isRestoringScrollRef`)**: During scroll restoration and initial layout calculation (double `requestAnimationFrame`), the scroll event listener must be muted to prevent premature overwriting of `cardsScrollTop` with 0 or clamped heights.
- **Strict Prohibition**: Never remove, bypass, or delete `lastSelectedCardId` / `cardsScrollTop` handling in `CardList.jsx`, `App.jsx`, or `navigation.js` during refactoring or performance passes.

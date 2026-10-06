# Rule: Architectural Integrity & Verification Standards (Lerne TMA)

## 1. Verification proportional to the change
- Use [verification guidance](../skills/ai-harness-eval/SKILL.md): start with behavior checks and static checks for the affected files; broaden for shared infrastructure, configuration/dependencies, significant cross-subsystem changes, wider failure evidence, or user/CI requirements.
- Documentation-only changes require content, link, path and diff checks; changed skills also require skill validation. Application builds are unnecessary for these edits.
- Inspect relevant execution output before reporting success. A targeted pass does not establish that the entire application passed.
- If a check fails, diagnose the root cause instead of suppressing errors; distinguish existing failures without discarding user changes.

## 2. Context Engineering
- Use [AGENT_INDEX](../AGENT_INDEX.md) and the relevant subsystem document for a new area; continue directly with known files when the current task already identified them.
- Search the subsystem first, then read matching definitions, callers and contracts. Expand to direct dependencies or repository-wide search when evidence requires it.
- Reuse known paths and inspect diffs after edits; do not repeat broad searches or full-file reads without a new reason.
- Detailed navigation and verification policy lives in [AGENTS.md](../AGENTS.md).

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

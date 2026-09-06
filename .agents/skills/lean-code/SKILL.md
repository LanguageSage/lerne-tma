---
name: lean-code
description: Reuse existing Lerne TMA modules and keep feature changes and refactoring focused, with clear state ownership and minimal abstractions.
---

# Lean code for Lerne TMA

## Find the existing owner

Use `rg` and `rg --files` to find behavior and callers before adding components, helpers, actions, or endpoints. Read implementations rather than inferring contracts from filenames.

- `app/src/components/common/`: shared controls including CardForm, SearchBar, Toast, and ErrorBoundary.
- `app/src/store/` and `slices/`: shared application state and actions.
- `app/src/services/api.js`: authenticated API access; `offlineApi.js`, `localDb.js`, and `syncService.js`: offline storage and sync; `mediaCache.js`: media caching.
- `app/src/i18n/i18nContext.jsx`: interface language. `app/src/store/useLanguageStore.js`: learning language. These are different concepts.
- `api/routers/`, `api/services/`, `api/models.py`, `api/database.py`: routes, business logic, models, and connection setup.

## Keep responsibilities clear

- Reuse modules when their behavior and responsibility fit. Two similar fragments invite comparison, not automatic extraction.
- Extract shared logic when it represents the same rule and should change together. Avoid wrappers more complex than the duplication they remove.
- Keep shared entities in their owning store and derive values when possible. Local form drafts and temporary UI state are valid local state.
- Route authenticated application requests through the existing API service to preserve authentication, error handling, and offline behavior.
- Keep domain rules consistent across callers. A simple router query does not require a new service solely for layering.
## Architecture map maintenance

- Whenever introducing a new feature module, store slice, API router/service, or DB model, or when changing architectural boundaries, update `.agents/ARCHITECTURE.md` to reflect the new files and data flow in the Intent-to-Code Matrix.

Review the diff for scope expansion and duplicate sources of truth. For code changes, use [verification guidance](../ai-harness-eval/SKILL.md).

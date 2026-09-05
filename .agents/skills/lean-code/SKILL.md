---
name: lean-code
description: Essential guidelines and codebase map for eliminating code duplication, writing minimal lean code, and maximizing reuse of existing React/Zustand/FastAPI modules in Lerne TMA.
---

# Lean Code & Code Deduplication Skill (Lerne TMA)

Use this skill whenever creating new features, adding UI components, creating endpoints, or conducting refactoring to prevent duplicate code, reduce boilerplate, and enforce radical minimalism.

---

## 1. Core Rule: Reconnaissance Before Code (Search-First)

**Never write a helper function, modal, button, audio utility, or endpoint from scratch without searching the codebase first.**

### Quick Pre-Check Commands
Before creating new logic, run targeted searches:
- Search existing UI components: `find_by_name(Pattern="*.jsx", SearchDirectory=".../app/src/components")`
- Search existing store actions: `grep_search(Query="<action_or_state>", SearchPath=".../app/src/store")`
- Search existing services: `grep_search(Query="<func_name>", SearchPath=".../app/src/services")`
- Search existing backend routes: `grep_search(Query="<path_or_feature>", SearchPath=".../api/routers")`

---

## 2. Codebase Reuse Map (Lerne TMA)

### Frontend Shared Components (`/app/src/components/common/`)
Always reuse these instead of creating local duplicates:
- `Loader.jsx`: Standard app spinner / loading indicator.
- `SearchBar.jsx`: Search input with reset and debounce.
- `UserBadge.jsx`: Telegram user avatar and level badge.
- `CardForm.jsx`: Standard card edit/create form.
- `CardLevelBadge.jsx`: SRS repetition level indicator.
- `DeckAudioPlayer.jsx`: Audio playback for words/decks.
- `Toast.jsx`: Standard toast alert.
- `SplitButton.jsx`: Action button with secondary dropdown.
- `ErrorBoundary.jsx`: Top-level and section crash protection.
- `ConfettiBurst.jsx`: Reward/celebration animation.

### Frontend State Management (`/app/src/store/`)
Do **not** create local `useState` copies of data that already lives in global stores:
- `useDeckStore.js` / `slices/`: Decks, cards, card operations (CRUD, SRS ratings).
- `useUiStore.js`: Active screens, views, modals, theme toggles, search queries.
- `useSettingsStore.js`: User preferences, audio voices, learning settings.
- `useLidStore.js`: Leitner / Lid folder categories and assignments.
- `useLanguageStore.js`: Target and interface languages.
- `useSessionStore.js`: Current study session stats and progress.

### Frontend Services (`/app/src/services/`)
- `api.js`: All authenticated REST calls to `/api`. Never use raw `fetch()` or `axios` in components.
- `offlineApi.js`: Dexie-backed fallback when offline or in standalone mode.
- `localDb.js`: IndexedDB tables schema (`decks`, `cards`, `syncQueue`).
- `syncService.js`: Offline-to-cloud bidirectional synchronization.
- `mediaCache.js`: Local caching for TTS audio and card images.

### Backend Structure (`/api/`)
- `routers/`: Grouped API endpoints (`cards.py`, `decks.py`, `auth.py`, `stats.py`, etc.).
- `models.py`: Peewee database tables. Do not duplicate fields or define ad-hoc ORM queries inside routers.
- `services/`: Core business logic (AI generation, SRS algorithm, speech synthesis).
- `database.py`: DB connection lifecycle and pooling.

---

## 3. Strict Deduplication Rules

1. **Rule of Three (Extract at 2)**:
   - If identical or near-identical JSX layout, CSS styles, or helper functions appear in 2 places, extract them immediately into `app/src/components/common/` or `app/src/utils/`.
   - Never copy-paste an existing component into a new file with minor modifications. Parameterize the existing component with props instead.

2. **No Redundant State (Single Source of Truth)**:
   - If a card list or user setting is stored in Zustand, read it via `useDeckStore(state => state.cards)` or selectors. Never duplicate it into local `useState([cards])`.
   - Keep state derived: calculate values on the fly (`const activeCards = cards.filter(...)`) rather than maintaining synchronized secondary state.

3. **YAGNI & Minimal Diff**:
   - Write only what is needed for the requested feature.
   - Do not add speculative wrapper functions, dummy interfaces, or unused options.
   - Favor small, surgical edits in existing files over creating new files.

---

## 4. Self-Review Checklist (Before Finishing Any Task)

Before reporting completion to the user, verify:
- [ ] Did I create any helper or component that already existed?
- [ ] Did I copy-paste CSS classes or JSX blocks that could be shared?
- [ ] Are all API calls routed through `services/api.js`?
- [ ] Did I remove all unused imports, dead variables, and `console.log` statements?
- [ ] Is the diff as small and clean as possible?

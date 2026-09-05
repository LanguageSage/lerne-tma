---
name: tma-ui
description: UI/UX design patterns, mobile viewport rules, Telegram Mini App integration, and Framer Motion animation guidelines for Lerne TMA frontend.
---

# Telegram Mini App UI/UX Skill (Lerne TMA)

Use this skill when developing, refactoring, or polishing user interfaces, animations, and styles in `/app`.

---

## 1. Telegram Mini App Environment & Viewport
- **Safe Areas & Viewport**: Always respect mobile Telegram header, bottom navigation safe areas, and dynamic viewport heights (`100dvh` / `tg-viewport`).
- **Telegram Native Components**: Coordinate with Telegram WebApp MainButton, BackButton, and HapticFeedback where applicable.
- **Touch-Friendly Target Sizes**: Ensure interactive buttons and card tap zones are at least 44x44px with immediate visual feedback (`:active` states, subtle scale).

---

## 2. Visual Hierarchy & Theme
- **Color Palette & Dark Mode**: Respect Telegram theme variables (`var(--tg-theme-bg-color)`, `var(--tg-theme-text-color)`) with vibrant accent colors for decks and levels.
- **High Contrast**: Ensure clear readability of language learning text, transcriptions, and translation cards.
- **Icons**: Use `lucide-react` consistently across all buttons and headers. Keep icon sizes uniform (`16px`, `20px`, `24px`).

---

## 3. Motion & Micro-Interactions
- **Framer Motion**: Use `framer-motion` for study view card flips, swipe gestures, modal slide-ins, and completion overlays (`AnimatePresence`).
- **Performance**: Animate only `transform` and `opacity` to maintain smooth 60fps animations on mobile devices. Avoid animating `height` or `margin` directly.

---

## 4. Component Structure & State
- **Transient vs Global State**: Keep ephemeral UI state (dropdown open, input focus, hover) in local React `useState`. Route global navigation and active modals through `useUiStore`.
- **Modals**: Keep modal dialogs modular and lazy-load heavy sub-screens if necessary.

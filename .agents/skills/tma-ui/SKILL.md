---
name: tma-ui
description: Build Lerne TMA React interfaces with Telegram viewport integration, accessible controls, localized text, and complete interaction states.
---

# Lerne TMA interface

## Application environment

- Follow the existing visual system, shared components, Telegram theme variables, and lucide-react icon conventions.
- Respect safe areas, dynamic viewport height, the on-screen keyboard, and bottom navigation. Check affected screens at narrow mobile widths.
- Coordinate Telegram MainButton, BackButton, and haptics with existing handlers and cleanup. Preserve standalone behavior where supported.
- Keep transient state local and shared navigation or entities in their owning store. Read [reuse guidance](../lean-code/SKILL.md) when changing boundaries.
- When adding a new major view, feature directory under `components/`, or new store slice, record it in `.agents/ARCHITECTURE.md`.

## Complete interactions

- Handle loading, empty results, failure, success, and retry where applicable. Prevent unintended duplicate submissions and retain useful input on failure.
- Use semantic controls and accessible names, including icon buttons. Support keyboard navigation, visible focus, modal focus management, and readable contrast.
- Aim for touch targets of at least 44 by 44 CSS pixels. Check long labels, larger text, and overflow across affected languages.
- Route new interface text through the existing translation mechanism, including toasts, errors, placeholders, and accessible labels. Preserve interpolation parameters.
- Distinguish interface language, learning language, and user content. Do not translate user content as interface copy.
- Give missing translations and failed requests deliberate fallback behavior. Hiding a crash with an error boundary does not fix its cause.

## Motion and verification

Use existing Framer Motion patterns when useful. Prefer transform and opacity; assess layout animation costs when needed instead of prohibiting them universally. Respect reduced-motion preferences and avoid making operation completion depend on animation.

Use [verification guidance](../ai-harness-eval/SKILL.md). Inspect changed layouts and interaction states when a runnable environment is available; report what was not exercised.

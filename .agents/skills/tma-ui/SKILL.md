---
name: tma-ui
description: Design, build, review, and polish Lerne React Web interfaces. Use for every task creating or changing visible UI, layout, styling, controls, modals, settings, responsive behavior, or interaction states.
---

# Lerne React Web UI

Use this skill for any task that changes what the user sees or interacts with in the Lerne web application.

A UI task is complete only when:
- Functionality is verified and works end-to-end;
- Visual hierarchy and spacing rhythm are deliberate and clean;
- Mobile (320px–430px) and desktop layouts render without overflow or broken controls;
- All interaction states (loading, empty, error, disabled, retry) are handled;
- User appearance customizations are preserved without hardcoded CSS overrides;
- A mandatory post-implementation visual review has been performed.

---

## 1. Reconnaissance & Intentional Design

- Inspect parent containers, neighboring screens, CSS modules, and shared components (`app/src/components/common/`) before writing JSX.
- Identify the primary visual purpose, primary user action, secondary actions, and responsive layout behavior before making edits.
- Avoid "box inside box inside box" syndrome. Group controls using spacing scale rather than adding redundant cards, containers, badges, or borders.

## 2. Visual Hierarchy, Spacing & Typography

- **Hierarchy**: One clear primary action per visual area. Secondary and destructive actions must be visually distinct and non-competing.
- **Spacing Scale**: Maintain consistent spacing rhythm (`4px`, `8px`, `12px`, `16px`, `24px`, `32px`). Related elements must sit closer than unrelated elements.
- **Typography**: Use established text roles (page title, section title, body, label, meta). Ensure readability across longer German, Russian, Ukrainian, and English strings.
- **Effects & Accent**: Use color semantically. Avoid gratuitous gradients, heavy drop shadows, glowing borders, or translucent blur containers unless supporting the existing design language.

## 3. Preserve User Customization (Strict Rule)

Lerne allows users to configure extensive visual card appearances (fonts, colors, background, side visibility, markers).
- **Never introduce hardcoded CSS/inline styles** that silently override user-configured card properties.
- Ensure preview components and real study mode cards share identical visual rendering logic.

## 4. Complete Interaction States & Responsive Layout

- **Interaction States**: Implement default, hover, focus, pressed, selected, disabled, loading, empty, success, error, and retry states. Retain useful user inputs on failure.
- **Responsive Widths**: Test layouts across `320px`, `375px`, `430px`, tablet, and desktop viewports. Ensure no horizontal overflow, readable long text, and reachable touch targets (minimum 44×44 CSS pixels on touch devices).
- **Modals & Settings**: Organise large settings by user mental model (`category → subsection → setting`). Use full-screen dialogs or side panels for complex workflows. Provide live previews for visual settings.

## 5. System Consistency, Motion & Localization

- Search existing UI controls (buttons, modals, inputs, tabs, badges) before creating new primitives.
- Route all user-facing text through the existing translation system (`app/src/utils/i18n.js`).
- Use Framer Motion for state changes; respect `prefers-reduced-motion` and never block user action on animation completion.

## 6. Mandatory Visual Review

Before marking any UI task complete, perform an explicit self-review as a UI designer:
1. Is the visual hierarchy immediately obvious?
2. Are margins and paddings rhythmic, or do they look arbitrary?
3. Are there unnecessary borders, containers, or competing buttons?
4. Does long or translated text overflow or break layout?
5. Does the result look intentionally designed rather than merely assembled from controls?

*If the screen looks assembled, polish and simplify before reporting completion.*

---

## Verification

Use [verification guidance](../ai-harness-eval/SKILL.md). Run `npm --prefix app run lint` for any UI edits. Report what layout sizes and interaction states were visually tested.

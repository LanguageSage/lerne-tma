---
name: tma-ui
description: Design, implement, review and visually verify the current Lerne Classic React UI. Use for visible UI, study screens, controls, responsive layouts, accessibility, styling, animations and interaction states.
---

# Lerne Classic UI

This skill covers **only the existing Lerne Classic interface**. Its visual direction is modern, clear, focused and moderately playful, suitable for adult learners. Preserve and improve this language; do not replace it with a different product aesthetic unless the task explicitly requests a redesign.

UI work is complete only when behavior is correct, visual hierarchy is intentional, user customization is preserved, affected viewport sizes and states have been checked, and evidence/limitations are reported.

## 1. Scope and reconnaissance

- Use [AGENT_INDEX](../../AGENT_INDEX.md) to locate the affected subsystem. Inspect the component, its CSS, parent layout, relevant stores, neighboring controls and existing shared primitives before editing.
- For substantial UI work, write a short internal specification: **screen purpose → main content → primary action → secondary actions → applicable states → mobile layout**. For small fixes, proceed directly after focused inspection.
- Improve the *existing* flow rather than adding new screens, menus, buttons or decorative elements without a concrete user need. Avoid nested-card and `!important` accumulation.
- Preserve navigation context, focus, scroll restoration, draft input and existing keyboard shortcuts. Do not broaden visual tasks into unrelated behavior or architecture changes.

## 2. Visual system and user customization

- The project source of truth is `app/src/design/designConfig.js`, `app/src/design/designTokens.js` and existing card-style helpers. Check actual usage before relying on a token; do not introduce a competing theme system.
- Distinguish app chrome from learner-configurable card fonts, colors, backgrounds, dimensions, alignment, markers, front/back behavior and exercise feedback. Never override these via unconditional inline styles or CSS `!important`.
- Keep admin draft styling preview-scoped; only the published design is applied to the real app. Check that previews and actual study cards render consistently.
- Use an intentional hierarchy: learning content is visually dominant; one clear primary action per area; secondary/destructive actions do not compete. Reuse the established spacing rhythm (typically `4/8/12/16/24/32px`), semantic colors, typography roles and existing controls.
- Avoid arbitrary new color palettes, competing glows, permanent pulsing buttons and heavy glass/blur effects unless they serve a defined interaction.

## 3. Study-specific UI

- Prioritize readability and answer input over decoration. Keep card switching, answer evaluation, audio, pronunciation, grading and Next/Back unobstructed and responsive.
- When asked to design an **entry / preparation screen**, use only verified deck metadata and explicit author-provided objectives; label duration as an estimate. If recommendations, progress position or metrics are not yet available, use the requested placeholder rather than inventing a rule or integrating new services.
- When asked to design a **completion / results screen**, distinguish *session completed*, *answer correctness*, *self-reported SRS grade* and *long-term mastery*. Never compute or display a mastery percentage from card count or grade alone. Keep existing completion navigation intact; a visual placeholder must stay disconnected until separately authorized.
- Ordinary decks and guided course decks may share the same screen with optional fields; do not force empty sections or invent different flows without a requirement.
- Before altering study behavior, follow [study subsystem](../../subsystems/study.md). Do not change SRS/knowledge, permissions or offline behavior as a side effect of UI polish.

## 4. Motion and visual feedback

- Motion should clarify a state, give short feedback or preserve spatial continuity. Use CSS transitions for small effects and existing Framer Motion where appropriate; neither is required for every change.
- Favor opacity and transform. Avoid continuous attention-seeking animations, unnecessary 3D, large asset downloads, excessive CPU/GPU work and animation that delays answering, grading or navigation.
- Support `prefers-reduced-motion`; success/errors must still be communicated without motion or sound. Never depend only on animation or color to communicate a result.
- If substantial animation is explicitly requested, specify start/stop triggers, interruption, duration, fallback and performance constraints **before implementation**.

## 5. Responsive, accessibility and localization

- Check affected layouts at relevant widths around **320, 375, 430px, tablet and desktop**. Prevent horizontal overflow; ensure long DE/RU/UK/EN text wraps, dialogs fit, controls remain reachable and sticky/fixed elements do not cover content or collide with keyboard/safe areas.
- Aim for at least `44×44 CSS px` usable touch targets on touch devices; provide keyboard access, visible focus, semantic controls, accessible names and appropriate modal focus management.
- Verify applicable default, selected, pressed, disabled, loading, empty, error, retry and success states. Prevent duplicate submissions and preserve useful input after recoverable errors.
- Use the **actual** localization APIs: `tr` from `app/src/i18n/locale` and `useTranslation` from `app/src/i18n/i18nContext.jsx`. Preserve interpolation; keep UI locale separate from learning language and user-authored card text.

## 6. Visual review and verification

- Inspect the **rendered UI**, not only JSX/CSS. Check hierarchy, spacing, contrast, typography, control density, long strings, keyboard focus, relevant user customization and neighboring surfaces.
- For substantial visual changes, compare before/after screenshots at matched viewport and state where a browser is available. A Figma mockup is optional for major design work; it does not replace checking the running application.
- Follow [verification guidance](../ai-harness-eval/SKILL.md): targeted checks first; broad lint/build/tests only for risk or scope that warrants them. Do not claim visual verification when browser access was unavailable. Report sizes, states, evidence and limitations actually checked.

**Definition of done:** correct and predictable behavior; clear Classic design; responsive, accessible controls; preserved settings and learning behavior; verified appearance where possible; accurate reporting.

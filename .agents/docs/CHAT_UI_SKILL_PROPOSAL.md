# Скилл для UI, предложенный чатом

> **Примечание**: Это полная оригинальная версия UI-скилла из 20 пунктов, предложенная в диалоге с чатом. Сохранена в документации для ознакомления и тестирования. Основным рабочим скиллом проекта является компактная версия в [SKILL.md](file:///c:/121/Lerne_projekt/tma/.agents/skills/tma-ui/SKILL.md).

---
name: tma-ui
description: Design, build, review, and polish Lerne React interfaces. Use for every task that creates or changes visible UI, layout, styling, controls, modals, settings, lists, cards, navigation, responsive behavior, or interaction states.
---

# Lerne UI

Use this skill for every task that changes what the user sees or interacts with.

A UI task is not complete merely because the component works.

It is complete only when:

- functionality works;
- the interface is visually coherent;
- information hierarchy is clear;
- spacing and typography are deliberate;
- mobile and desktop layouts behave correctly;
- all interaction states are implemented;
- the result has been visually reviewed after implementation.

## 1. Inspect before designing

Before changing UI, inspect:

- the affected component;
- its CSS;
- parent layout;
- neighboring screens;
- existing reusable components;
- existing visual patterns used for the same type of interaction.

Do not design a component in isolation.

Determine:

- primary purpose of the screen;
- primary user action;
- secondary actions;
- important information;
- optional information;
- destructive actions;
- expected amount of content;
- mobile behavior;
- desktop behavior.

Do not immediately start writing JSX after reading the task.

First understand the visual structure that the screen needs.

## 2. Visual hierarchy

Every screen must have a clear hierarchy.

The user should quickly understand:

1. where they are;
2. what the main content is;
3. what action is most important;
4. what actions are secondary.

Avoid giving every element equal visual weight.

Use emphasis deliberately through:

- size;
- spacing;
- typography;
- contrast;
- position;
- background;
- borders.

Prefer one clear primary action per visual region.

Secondary actions should not visually compete with it.

Destructive actions must be visually distinct from normal actions.

## 3. Avoid UI accumulation

Do not solve every new requirement by adding another button, card, border, badge, section, or container.

Before adding an element, ask whether it can be:

- merged with an existing control;
- moved into an existing group;
- placed in a contextual menu;
- represented through hierarchy instead of another container;
- removed entirely.

Avoid "box inside box inside box" layouts unless each level has a clear structural purpose.

Avoid unnecessary separators.

Spacing should often provide grouping without additional borders.

## 4. Spacing system

Do not invent arbitrary margins and paddings for every component.

Prefer a small consistent spacing scale.

Recommended default rhythm:

- 4px — very tight internal spacing;
- 8px — related elements;
- 12px — compact controls;
- 16px — normal component spacing;
- 24px — section separation;
- 32px — major separation.

Existing design may require exceptions, but arbitrary values should not accumulate without reason.

Related elements should be closer to each other than unrelated elements.

Do not compensate for weak hierarchy by adding excessive whitespace.

## 5. Typography

Typography must communicate hierarchy.

Use a limited number of text roles:

- page title;
- section title;
- primary content;
- secondary content;
- label;
- helper/meta text.

Do not create a different font size and weight for every element.

Long learning content must remain easy to read.

Avoid:

- overly small secondary text;
- excessive bold text;
- excessive uppercase;
- excessive gradient text;
- centered long-form text unless the content specifically benefits from it.

Typography should remain readable with longer German, Russian, Ukrainian, or English strings.

## 6. Color and visual effects

Use color to communicate meaning, not decoration alone.

Avoid adding new arbitrary colors when an existing semantic color can be reused.

Use accent colors sparingly.

The screen should not contain multiple unrelated visual focal points.

Glassmorphism, gradients, blur, glow, shadows, and animations are optional effects, not defaults.

Do not automatically add:

- gradients;
- glowing borders;
- large shadows;
- animated backgrounds;
- translucent containers.

Use them only when they support the existing visual language and do not reduce readability.

Content should remain visually dominant over decoration.

## 7. Components and consistency

Search existing components before creating new UI primitives.

Reuse or extend existing:

- buttons;
- icon buttons;
- inputs;
- selects;
- dialogs;
- menus;
- cards;
- badges;
- switches;
- tabs;
- loaders;
- empty states;
- notifications.

Do not create slightly different versions of the same control across different screens.

If the same visual pattern appears repeatedly, consider extracting or consolidating it.

However, do not introduce abstraction solely to reduce a few lines of code.

Read [reuse guidance](../skills/lean-code/SKILL.md) when component boundaries change.

## 8. Responsive design

Do not treat desktop layout as a stretched mobile layout or mobile layout as a compressed desktop layout.

Check affected interfaces at minimum around:

- 320px;
- 375px;
- 430px;
- tablet width;
- normal desktop width.

Verify:

- no horizontal overflow;
- buttons remain usable;
- long labels wrap correctly;
- forms remain understandable;
- dialogs fit the viewport;
- fixed controls do not cover content;
- lists remain readable;
- navigation remains accessible.

Prefer natural responsive layout using:

- flex;
- grid;
- min/max widths;
- wrapping;
- intrinsic sizing.

Avoid chains of narrow breakpoint-specific patches when a better layout model can solve the problem.

## 9. Touch and pointer interaction

Interactive elements should normally provide approximately a 44×44 CSS pixel usable touch target on touch devices.

Small icons may be visually smaller while retaining a sufficiently large clickable area.

Do not place unrelated small touch controls too close together.

Desktop hover behavior must not be required to understand or operate an interface.

## 10. Complete interaction states

For applicable components implement and review:

- default;
- hover;
- focus;
- pressed;
- selected;
- disabled;
- loading;
- empty;
- success;
- error;
- retry.

Do not treat loading and error states as afterthoughts.

Avoid duplicate submissions.

Preserve useful user input after recoverable failures.

Actions should provide clear feedback.

## 11. Forms and settings

For large settings interfaces, organize controls by user mental model rather than underlying implementation structure.

Prefer:

category → subsection → setting

over one long undifferentiated list.

For complex design settings, use logical sections such as:

- Front side;
- Back side;
- Card list;
- Study mode;
- General appearance.

Each subsection should contain only controls relevant to that visual region.

For visual configuration, provide live preview whenever practical.

Changes that affect appearance should be understandable before the user commits them.

Do not expose implementation details as user-facing setting names.

## 12. Modals and panels

Do not turn large workflows into small dialogs.

A modal should be used for focused tasks.

When content contains many settings, tabs, previews, or long forms, prefer:

- full-screen modal on mobile;
- large dialog;
- dedicated view;
- side panel when appropriate.

Keep primary actions predictable.

Avoid multiple competing close/back/save controls.

Long modals must have intentional scroll behavior.

## 13. Icons

Use the project's existing icon library and conventions.

Do not mix unrelated icon styles.

An icon-only action must have an accessible name.

Use text labels when an icon alone may be ambiguous.

Do not use decorative icons merely to fill visual space.

## 14. Accessibility

Use semantic controls.

Provide:

- keyboard navigation;
- visible focus;
- accessible names;
- modal focus management;
- sufficient contrast;
- meaningful disabled states.

Do not rely solely on color to communicate state.

Check readability with larger text and longer translated labels.

## 15. Localization

All interface text must go through the existing translation mechanism, including:

- buttons;
- placeholders;
- errors;
- helper text;
- notifications;
- accessibility labels.

Preserve interpolation parameters.

Distinguish:

- interface language;
- learning language;
- user-created content.

Do not translate user content as interface copy.

## 16. Motion

Motion should communicate state or spatial relationship.

Do not add animation simply because Framer Motion is available.

Prefer transform and opacity where appropriate.

Respect reduced-motion preferences.

Animation must never be required for understanding whether an operation succeeded.

Avoid simultaneous animation of many unrelated elements.

## 17. Preserve user customization

Lerne supports extensive user-configurable appearance.

When changing card rendering or visual settings, determine whether the affected property is user-configurable.

Do not introduce hardcoded CSS that silently overrides configured:

- colors;
- fonts;
- sizes;
- backgrounds;
- markers;
- alignment;
- visibility;
- spacing.

New visual features must coexist with existing customization rather than bypass it.

Preview rendering and real rendering should use the same styling source whenever practical.

Avoid implementing one visual rule separately in preview, study mode, and card list unless their behavior is intentionally different.

## 18. Visual review is mandatory

After implementation, perform a separate visual review.

Do not review only the lines of code that changed.

Review the resulting screen as a user would see it.

Check:

- visual hierarchy;
- alignment;
- spacing rhythm;
- typography consistency;
- unnecessary containers;
- excessive borders;
- excessive effects;
- contrast;
- button hierarchy;
- long content;
- empty content;
- mobile width;
- desktop width;
- surrounding components.

Ask:

"Does this look intentionally designed, or merely assembled from controls?"

If it looks assembled, simplify and polish it before considering the UI task complete.

## 19. UI regression prevention

A local improvement must not make the rest of the application visually inconsistent.

When changing a shared component, inspect representative screens that use it.

When introducing a new visual pattern, determine whether the project already has an equivalent pattern.

Do not leave two nearly identical design patterns without a deliberate reason.

## 20. Verification

Use [verification guidance](../skills/ai-harness-eval/SKILL.md).

For frontend changes run relevant lint/build checks.

When a runnable environment is available, inspect the actual changed interface rather than relying only on code review.

Report what was actually visually tested and what was not.

A successful build is not evidence that a UI looks correct.

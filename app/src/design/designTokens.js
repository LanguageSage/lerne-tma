/**
 * designTokens.js — преобразование Design Config V2 в CSS custom properties.
 *
 * Архитектура (важно!):
 * - designConfigToCssVariables(config) — ЧИСТАЯ функция, не трогает DOM.
 *   Возвращает объект { '--design-var': 'value' }.
 *   Используется для scoped preview через style prop:
 *     <div style={designConfigToCssVariables(adminDraft)}><Preview /></div>
 *
 * - applyPublishedDesignTokens(config) — пишет в document.documentElement.
 *   ЕДИНСТВЕННОЕ место в приложении с глобальным setProperty.
 *   Вызывается только при применении published global design.
 *
 * Admin draft НЕ вызывает applyPublishedDesignTokens — только scoped vars.
 */

import { normalizeDesignConfig, DEFAULT_DESIGN_CONFIG_V2 } from './designConfig.js';

/**
 * Преобразует Design Config V2 в объект CSS custom properties.
 * Чистая функция — не изменяет DOM.
 *
 * @param {object} config — Design Config V2 (будет нормализован)
 * @returns {object} объект вида { '--design-app-bg': '...', ... }
 */
export function designConfigToCssVariables(config) {
  const c = normalizeDesignConfig(config);
  const vars = {};

  // ── Global ─────────────────────────────────────────────────────────────────
  vars['--design-app-bg']        = c.global.appBg;
  vars['--design-accent']        = c.global.accentColor;
  vars['--design-ui-font']       = c.global.uiFont;
  vars['--design-glass-bg']      = c.global.glassBg;
  vars['--design-glass-blur']    = c.global.glassBlur;
  vars['--design-glass-border']  = c.global.glassBorder;
  vars['--design-radius']        = c.global.commonRadius;

  // ── Front Card ─────────────────────────────────────────────────────────────
  vars['--design-front-card-border']  = c.front.card.borderColor;
  vars['--design-front-card-bw']      = c.front.card.borderWidth;
  vars['--design-front-card-radius']  = c.front.card.borderRadius;
  vars['--design-front-card-padding'] = c.front.card.padding;
  vars['--design-front-card-shadow']  = c.front.card.shadow;

  // Front main text
  vars['--design-front-font']      = c.front.mainText.font;
  vars['--design-front-font-size'] = `${c.front.mainText.size}rem`;
  vars['--design-front-weight']    = c.front.mainText.weight;
  vars['--design-front-style']     = c.front.mainText.style;
  vars['--design-front-lh']        = c.front.mainText.lineHeight;
  vars['--design-front-color']     = c.front.mainText.color;
  vars['--design-front-align']     = c.front.mainText.align;

  // Task block
  vars['--design-task-font']        = c.front.task.font;
  vars['--design-task-font-size']   = `${c.front.task.size}rem`;
  vars['--design-task-weight']      = c.front.task.weight;
  vars['--design-task-style']       = c.front.task.style;
  vars['--design-task-color']       = c.front.task.color;
  vars['--design-task-bg']          = c.front.task.bg;
  vars['--design-task-border']      = c.front.task.borderColor;
  vars['--design-task-radius']      = c.front.task.borderRadius;
  vars['--design-task-padding']     = c.front.task.padding;

  // Source block
  vars['--design-source-font']      = c.front.source.font;
  vars['--design-source-font-size'] = `${c.front.source.size}rem`;
  vars['--design-source-weight']    = c.front.source.weight;
  vars['--design-source-style']     = c.front.source.style;
  vars['--design-source-color']     = c.front.source.color;
  vars['--design-source-bg']        = c.front.source.bg;
  vars['--design-source-border']    = c.front.source.borderColor;
  vars['--design-source-radius']    = c.front.source.borderRadius;
  vars['--design-source-padding']   = c.front.source.padding;

  // Example block
  vars['--design-example-font']     = c.front.example.font;
  vars['--design-example-font-size']= `${c.front.example.size}rem`;
  vars['--design-example-weight']   = c.front.example.weight;
  vars['--design-example-style']    = c.front.example.style;
  vars['--design-example-color']    = c.front.example.color;
  vars['--design-example-bg']       = c.front.example.bg;
  vars['--design-example-border']   = c.front.example.borderColor;
  vars['--design-example-radius']   = c.front.example.borderRadius;
  vars['--design-example-padding']  = c.front.example.padding;

  // Options block
  vars['--design-options-label-font']  = c.front.options.label.font;
  vars['--design-options-label-size']  = `${c.front.options.label.size}rem`;
  vars['--design-options-label-color'] = c.front.options.label.color;
  vars['--design-options-label-w']     = c.front.options.label.weight;
  vars['--design-options-chip-font']   = c.front.options.chip.font;
  vars['--design-options-chip-size']   = `${c.front.options.chip.size}rem`;
  vars['--design-options-chip-color']  = c.front.options.chip.color;
  vars['--design-options-chip-bg']     = c.front.options.chip.bg;
  vars['--design-options-chip-border'] = c.front.options.chip.borderColor;
  vars['--design-options-chip-radius'] = c.front.options.chip.radius;
  vars['--design-options-chip-pad']    = c.front.options.chip.padding;
  vars['--design-options-chip-gap']    = c.front.options.chip.gap;

  // ── Back Card ──────────────────────────────────────────────────────────────
  vars['--design-back-card-border']  = c.back.card.borderColor;
  vars['--design-back-card-bw']      = c.back.card.borderWidth;
  vars['--design-back-card-radius']  = c.back.card.borderRadius;
  vars['--design-back-card-padding'] = c.back.card.padding;
  vars['--design-back-card-shadow']  = c.back.card.shadow;

  // Reference text (mini front on back side)
  vars['--design-ref-font']      = c.back.referenceText.font;
  vars['--design-ref-font-size'] = `${c.back.referenceText.size}rem`;
  vars['--design-ref-weight']    = c.back.referenceText.weight;
  vars['--design-ref-style']     = c.back.referenceText.style;
  vars['--design-ref-color']     = c.back.referenceText.color;
  vars['--design-ref-align']     = c.back.referenceText.align;

  // Separator
  vars['--design-sep-color']   = c.back.separator.color;
  vars['--design-sep-opacity'] = String(c.back.separator.opacity);
  vars['--design-sep-width']   = c.back.separator.width;

  // Answer text
  vars['--design-back-font']      = c.back.answerText.font;
  vars['--design-back-font-size'] = `${c.back.answerText.size}rem`;
  vars['--design-back-weight']    = c.back.answerText.weight;
  vars['--design-back-style']     = c.back.answerText.style;
  vars['--design-back-lh']        = c.back.answerText.lineHeight;
  vars['--design-back-color']     = c.back.answerText.color;
  vars['--design-back-align']     = c.back.answerText.align;

  // Context
  vars['--design-ctx-font']      = c.back.context.font;
  vars['--design-ctx-font-size'] = `${c.back.context.size}rem`;
  vars['--design-ctx-weight']    = c.back.context.weight;
  vars['--design-ctx-style']     = c.back.context.style;
  vars['--design-ctx-lh']        = c.back.context.lineHeight;
  vars['--design-ctx-color']     = c.back.context.color === 'auto' ? 'inherit' : c.back.context.color;
  vars['--design-ctx-align']     = c.back.context.align;

  // ── Exercises — Semantic States ────────────────────────────────────────────
  const ex = c.exercises;

  // Choice / Quiz
  vars['--design-choice-normal-bg']       = ex.choice.normal.bg;
  vars['--design-choice-normal-color']    = ex.choice.normal.color;
  vars['--design-choice-normal-border']   = ex.choice.normal.borderColor;
  vars['--design-choice-selected-bg']     = ex.choice.selected.bg;
  vars['--design-choice-selected-color']  = ex.choice.selected.color;
  vars['--design-choice-selected-border'] = ex.choice.selected.borderColor;
  vars['--design-choice-correct-bg']      = ex.choice.correct.bg;
  vars['--design-choice-correct-color']   = ex.choice.correct.color;
  vars['--design-choice-correct-border']  = ex.choice.correct.borderColor;
  vars['--design-choice-wrong-bg']        = ex.choice.wrong.bg;
  vars['--design-choice-wrong-color']     = ex.choice.wrong.color;
  vars['--design-choice-wrong-border']    = ex.choice.wrong.borderColor;
  vars['--design-choice-disabled-bg']     = ex.choice.disabled.bg;
  vars['--design-choice-disabled-color']  = ex.choice.disabled.color;

  // Универсальные semantic aliases (используются в cloze, match, word bank)
  vars['--design-correct-bg']     = ex.choice.correct.bg;
  vars['--design-correct-color']  = ex.choice.correct.color;
  vars['--design-correct-border'] = ex.choice.correct.borderColor;
  vars['--design-wrong-bg']       = ex.choice.wrong.bg;
  vars['--design-wrong-color']    = ex.choice.wrong.color;
  vars['--design-wrong-border']   = ex.choice.wrong.borderColor;
  vars['--design-selected-bg']    = ex.choice.selected.bg;
  vars['--design-selected-color'] = ex.choice.selected.color;
  vars['--design-selected-border']= ex.choice.selected.borderColor;

  // Cloze gap
  vars['--design-cloze-gap-bg']         = ex.clozeGap.gap.bg;
  vars['--design-cloze-gap-border']     = ex.clozeGap.gap.borderColor;
  vars['--design-cloze-gap-color']      = ex.clozeGap.gap.color;
  vars['--design-cloze-correct-bg']     = ex.clozeGap.correct.bg;
  vars['--design-cloze-correct-border'] = ex.clozeGap.correct.borderColor;
  vars['--design-cloze-correct-color']  = ex.clozeGap.correct.color;
  vars['--design-cloze-wrong-bg']       = ex.clozeGap.wrong.bg;
  vars['--design-cloze-wrong-border']   = ex.clozeGap.wrong.borderColor;
  vars['--design-cloze-wrong-color']    = ex.clozeGap.wrong.color;

  // Word bank
  vars['--design-wb-word-bg']          = ex.wordBank.word.bg;
  vars['--design-wb-word-color']       = ex.wordBank.word.color;
  vars['--design-wb-word-border']      = ex.wordBank.word.borderColor;
  vars['--design-wb-selected-bg']      = ex.wordBank.selected.bg;
  vars['--design-wb-selected-color']   = ex.wordBank.selected.color;
  vars['--design-wb-selected-border']  = ex.wordBank.selected.borderColor;

  // Free text
  vars['--design-ft-bg']           = ex.freeText.input.bg;
  vars['--design-ft-color']        = ex.freeText.input.color;
  vars['--design-ft-border']       = ex.freeText.input.borderColor;
  vars['--design-ft-radius']       = ex.freeText.input.radius;
  vars['--design-ft-focus-border'] = ex.freeText.focus.borderColor;

  // Match
  vars['--design-match-item-bg']       = ex.match.item.bg;
  vars['--design-match-item-color']    = ex.match.item.color;
  vars['--design-match-item-border']   = ex.match.item.borderColor;
  vars['--design-match-item-radius']   = ex.match.item.radius;
  vars['--design-match-selected-bg']   = ex.match.selected.bg;
  vars['--design-match-matched-bg']    = ex.match.matched.bg;
  vars['--design-match-matched-color'] = ex.match.matched.color;
  vars['--design-match-wrong-bg']      = ex.match.wrong.bg;

  // Puzzle
  vars['--design-puzzle-item-bg']      = ex.puzzle.item.bg;
  vars['--design-puzzle-item-color']   = ex.puzzle.item.color;
  vars['--design-puzzle-item-border']  = ex.puzzle.item.borderColor;
  vars['--design-puzzle-item-radius']  = ex.puzzle.item.radius;
  vars['--design-puzzle-selected-bg']  = ex.puzzle.selected.bg;

  // Action buttons
  vars['--design-btn-primary-bg']     = ex.actionButton.primary.bg;
  vars['--design-btn-primary-color']  = ex.actionButton.primary.color;
  vars['--design-btn-primary-border'] = ex.actionButton.primary.borderColor;
  vars['--design-btn-secondary-bg']   = ex.actionButton.secondary.bg;
  vars['--design-btn-disabled-bg']    = ex.actionButton.disabled.bg;
  vars['--design-btn-disabled-color'] = ex.actionButton.disabled.color;

  // ── Card List ──────────────────────────────────────────────────────────────
  const cl = c.cardList;
  vars['--design-cl-card-border']  = cl.card.borderColor;
  vars['--design-cl-card-bw']      = cl.card.borderWidth;
  vars['--design-cl-card-radius']  = cl.card.borderRadius;
  vars['--design-cl-card-padding'] = cl.card.padding;
  vars['--design-cl-card-shadow']  = cl.card.shadow;
  vars['--design-cl-card-gap']     = cl.card.gap;

  vars['--design-cl-front-font']   = cl.frontText.font;
  vars['--design-cl-front-size']   = `${cl.frontText.size}rem`;
  vars['--design-cl-front-weight'] = cl.frontText.weight;
  vars['--design-cl-front-color']  = cl.frontText.color;
  vars['--design-cl-front-align']  = cl.frontText.align;
  vars['--design-cl-front-lh']     = cl.frontText.lineHeight;
  vars['--design-cl-front-shadow'] = cl.frontText.shadow;

  vars['--design-cl-back-font']    = cl.backText.font;
  vars['--design-cl-back-size']    = `${cl.backText.size}rem`;
  vars['--design-cl-back-weight']  = cl.backText.weight;
  vars['--design-cl-back-color']   = cl.backText.color;
  vars['--design-cl-back-align']   = cl.backText.align;
  vars['--design-cl-back-lh']      = cl.backText.lineHeight;

  vars['--design-cl-divider-color']   = cl.divider.color;
  vars['--design-cl-divider-opacity'] = String(cl.divider.opacity);
  vars['--design-cl-divider-width']   = cl.divider.width;

  vars['--design-cl-drag-color']   = cl.controls.dragHandleColor;
  vars['--design-cl-menu-color']   = cl.controls.menuButtonColor;

  return vars;
}

/**
 * Применяет Design Config V2 как CSS custom properties к корню приложения.
 * ЕДИНСТВЕННОЕ место с document.documentElement.style.setProperty.
 * Вызывается только для published global design.
 *
 * @param {object} config — Design Config V2
 */
export function applyPublishedDesignTokens(config) {
  const vars = designConfigToCssVariables(config);
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(vars)) {
    if (value !== undefined && value !== null) {
      root.style.setProperty(prop, String(value));
    }
  }
}

/**
 * Сбрасывает все design CSS variables к значениям из DEFAULT_DESIGN_CONFIG_V2.
 * Используется при logout или если global design недоступен.
 */
export function resetDesignTokens() {
  applyPublishedDesignTokens(DEFAULT_DESIGN_CONFIG_V2);
}

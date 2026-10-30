/**
 * legacyAdapter.js — миграция старых flat design settings (V1) в Design Config V2.
 *
 * Правила:
 * - migrateLegacyDesignSettings() берёт старые flat поля из useSettingsStore
 *   и маппит их в V2 структуру.
 * - Результат всегда проходит через normalizeDesignConfig() — безопасен.
 * - Не вызывает побочных эффектов, не читает/пишет localStorage.
 */

import { DEFAULT_DESIGN_CONFIG_V2, normalizeDesignConfig } from './designConfig.js';
import { getDesignStylesFromV2 } from '../utils/cardStyles.js';

export const DEFAULT_DESIGN_SETTINGS = {
  cardBgFront: 'liquid_emerald',
  cardBgBack: 'liquid_emerald',
  cardFont: 'Comfortaa',
  cardTextColor: '#fde047',
  cardFontSize: 1.7,
  cardTextAlign: 'left',
  backTextColor: '#cbd5e1',
  contextFont: 'Inter',
  contextTextColor: 'auto',
  contextFontSize: 1.4,
  contextTextAlign: 'left',
  cardTextShadow: 'glow',
  contextTextShadow: 'glow',
  cardFontWeight: '700',
  cardFontStyle: 'normal',
  contextFontWeight: '400',
  contextFontStyle: 'normal',

  // Card List Preview Settings
  previewCardFont: 'Comfortaa',
  previewCardTextColor: '#cbdeb5',
  previewBackTextColor: '#b1e7e0',
  previewCardFontSize: 1.19,
  previewBackFontSize: 0.98,
  previewCardFontWeight: '700',
  previewCardFontStyle: 'normal',
  previewTextShadow: 'none',
  previewCardTextAlign: 'left',
  previewCardLines: 3,
  previewCardBg: 'dark_obsidian'
};

export const DESIGN_STORAGE_MAP = {
  cardBgFront: 'lerne_card_bg_front',
  cardBgBack: 'lerne_card_bg_back',
  cardFont: 'lerne_card_font',
  cardTextColor: 'lerne_card_text_color',
  cardFontSize: 'lerne_card_font_size',
  cardTextAlign: 'lerne_card_text_align',
  backTextColor: 'lerne_back_text_color',
  contextFont: 'lerne_context_font',
  contextTextColor: 'lerne_context_text_color',
  contextFontSize: 'lerne_context_font_size',
  contextTextAlign: 'lerne_context_text_align',
  cardTextShadow: 'lerne_card_text_shadow',
  contextTextShadow: 'lerne_context_text_shadow',
  cardFontWeight: 'lerne_card_font_weight',
  cardFontStyle: 'lerne_card_font_style',
  contextFontWeight: 'lerne_context_font_weight',
  contextFontStyle: 'lerne_context_font_style',

  previewCardFont: 'lerne_preview_card_font',
  previewCardTextColor: 'lerne_preview_card_text_color',
  previewBackTextColor: 'lerne_preview_back_text_color',
  previewCardFontSize: 'lerne_preview_card_font_size',
  previewBackFontSize: 'lerne_preview_back_font_size',
  previewCardFontWeight: 'lerne_preview_card_font_weight',
  previewCardFontStyle: 'lerne_preview_card_font_style',
  previewTextShadow: 'lerne_preview_text_shadow',
  previewCardTextAlign: 'lerne_preview_card_text_align',
  previewCardLines: 'lerne_preview_card_lines',
  previewCardBg: 'lerne_preview_card_bg',
};

/**
 * Маппинг старого flat field → dot-path в V2.
 * Только поля, для которых есть однозначное соответствие.
 */
const LEGACY_FIELD_MAP = {
  // Front main text
  cardFont:       'front.mainText.font',
  cardTextColor:  'front.mainText.color',
  cardFontSize:   'front.mainText.size',
  cardFontWeight: 'front.mainText.weight',
  cardFontStyle:  'front.mainText.style',
  cardTextAlign:  'front.mainText.align',
  cardTextShadow: 'front.mainText.shadow',

  // Back answer text (в V1 это были независимые поля)
  backTextColor:      'back.answerText.color',
  contextFont:        'back.context.font',
  contextTextColor:   'back.context.color',
  contextFontSize:    'back.context.size',
  contextFontWeight:  'back.context.weight',
  contextFontStyle:   'back.context.style',
  contextTextAlign:   'back.context.align',
  contextTextShadow:  'back.context.shadow',

  // Card list preview
  previewCardFont:      'cardList.frontText.font',
  previewCardTextColor: 'cardList.frontText.color',
  previewBackTextColor: 'cardList.backText.color',
  previewCardFontSize:  'cardList.frontText.size',
  previewBackFontSize:  'cardList.backText.size',
  previewCardFontWeight:'cardList.frontText.weight',
  previewCardFontStyle: 'cardList.frontText.style',
  previewTextShadow:    'cardList.frontText.shadow',
  previewCardTextAlign: 'cardList.frontText.align',
  previewCardLines:     'cardList.frontText.lines',
  previewCardBg:        'cardList.card.bg',

  // Exercise base color для auto-palette
  cardTextColor_exercises: 'exercises.baseColor',
};

/**
 * Устанавливает значение по dot-path в plain object (мутирует).
 * Используется только внутри этого модуля при построении V2 объекта.
 */
function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof current[keys[i]] !== 'object' || current[keys[i]] === null) return;
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * Преобразует старые flat design settings (V1 flat fields из useSettingsStore)
 * в Design Config V2.
 *
 * Используется для:
 * 1. Создания первоначального admin draft из существующих настроек.
 * 2. Восстановления сохранённых пользовательских V1 preset settings.
 *
 * Также используется безопасной миграцией личного оформления.
 *
 * @param {object} flat — объект с flat V1 design fields
 * @returns {object} полный валидный Design Config V2
 */
export function migrateLegacyDesignSettings(flat) {
  if (!flat || typeof flat !== 'object') {
    return normalizeDesignConfig(null);
  }
  flat = { ...DEFAULT_DESIGN_SETTINGS, ...flat };
  for (const [key, fallback] of Object.entries(DEFAULT_DESIGN_SETTINGS)) {
    if (typeof fallback === 'number' && flat[key] !== '' && Number.isFinite(Number(flat[key]))) {
      flat[key] = Number(flat[key]);
    }
    if (key.endsWith('FontWeight') && typeof flat[key] === 'number') flat[key] = String(flat[key]);
  }

  // Начинаем с полных defaults
  const v2 = JSON.parse(JSON.stringify(DEFAULT_DESIGN_CONFIG_V2));

  // Применяем маппинг
  for (const [legacyKey, v2Path] of Object.entries(LEGACY_FIELD_MAP)) {
    if (legacyKey === 'cardTextColor_exercises') {
      // Специальный случай: baseColor для exercises берём из cardTextColor
      const color = flat.cardTextColor;
      if (color && typeof color === 'string' && color !== 'auto') {
        setNestedValue(v2, 'exercises.baseColor', color);
      }
      continue;
    }
    const val = flat[legacyKey];
    if (val === undefined || val === null) continue;
    setNestedValue(v2, v2Path, val);
  }

  // Особые случаи:
  // 1. back.referenceText должна совпадать с front.mainText (в V1 нет разделения)
  v2.back.referenceText = { ...v2.front.mainText };
  // V1 answer inherits front typography; context alignment controls the answer.
  v2.back.answerText = { ...v2.front.mainText,
    font: flat.backCardFont || flat.cardFont,
    size: flat.backCardFontSize != null && Number.isFinite(Number(flat.backCardFontSize))
      ? Number(flat.backCardFontSize) : flat.cardFontSize,
    weight: String(flat.backCardFontWeight || flat.cardFontWeight),
    style: flat.backCardFontStyle || flat.cardFontStyle,
    shadow: flat.backCardTextShadow || flat.cardTextShadow,
    color: flat.backTextColor || flat.cardTextColor,
    align: flat.contextTextAlign || 'left',
  };
  if (flat.contextTextColor?.toLowerCase() === v2.back.answerText.color?.toLowerCase()) {
    v2.back.context.color = 'auto';
  }
  // V1 input and right Match column used the context role, not front typography.
  const contextColor = getDesignStylesFromV2(v2).contextText.color;
  v2.exercises.freeText.input.color = contextColor;
  v2.exercises.match.item.color = v2.front.mainText.color;
  v2.front.matchRightText = { ...v2.back.context, color: contextColor };
  v2.exercises.puzzle.item.color = v2.front.mainText.color;
  Object.assign(v2.cardList.backText, {
    font: flat.previewCardFont, style: flat.previewCardFontStyle,
    weight: '500', shadow: flat.previewTextShadow, align: flat.previewCardTextAlign,
  });

  // Backgrounds now belong to V2 and survive normalization/preset application.
  if (flat.cardBgFront) v2.front.card.background = flat.cardBgFront;
  if (flat.cardBgBack) v2.back.card.background = flat.cardBgBack;

  // 3. previewCardBg → cardList.card.bg
  if (flat.previewCardBg) {
    if (!v2.cardList.card) v2.cardList.card = {};
    v2.cardList.card.bg = flat.previewCardBg;
  }

  // Финальная нормализация (проверяет фон и заполняет пропуски)
  return normalizeDesignConfig(v2);
}

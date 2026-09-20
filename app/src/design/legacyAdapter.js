/**
 * legacyAdapter.js — миграция старых flat design settings (V1) в Design Config V2.
 *
 * Правила:
 * - migrateLegacyDesignSettings() берёт старые flat поля из useSettingsStore
 *   и маппит их в V2 структуру.
 * - legacyPresetToDesignConfigV2() адаптирует DESIGN_PRESETS из appConstants.
 * - Результат всегда проходит через normalizeDesignConfig() — безопасен.
 * - Не вызывает побочных эффектов, не читает/пишет localStorage.
 */

import { DEFAULT_DESIGN_CONFIG_V2, normalizeDesignConfig } from './designConfig.js';

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
 * 2. Адаптации preset settings.
 *
 * НЕ используется для автоматической миграции обычных пользователей.
 *
 * @param {object} flat — объект с flat V1 design fields
 * @returns {object} полный валидный Design Config V2
 */
export function migrateLegacyDesignSettings(flat) {
  if (!flat || typeof flat !== 'object') {
    return normalizeDesignConfig(null);
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

  // 2. cardBgFront/cardBgBack — эти поля управляют CardBackground styleType,
  //    не являются CSS-цветами. Сохраняем в global для возможного использования.
  if (flat.cardBgFront) v2.global._legacyBgFront = flat.cardBgFront;
  if (flat.cardBgBack)  v2.global._legacyBgBack  = flat.cardBgBack;

  // 3. previewCardBg → cardList.card.bg — также styleType, не CSS
  if (flat.previewCardBg) v2.cardList._legacyBg = flat.previewCardBg;

  // Финальная нормализация (убирает _legacy* ключи, заполняет пропуски)
  return normalizeDesignConfig(v2);
}

/**
 * Адаптирует один preset из DESIGN_PRESETS (V1 flat format) в Design Config V2.
 *
 * @param {object} preset — элемент из DESIGN_PRESETS (с полем settings)
 * @returns {object} полный валидный Design Config V2
 */
export function legacyPresetToDesignConfigV2(preset) {
  if (!preset?.settings) return normalizeDesignConfig(null);
  return migrateLegacyDesignSettings(preset.settings);
}

/**
 * Адаптирует массив DESIGN_PRESETS в V2-совместимые preset объекты.
 *
 * @param {Array} presets — массив из DESIGN_PRESETS
 * @returns {Array} [{ id, name, configV2 }]
 */
export function adaptDesignPresetsToV2(presets) {
  if (!Array.isArray(presets)) return [];
  return presets.map(preset => ({
    id: preset.id,
    name: preset.name,
    configV2: legacyPresetToDesignConfigV2(preset),
    // Сохраняем legacy bgFront/bgBack для CardBackground совместимости
    legacyBgFront: preset.settings?.cardBgFront,
    legacyBgBack:  preset.settings?.cardBgBack,
  }));
}

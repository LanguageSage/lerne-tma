/**
 * Design Config V2 — центральная схема дизайна Lerne.
 *
 * Принципы:
 * - schemaVersion позволяет будущую безопасную миграцию на V3.
 * - normalizeDesignConfig() отбрасывает неизвестные ключи — безопасный import JSON.
 * - Только published global design применяется к реальному приложению.
 * - Admin draft изолирован внутри preview контейнера (CSS scoped vars).
 */


// App chrome is independent of learning-card typography and exercise semantics.
const buttonState = (color1, color2, textColor, borderColor, mode = 'solid') => ({
  mode, color1, color2, angle: 135, textColor, iconColor: textColor, borderColor,
});
const buttonConfig = (primary) => ({
  normal: buttonState(primary ? '#6366f1' : '#1e293b', primary ? '#a855f7' : '#334155', '#ffffff', '#64748b', primary ? 'linear' : 'solid'),
  hover: buttonState(primary ? '#818cf8' : '#334155', primary ? '#c084fc' : '#475569', '#ffffff', '#a78bfa', primary ? 'linear' : 'solid'),
  pressed: buttonState(primary ? '#4f46e5' : '#0f172a', primary ? '#9333ea' : '#1e293b', '#ffffff', '#a78bfa', primary ? 'linear' : 'solid'),
  disabled: buttonState('#1e293b', '#1e293b', '#94a3b8', '#334155'),
  borderWidth: 1, radius: 12, height: 48, shadow: primary ? 0.3 : 0.1,
});

// ── Typography shape (используется во многих местах) ──────────────────────────
const DEFAULT_TYPOGRAPHY = {
  font: 'Inter',
  size: 1.4,    // rem
  weight: '400',
  style: 'normal',
  lineHeight: 1.5,
  color: '#ffffff',
  align: 'left',
  shadow: 'none',
};

// ── Surface shape (карточка, блок) ────────────────────────────────────────────
const DEFAULT_SURFACE = {
  bg: 'rgba(15,23,42,0.55)',
  borderColor: 'rgba(196,181,253,0.3)',
  borderWidth: '1px',
  borderRadius: '12px',
  padding: '12px',
  shadow: 'none',
};

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT_DESIGN_CONFIG_V2
// ─────────────────────────────────────────────────────────────────────────────
export const DEFAULT_DESIGN_CONFIG_V2 = {
  schemaVersion: 2,

  global: {
    /** Фон приложения (CSS value: solid color, gradient, etc.) */
    appBg: 'radial-gradient(circle at top right, #1a1a2e, #16213e, #0f3460)',
    accentColor: '#a78bfa',
    uiFont: 'Inter',
    /** Glass surface */
    glassBg: 'rgba(255,255,255,0.05)',
    glassOpacity: 0.05,
    glassBlur: '12px',
    glassBorder: 'rgba(255,255,255,0.1)',
    /** Базовый радиус для компонентов */
    commonRadius: '12px',
    background: {
      // Keep legacy appBg unchanged until an administrator selects a new mode.
      mode: 'legacy', color1: '#1a1a2e', color2: '#16213e', color3: '#0f3460',
      colorCount: 3, angle: 135, positionX: 100, positionY: 0, glow: 0,
    },
    panels: {
      // Empty tint retains existing glassBg / glassBorder from old V2 JSON.
      color: '', borderColor: '', borderOpacity: 0.1, shadow: 0.3, innerLight: 0.06,
    },
    typography: {
      headingColor: '#ffffff', textColor: '#cbd5e1', secondaryColor: '#94a3b8',
      headingSize: 1.65, serviceSize: 0.8, headingLineHeight: 1.25, lineHeight: 1.5,
    },
    details: {
      secondaryAccent: '#38bdf8', infoColor: '#a5b4fc', iconColor: '#94a3b8',
      dividerColor: '#334155', activeIntensity: 0.25,
    },
    buttons: { primary: buttonConfig(true), secondary: buttonConfig(false) },
  },

  front: {
    /** Фон карточки определяется CardBackground (styleType), здесь CSS overrides */
    card: {
      borderColor: 'rgba(196,181,253,0.3)',
      borderWidth: '1px',
      borderRadius: '20px',
      padding: '12px 8px 16px',
      shadow: '0 16px 32px -16px rgba(0,0,0,0.65)',
    },
    /** Основной текст упражнения */
    mainText: {
      font: 'Comfortaa',
      size: 1.7,
      weight: '700',
      style: 'normal',
      lineHeight: 1.35,
      color: '#fde047',
      align: 'left',
      shadow: 'glow',
    },
    /** Блок ::task */
    task: {
      font: 'Inter',
      size: 0.88,
      weight: '500',
      style: 'normal',
      color: '#e2e8f0',
      bg: 'rgba(14, 116, 144, 0.1)',
      borderColor: 'rgba(56, 189, 248, 0.5)',
      borderRadius: '12px',
      padding: '8px 12px',
    },
    /** Блок ::source */
    source: {
      font: 'Inter',
      size: 0.82,
      weight: '400',
      style: 'italic',
      color: '#cbd5e1',
      bg: 'rgba(255, 255, 255, 0.045)',
      borderColor: 'rgba(148, 163, 184, 0.18)',
      borderRadius: '12px',
      padding: '8px 12px',
    },
    /** Блок ::example */
    example: {
      font: 'Inter',
      size: 0.88,
      weight: '400',
      style: 'normal',
      color: 'rgba(241, 245, 249, 0.88)',
      bg: 'rgba(124, 58, 237, 0.07)',
      borderColor: 'rgba(196, 181, 253, 0.2)',
      borderRadius: '12px',
      padding: '8px 12px',
    },
    /** Legacy hint appearance settings retained for saved user configurations. */
    hint: {
      font: 'Inter',
      size: 0.88,
      weight: '400',
      style: 'normal',
      color: '#fef3c7',
      bg: 'rgba(245, 158, 11, 0.08)',
      borderColor: 'rgba(251, 191, 36, 0.45)',
      borderRadius: '12px',
      padding: '8px 12px',
    },
    /** Блок ::options */
    options: {
      label: {
        font: 'Inter',
        size: 0.82,
        color: '#64748b',
        weight: '500',
      },
      chip: {
        font: 'Inter',
        size: 0.88,
        color: '#e2e8f0',
        bg: 'rgba(255,255,255,0.06)',
        borderColor: 'rgba(255,255,255,0.15)',
        radius: '6px',
        padding: '3px 10px',
        gap: '6px',
      },
    },
  },

  back: {
    /** Фон обратной стороны — независим от лицевой */
    card: {
      borderColor: 'rgba(196,181,253,0.17)',
      borderWidth: '1px',
      borderRadius: '20px',
      padding: '12px 8px 16px',
      shadow: 'none',
    },
    /** Мини-текст вопроса/исходной фразы вверху обратной стороны */
    referenceText: {
      font: 'Comfortaa',
      size: 1.7,
      weight: '700',
      style: 'normal',
      color: '#fde047',
      align: 'left',
      shadow: 'glow',
    },
    /** Разделитель между вопросом и ответом */
    separator: {
      color: 'rgba(255,255,255,0.12)',
      opacity: 1,
      width: '1px',
    },
    /** Основной ответ / перевод */
    answerText: {
      font: 'Inter',
      size: 1.4,
      weight: '400',
      style: 'normal',
      lineHeight: 1.5,
      color: '#cbd5e1',
      align: 'left',
      shadow: 'none',
    },
    /** Контекстный блок */
    context: {
      font: 'Inter',
      size: 1.4,
      weight: '400',
      style: 'normal',
      lineHeight: 1.5,
      color: 'auto',   // 'auto' → harmonized от answerText.color
      align: 'left',
      shadow: 'glow',
    },
  },

  exercises: {
    /** Текст тела упражнения (cloze masked text, puzzle source text) */
    bodyText: {
      font: 'Comfortaa',
      size: 1.7,
      weight: '700',
      style: 'normal',
      color: '#fde047',
      lineHeight: 1.35,
    },

    /**
     * Режим палитры: 'auto' — вычисляется из baseColor
     *                'manual' — все состояния задаются вручную
     */
    paletteMode: 'auto',
    baseColor: '#fde047',   // используется для auto-palette

    /** Quiz / choice options */
    choice: {
      normal:   { bg: 'rgba(15,23,42,0.55)', color: '#e2e8f0', borderColor: 'rgba(255,255,255,0.12)' },
      hover:    { bg: 'rgba(255,255,255,0.08)', color: '#ffffff', borderColor: 'rgba(255,255,255,0.2)' },
      selected: { bg: 'rgba(167,139,250,0.18)', color: '#a78bfa', borderColor: 'rgba(167,139,250,0.35)' },
      correct:  { bg: 'rgba(34,197,94,0.18)',  color: '#4ade80', borderColor: 'rgba(34,197,94,0.35)' },
      wrong:    { bg: 'rgba(239,68,68,0.18)',   color: '#f87171', borderColor: 'rgba(239,68,68,0.35)' },
      disabled: { bg: 'rgba(255,255,255,0.03)', color: '#475569', borderColor: 'rgba(255,255,255,0.06)' },
    },

    /** Cloze gap */
    clozeGap: {
      gap:     { borderColor: 'rgba(255,255,255,0.4)',  bg: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' },
      filled:  { borderColor: 'rgba(255,255,255,0.6)',  bg: 'rgba(255,255,255,0.1)',  color: '#ffffff' },
      correct: { borderColor: '#22c55e', bg: 'rgba(34,197,94,0.2)',  color: '#4ade80' },
      wrong:   { borderColor: '#ef4444', bg: 'rgba(239,68,68,0.2)',  color: '#f87171' },
    },

    /** Gap Dropdown Menu */
    gapDropdown: {
      font: 'Inter',
      size: 1.15,
      bg: 'rgba(15,23,42,0.94)',
      borderColor: 'rgba(168,85,247,0.4)',
      item: {
        bg: 'rgba(255,255,255,0.04)',
        borderColor: 'rgba(255,255,255,0.08)',
        color: '#f1f5f9'
      },
      selected: {
        bg: 'rgba(168,85,247,0.25)',
        borderColor: '#a855f7',
        color: '#c084fc'
      }
    },

    /** Word bank */
    wordBank: {
      container: { bg: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', radius: '12px' },
      word:      { bg: 'rgba(255,255,255,0.07)', color: '#e2e8f0', borderColor: 'rgba(255,255,255,0.12)', radius: '8px' },
      selected:  { bg: 'rgba(167,139,250,0.18)', color: '#a78bfa', borderColor: 'rgba(167,139,250,0.35)', radius: '8px' },
      correct:   { bg: 'rgba(34,197,94,0.18)',   color: '#4ade80', borderColor: 'rgba(34,197,94,0.35)',   radius: '8px' },
      wrong:     { bg: 'rgba(239,68,68,0.18)',    color: '#f87171', borderColor: 'rgba(239,68,68,0.35)',   radius: '8px' },
    },

    /** Free text input */
    freeText: {
      input:   { bg: 'rgba(255,255,255,0.06)', color: '#e2e8f0', borderColor: 'rgba(255,255,255,0.15)', radius: '10px' },
      focus:   { bg: 'rgba(255,255,255,0.09)', borderColor: 'rgba(167,139,250,0.5)' },
      correct: { borderColor: '#22c55e', color: '#4ade80' },
      wrong:   { borderColor: '#ef4444', color: '#f87171' },
    },

    /** Match exercise */
    match: {
      item:     { bg: 'rgba(255,255,255,0.06)', color: '#e2e8f0', borderColor: 'rgba(255,255,255,0.12)', radius: '8px' },
      selected: { bg: 'rgba(167,139,250,0.18)', color: '#a78bfa', borderColor: 'rgba(167,139,250,0.4)' },
      matched:  { bg: 'rgba(34,197,94,0.15)',   color: '#4ade80', borderColor: 'rgba(34,197,94,0.3)' },
      wrong:    { bg: 'rgba(239,68,68,0.15)',    color: '#f87171', borderColor: 'rgba(239,68,68,0.3)' },
    },

    /** Puzzle */
    puzzle: {
      container: { bg: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', radius: '12px' },
      item:      { bg: 'rgba(255,255,255,0.07)', color: '#e2e8f0', borderColor: 'rgba(255,255,255,0.12)', radius: '8px' },
      selected:  { bg: 'rgba(167,139,250,0.2)',  color: '#a78bfa', borderColor: 'rgba(167,139,250,0.4)' },
    },

    /** Action buttons (Check, Next, Submit) */
    actionButton: {
      primary:   { bg: 'rgba(167,139,250,0.2)',  color: '#a78bfa', borderColor: 'rgba(167,139,250,0.4)' },
      secondary: { bg: 'rgba(255,255,255,0.06)', color: '#94a3b8', borderColor: 'rgba(255,255,255,0.12)' },
      disabled:  { bg: 'rgba(255,255,255,0.03)', color: '#475569', borderColor: 'rgba(255,255,255,0.06)' },
    },
  },

  cardList: {
    card: {
      bg: 'rgba(15,23,42,0.55)',
      borderColor: 'rgba(255,255,255,0.08)',
      borderWidth: '1px',
      borderRadius: '12px',
      padding: '12px 14px',
      shadow: 'none',
      gap: '8px',
    },
    frontText: {
      font: 'Comfortaa',
      size: 1.19,
      weight: '700',
      style: 'normal',
      color: '#cbdeb5',
      align: 'left',
      lineHeight: 1.4,
      shadow: 'none',
      lines: 3,
    },
    backText: {
      font: 'Inter',
      size: 0.98,
      weight: '400',
      style: 'normal',
      color: '#b1e7e0',
      align: 'left',
      lineHeight: 1.4,
      shadow: 'none',
      lines: 3,
    },
    divider: {
      color: 'rgba(255,255,255,0.08)',
      opacity: 1,
      width: '1px',
    },
    metadata: {
      numberColor: '#475569',
      cefrBadge: true,
      creatorBadge: true,
    },
    controls: {
      dragHandleColor: 'rgba(255,255,255,0.2)',
      menuButtonColor: 'rgba(255,255,255,0.4)',
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Known keys whitelist per section (защита от arbitrary imports)
// ─────────────────────────────────────────────────────────────────────────────

/** Рекурсивно проверяет, что все ключи patch известны в schema. */
function filterKnownKeys(patch, schema) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return undefined;
  if (!schema || typeof schema !== 'object') return undefined;
  const result = {};
  for (const key of Object.keys(schema)) {
    if (!Object.hasOwn(patch, key)) continue;
    const schemaVal = schema[key];
    const patchVal = patch[key];
    if (schemaVal !== null && typeof schemaVal === 'object' && !Array.isArray(schemaVal)
        && patchVal !== null && typeof patchVal === 'object' && !Array.isArray(patchVal)) {
      const nested = filterKnownKeys(patchVal, schemaVal);
      if (nested !== undefined) result[key] = nested;
    } else {
      // Принимаем примитив, только если тип совместим
      if (typeof schemaVal !== 'object' && typeof patchVal === typeof schemaVal
          && (typeof patchVal !== 'number' || Number.isFinite(patchVal))) result[key] = patchVal;
    }
  }
  return result;
}

/** Рекурсивный merge: base ← patch (только известные ключи из base). */
function deepMergeKnown(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const result = { ...base };
  for (const key of Object.keys(base)) {
    if (!Object.hasOwn(patch, key)) continue;
    const bv = base[key];
    const pv = patch[key];
    if (bv !== null && typeof bv === 'object' && !Array.isArray(bv)
        && pv !== null && typeof pv === 'object' && !Array.isArray(pv)) {
      result[key] = deepMergeKnown(bv, pv);
    } else {
      result[key] = pv;
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Нормализует partial config: заполняет отсутствующие поля defaults,
 * отбрасывает неизвестные ключи, защищает от повреждённого JSON.
 *
 * @param {unknown} partial — любое значение из внешнего источника
 * @returns {object} полный валидный Design Config V2
 */
export function normalizeDesignConfig(partial) {
  const base = DEFAULT_DESIGN_CONFIG_V2;
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    return structuredClone(base);
  }
  // Отбрасываем неизвестные ключи верхнего уровня через filterKnownKeys
  const safe = filterKnownKeys(partial, base) || {};
  const merged = deepMergeKnown(structuredClone(base), safe);
  normalizeGlobalFields(merged.global);
  merged.schemaVersion = 2;
  return merged;
}

/**
 * Безопасный merge base + patch (только known keys).
 * Используется для применения patch из редактора.
 */
export function mergeDesignConfig(base, patch) {
  const safeBase = normalizeDesignConfig(base);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return safeBase;
  const safePatch = filterKnownKeys(patch, DEFAULT_DESIGN_CONFIG_V2) || {};
  return normalizeDesignConfig(deepMergeKnown(safeBase, safePatch));
}

/**
 * Читает значение по dot-path: getDesignValue(config, 'front.mainText.color')
 */
export function getDesignValue(config, path) {
  if (!config || !path) return undefined;
  return path.split('.').reduce((obj, key) => (obj && typeof obj === 'object' ? obj[key] : undefined), config);
}

/**
 * Возвращает новый config с изменённым значением по dot-path.
 * Не мутирует оригинал.
 */
export function patchDesignValue(config, path, value) {
  if (!config || !path) return config;
  const keys = path.split('.');
  // Проверяем, что путь существует в DEFAULT (защита от произвольных ключей)
  const exists = getDesignValue(DEFAULT_DESIGN_CONFIG_V2, path);
  if (exists === undefined) return config; // неизвестный путь → игнорируем

  const cloned = structuredClone(config);
  let obj = cloned;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof obj[keys[i]] !== 'object' || obj[keys[i]] === null) return config;
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;
  return cloned;
}

/** Bound the new editor values before generating CSS; old card settings stay intact. */
function normalizeGlobalFields(global) {
  const defaults = DEFAULT_DESIGN_CONFIG_V2.global;
  const bound = (obj, key, min, max, fallback) => {
    obj[key] = typeof obj[key] === 'number' && Number.isFinite(obj[key])
      ? Math.min(max, Math.max(min, obj[key])) : fallback;
  };
  const color = (obj, key, fallback, allowEmpty = false) => {
    if (!(allowEmpty && obj[key] === '') && !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(obj[key])) obj[key] = fallback;
  };
  const bg = global.background;
  if (!['legacy', 'solid', 'linear', 'radial'].includes(bg.mode)) bg.mode = defaults.background.mode;
  for (const key of ['color1', 'color2', 'color3']) color(bg, key, defaults.background[key]);
  bg.colorCount = bg.colorCount === 2 ? 2 : 3;
  for (const [key, max] of [['angle', 360], ['positionX', 100], ['positionY', 100], ['glow', 1]]) bound(bg, key, 0, max, defaults.background[key]);
  bound(global, 'glassOpacity', 0, 1, defaults.glassOpacity);
  for (const key of ['glassBlur', 'commonRadius']) {
    if (!/^\d+(\.\d+)?px$/.test(global[key])) global[key] = defaults[key];
    global[key] = `${Math.min(40, parseFloat(global[key]))}px`;
  }
  const panel = global.panels;
  color(panel, 'color', '', true);
  color(panel, 'borderColor', '', true);
  for (const key of ['borderOpacity', 'shadow', 'innerLight']) bound(panel, key, 0, 1, defaults.panels[key]);
  const type = global.typography;
  for (const key of ['headingColor', 'textColor', 'secondaryColor']) color(type, key, defaults.typography[key]);
  bound(type, 'headingSize', 1, 3, defaults.typography.headingSize);
  bound(type, 'serviceSize', 0.65, 1.25, defaults.typography.serviceSize);
  for (const key of ['headingLineHeight', 'lineHeight']) bound(type, key, 1, 2, defaults.typography[key]);
  for (const key of ['secondaryAccent', 'infoColor', 'iconColor', 'dividerColor']) color(global.details, key, defaults.details[key]);
  bound(global.details, 'activeIntensity', 0, 1, defaults.details.activeIntensity);
  for (const role of ['primary', 'secondary']) {
    const button = global.buttons[role];
    const def = defaults.buttons[role];
    for (const [key, min, max] of [['borderWidth', 0, 4], ['radius', 0, 40], ['height', 36, 72], ['shadow', 0, 1]]) bound(button, key, min, max, def[key]);
    for (const state of ['normal', 'hover', 'pressed', 'disabled']) {
      const value = button[state];
      if (!['solid', 'linear'].includes(value.mode)) value.mode = def[state].mode;
      for (const key of ['color1', 'color2', 'textColor', 'iconColor', 'borderColor']) color(value, key, def[state][key]);
      bound(value, 'angle', 0, 360, def[state].angle);
    }
  }
}

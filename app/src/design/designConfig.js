/**
 * Design Config V2 — центральная схема дизайна Lerne.
 *
 * Принципы:
 * - schemaVersion позволяет будущую безопасную миграцию на V3.
 * - normalizeDesignConfig() отбрасывает неизвестные ключи — безопасный import JSON.
 * - Только published global design применяется к реальному приложению.
 * - Admin draft изолирован внутри preview контейнера (CSS scoped vars).
 */

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
    if (!(key in patch)) continue;
    const schemaVal = schema[key];
    const patchVal = patch[key];
    if (schemaVal !== null && typeof schemaVal === 'object' && !Array.isArray(schemaVal)
        && patchVal !== null && typeof patchVal === 'object' && !Array.isArray(patchVal)) {
      const nested = filterKnownKeys(patchVal, schemaVal);
      if (nested !== undefined) result[key] = nested;
    } else {
      // Принимаем примитив, только если тип совместим
      if (patchVal !== undefined) result[key] = patchVal;
    }
  }
  return result;
}

/** Рекурсивный merge: base ← patch (только известные ключи из base). */
function deepMergeKnown(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const result = { ...base };
  for (const key of Object.keys(base)) {
    if (!(key in patch)) continue;
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
  return deepMergeKnown(base, safe);
}

/**
 * Безопасный merge base + patch (только known keys).
 * Используется для применения patch из редактора.
 */
export function mergeDesignConfig(base, patch) {
  const safeBase = normalizeDesignConfig(base);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return safeBase;
  const safePatch = filterKnownKeys(patch, DEFAULT_DESIGN_CONFIG_V2) || {};
  return deepMergeKnown(safeBase, safePatch);
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

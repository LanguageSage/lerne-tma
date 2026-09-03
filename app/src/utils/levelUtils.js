/**
 * Helper utilities for formatting and styling card CEFR levels (A1 - C2).
 */

const CEFR_ORDER = { "A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6 };
const CEFR_TAG_RE = /\b(A1|A2|B1|B2|C1|C2)\b/gi;
const CEFR_LEVELS = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);

const LEVEL_CONFIG = {
  A1: { color: "#4ade80", bgColor: "rgba(74, 222, 128, 0.14)", borderColor: "rgba(74, 222, 128, 0.3)" },
  A2: { color: "#2dd4bf", bgColor: "rgba(45, 212, 191, 0.14)", borderColor: "rgba(45, 212, 191, 0.3)" },
  B1: { color: "#38bdf8", bgColor: "rgba(56, 189, 248, 0.14)", borderColor: "rgba(56, 189, 248, 0.3)" },
  B2: { color: "#818cf8", bgColor: "rgba(129, 140, 248, 0.14)", borderColor: "rgba(129, 140, 248, 0.3)" },
  C1: { color: "#c084fc", bgColor: "rgba(192, 132, 252, 0.14)", borderColor: "rgba(192, 132, 252, 0.3)" },
  C2: { color: "#f59e0b", bgColor: "rgba(245, 158, 11, 0.18)", borderColor: "rgba(245, 158, 11, 0.35)" }
};

export const updateCardLevelTags = (currentTags, newLevel) => {
  const cleaned = (currentTags || '')
    .replace(CEFR_TAG_RE, '')
    .replace(/,,+/g, ',')
    .replace(/^,|,$/g, '')
    .trim();
  if (!newLevel) return cleaned || null;
  return cleaned ? `${cleaned},${newLevel}` : newLevel;
};

export const getSavedCefr = (card) => {
  if (!card) return null;
  if (card.cefr && typeof card.cefr === 'object') return card.cefr;

  let metadata = card.metadata;
  if (!metadata) return null;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  return metadata?.cefr && typeof metadata.cefr === 'object' ? metadata.cefr : null;
};

export const buildCefrMetaFromClassifierResult = (result, source = 'local') => {
  if (!result) return null;
  const level = result.level ? String(result.level).toUpperCase().trim() : null;
  return {
    level: CEFR_LEVELS.has(level) ? level : null,
    source,
    confidence: typeof result.confidence === 'number' ? Math.max(0, Math.min(1, Number(result.confidence.toFixed(3)))) : undefined,
    reason: result.reason || null,
    reason_short: result.reason_short || null,
    grammar_features: Array.isArray(result.grammar_features) ? result.grammar_features : undefined,
    vocabulary_features: Array.isArray(result.vocabulary_features) ? result.vocabulary_features : undefined,
    classifier_version: source === 'local' ? 'de-local-rules-v1' : undefined,
    classified_at: new Date().toISOString()
  };
};

export const buildManualCefrMeta = (level) => {
  const normalized = level ? String(level).toUpperCase().trim() : null;
  return {
    level: CEFR_LEVELS.has(normalized) ? normalized : null,
    source: 'manual',
    confidence: 1,
    reason: 'Установлен вручную пользователем',
    reason_short: 'вручную',
    classified_at: new Date().toISOString()
  };
};

export const getLevelInfo = (card) => {
  if (!card) return null;

  const savedCefr = getSavedCefr(card);
  let levelStr = savedCefr?.level || card.level;

  // Fallback to tags if level string is missing or needs extraction
  if (!levelStr && card.tags) {
    const matches = String(card.tags).match(CEFR_TAG_RE);
    if (matches && matches.length > 0) {
      let maxLvl = "A1";
      let maxScore = 0;
      for (const m of matches) {
        const u = m.toUpperCase();
        if (CEFR_ORDER[u] && CEFR_ORDER[u] > maxScore) {
          maxScore = CEFR_ORDER[u];
          maxLvl = u;
        }
      }
      levelStr = maxLvl;
    }
  }

  if (!levelStr) return null;

  const lvl = String(levelStr).toUpperCase().trim();
  const cfg = LEVEL_CONFIG[lvl];
  if (!cfg) return null;

  return {
    level: lvl,
    color: cfg.color,
    bgColor: cfg.bgColor,
    borderColor: cfg.borderColor
  };
};

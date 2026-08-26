/**
 * Helper utilities for formatting and styling card CEFR levels (A1 - C2).
 */

const CEFR_ORDER = { "A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6 };
const CEFR_TAG_RE = /\b(A1|A2|B1|B2|C1|C2)\b/gi;

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

export const getLevelInfo = (card) => {
  if (!card) return null;

  let levelStr = card.level;

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

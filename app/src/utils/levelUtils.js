/**
 * Helper utilities for formatting and styling card CEFR levels (A1 - C2).
 */

export const getLevelInfo = (card) => {
  if (!card) return null;

  let levelStr = card.level;

  // Fallback to tags if level string is missing
  if (!levelStr && card.tags) {
    const match = String(card.tags).match(/\b(A1|A2|B1|B2|C1|C2)\b/i);
    if (match) levelStr = match[1].toUpperCase();
  }

  if (!levelStr) return null;

  const lvl = String(levelStr).toUpperCase().trim();

  let color = "#4ade80";
  let bgColor = "rgba(74, 222, 128, 0.14)";
  let borderColor = "rgba(74, 222, 128, 0.3)";

  if (lvl === "A1") {
    color = "#4ade80";
    bgColor = "rgba(74, 222, 128, 0.14)";
    borderColor = "rgba(74, 222, 128, 0.3)";
  } else if (lvl === "A2") {
    color = "#2dd4bf";
    bgColor = "rgba(45, 212, 191, 0.14)";
    borderColor = "rgba(45, 212, 191, 0.3)";
  } else if (lvl === "B1") {
    color = "#38bdf8";
    bgColor = "rgba(56, 189, 248, 0.14)";
    borderColor = "rgba(56, 189, 248, 0.3)";
  } else if (lvl === "B2") {
    color = "#818cf8";
    bgColor = "rgba(129, 140, 248, 0.14)";
    borderColor = "rgba(129, 140, 248, 0.3)";
  } else if (lvl === "C1") {
    color = "#c084fc";
    bgColor = "rgba(192, 132, 252, 0.14)";
    borderColor = "rgba(192, 132, 252, 0.3)";
  } else if (lvl === "C2") {
    color = "#f59e0b";
    bgColor = "rgba(245, 158, 11, 0.18)";
    borderColor = "rgba(245, 158, 11, 0.35)";
  } else {
    return null;
  }

  return {
    level: lvl,
    color,
    bgColor,
    borderColor
  };
};

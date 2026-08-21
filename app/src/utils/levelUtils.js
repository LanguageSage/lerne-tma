/**
 * Helper utilities for formatting and styling card level & difficulty sub-levels.
 */

export const getLevelInfo = (card) => {
  if (!card) return null;

  let difficulty = card.difficulty;
  let levelStr = card.level;

  // Fallback to tags if level string is missing
  if (!levelStr && card.tags) {
    const match = String(card.tags).match(/\b(A1|A2|B1|B2|C1|C2)\b/i);
    if (match) levelStr = match[1].toUpperCase();
  }

  const levelToDiffMap = { A1: 1.0, A2: 2.0, B1: 3.0, B2: 4.0, C1: 5.0, C2: 6.0 };
  if ((difficulty === null || difficulty === undefined) && levelStr) {
    difficulty = levelToDiffMap[levelStr] || 1.0;
  }

  if (difficulty === null || difficulty === undefined) {
    return null;
  }

  const d = Math.max(1.0, Math.min(6.0, parseFloat(difficulty) || 1.0));
  const difficultyScore = d.toFixed(1);

  let subLevel = "A1.1";
  let color = "#4ade80";
  let bgColor = "rgba(74, 222, 128, 0.12)";
  let borderColor = "rgba(74, 222, 128, 0.25)";

  if (d <= 1.4) {
    subLevel = "A1.1";
    color = "#4ade80";
    bgColor = "rgba(74, 222, 128, 0.14)";
    borderColor = "rgba(74, 222, 128, 0.3)";
  } else if (d <= 1.9) {
    subLevel = "A1.2";
    color = "#16a34a";
    bgColor = "rgba(22, 163, 74, 0.18)";
    borderColor = "rgba(22, 163, 74, 0.35)";
  } else if (d <= 2.4) {
    subLevel = "A2.1";
    color = "#2dd4bf";
    bgColor = "rgba(45, 212, 191, 0.14)";
    borderColor = "rgba(45, 212, 191, 0.3)";
  } else if (d <= 2.9) {
    subLevel = "A2.2";
    color = "#0d9488";
    bgColor = "rgba(13, 148, 136, 0.18)";
    borderColor = "rgba(13, 148, 136, 0.35)";
  } else if (d <= 3.4) {
    subLevel = "B1.1";
    color = "#38bdf8";
    bgColor = "rgba(56, 189, 248, 0.14)";
    borderColor = "rgba(56, 189, 248, 0.3)";
  } else if (d <= 3.9) {
    subLevel = "B1.2";
    color = "#0284c7";
    bgColor = "rgba(2, 132, 199, 0.18)";
    borderColor = "rgba(2, 132, 199, 0.35)";
  } else if (d <= 4.4) {
    subLevel = "B2.1";
    color = "#818cf8";
    bgColor = "rgba(129, 140, 248, 0.14)";
    borderColor = "rgba(129, 140, 248, 0.3)";
  } else if (d <= 4.9) {
    subLevel = "B2.2";
    color = "#4f46e5";
    bgColor = "rgba(79, 70, 229, 0.18)";
    borderColor = "rgba(79, 70, 229, 0.35)";
  } else if (d <= 5.4) {
    subLevel = "C1.1";
    color = "#c084fc";
    bgColor = "rgba(192, 132, 252, 0.14)";
    borderColor = "rgba(192, 132, 252, 0.3)";
  } else if (d <= 5.8) {
    subLevel = "C1.2";
    color = "#9333ea";
    bgColor = "rgba(147, 51, 234, 0.18)";
    borderColor = "rgba(147, 51, 234, 0.35)";
  } else {
    subLevel = "C2";
    color = "#f59e0b";
    bgColor = "rgba(245, 158, 11, 0.18)";
    borderColor = "rgba(245, 158, 11, 0.35)";
  }

  return {
    subLevel,
    difficultyScore,
    color,
    bgColor,
    borderColor
  };
};

import { normalizeDesignConfig } from './designConfig.js';
import { tr } from '../i18n/locale.js';

// Native V2 built-ins. Only differences from V2 defaults are stored.
export const DESIGN_PRESETS = [
  {
    id: "strict_dark",
    get name() { return tr("Строгий тёмный 🖤"); },
    configV2: normalizeDesignConfig({
      front: {
        card: { background: "dark_obsidian" },
        mainText: { font: "Inter", size: 1.8, color: "#ffffff", align: "center", shadow: "none" },
        matchRightText: { font: "Inter", size: 1.35, weight: "400", style: "normal", lineHeight: 1.5, color: "#94a3b8", align: "left", shadow: "none" }
      },
      back: {
        card: { background: "dark_obsidian" },
        referenceText: { font: "Inter", size: 1.8, color: "#ffffff", align: "center", shadow: "none" },
        answerText: { size: 1.8, weight: "700", lineHeight: 1.35, color: "#ffffff" },
        context: { size: 1.35, color: "#94a3b8", shadow: "none" }
      },
      exercises: {
        baseColor: "#ffffff",
        freeText: {
          input: { color: "#94a3b8" }
        },
        match: {
          item: { color: "#ffffff" }
        },
        puzzle: {
          item: { color: "#ffffff" }
        }
      },
      cardList: {
        card: { bg: "dark_obsidian" },
        backText: { font: "Comfortaa", weight: "500" }
      }
    }),
  },
  {
    id: "strict_minimal",
    get name() { return tr("Минимализм 🌑"); },
    configV2: normalizeDesignConfig({
      front: {
        card: { background: "dark_minimal" },
        mainText: { font: "Inter", size: 1.75, weight: "600", color: "#f8fafc", align: "center", shadow: "none" },
        matchRightText: { font: "Inter", size: 1.3, weight: "400", style: "normal", lineHeight: 1.5, color: "#cbd5e1", align: "left", shadow: "none" }
      },
      back: {
        card: { background: "dark_minimal" },
        referenceText: { font: "Inter", size: 1.75, weight: "600", color: "#f8fafc", align: "center", shadow: "none" },
        answerText: { size: 1.75, weight: "600", lineHeight: 1.35, color: "#f8fafc" },
        context: { size: 1.3, color: "#cbd5e1", shadow: "none" }
      },
      exercises: {
        baseColor: "#f8fafc",
        freeText: {
          input: { color: "#cbd5e1" }
        },
        match: {
          item: { color: "#f8fafc" }
        },
        puzzle: {
          item: { color: "#f8fafc" }
        }
      },
      cardList: {
        card: { bg: "dark_minimal" },
        backText: { font: "Comfortaa", weight: "500" }
      }
    }),
  },
  {
    id: "strict_midnight",
    get name() { return tr("Полуночный 🌌"); },
    configV2: normalizeDesignConfig({
      front: {
        card: { background: "dark_midnight" },
        mainText: { font: "Outfit", size: 1.8, color: "#ffffff", align: "center" },
        matchRightText: { font: "Inter", size: 1.35, weight: "400", style: "normal", lineHeight: 1.5, color: "#93c5fd", align: "left", shadow: "none" }
      },
      back: {
        card: { background: "dark_midnight" },
        referenceText: { font: "Outfit", size: 1.8, color: "#ffffff", align: "center" },
        answerText: { font: "Outfit", size: 1.8, weight: "700", lineHeight: 1.35, color: "#ffffff", shadow: "glow" },
        context: { size: 1.35, color: "#93c5fd", shadow: "none" }
      },
      exercises: {
        baseColor: "#ffffff",
        freeText: {
          input: { color: "#93c5fd" }
        },
        match: {
          item: { color: "#ffffff" }
        },
        puzzle: {
          item: { color: "#ffffff" }
        }
      },
      cardList: {
        card: { bg: "dark_midnight" },
        backText: { font: "Comfortaa", weight: "500" }
      }
    }),
  },
  {
    id: "strict_emerald",
    get name() { return tr("Тёмный изумруд 🌿"); },
    configV2: normalizeDesignConfig({
      front: {
        card: { background: "dark_emerald" },
        mainText: { font: "Outfit", size: 1.8, color: "#ffffff", align: "center", shadow: "none" },
        matchRightText: { font: "Inter", size: 1.35, weight: "400", style: "normal", lineHeight: 1.5, color: "#86efac", align: "left", shadow: "none" }
      },
      back: {
        card: { background: "dark_emerald" },
        referenceText: { font: "Outfit", size: 1.8, color: "#ffffff", align: "center", shadow: "none" },
        answerText: { font: "Outfit", size: 1.8, weight: "700", lineHeight: 1.35, color: "#ffffff" },
        context: { size: 1.35, color: "#86efac", shadow: "none" }
      },
      exercises: {
        baseColor: "#ffffff",
        freeText: {
          input: { color: "#86efac" }
        },
        match: {
          item: { color: "#ffffff" }
        },
        puzzle: {
          item: { color: "#ffffff" }
        }
      },
      cardList: {
        card: { bg: "dark_emerald" },
        backText: { font: "Comfortaa", weight: "500" }
      }
    }),
  },
  {
    id: "lerne_2026",
    get name() { return tr("Lerne Emerald (Стандарт) ✨"); },
    configV2: normalizeDesignConfig({
      front: {
        card: { background: "liquid_emerald" },
        matchRightText: { font: "Inter", size: 1.4, weight: "400", style: "normal", lineHeight: 1.5, color: "hsl(213, 25%, 84%)", align: "left", shadow: "glow" }
      },
      back: {
        card: { background: "liquid_emerald" },
        answerText: { font: "Comfortaa", size: 1.7, weight: "700", lineHeight: 1.35, shadow: "glow" }
      },
      exercises: {
        freeText: {
          input: { color: "hsl(213, 25%, 84%)" }
        },
        match: {
          item: { color: "#fde047" }
        },
        puzzle: {
          item: { color: "#fde047" }
        }
      },
      cardList: {
        card: { bg: "dark_emerald" },
        backText: { font: "Comfortaa", weight: "500" }
      }
    }),
  },
  {
    id: "premium",
    get name() { return tr("Премиум 💎"); },
    configV2: normalizeDesignConfig({
      front: {
        card: { background: "liquid" },
        mainText: { font: "Outfit", size: 1.8, color: "#ffffff", align: "center" },
        matchRightText: { font: "Inter", size: 1.35, weight: "400", style: "normal", lineHeight: 1.5, color: "#cbd5e1", align: "left", shadow: "none" }
      },
      back: {
        card: { background: "liquid_cosmic" },
        referenceText: { font: "Outfit", size: 1.8, color: "#ffffff", align: "center" },
        answerText: { font: "Outfit", size: 1.8, weight: "700", lineHeight: 1.35, color: "#ffffff", shadow: "glow" },
        context: { size: 1.35, color: "#cbd5e1", shadow: "none" }
      },
      exercises: {
        baseColor: "#ffffff",
        freeText: {
          input: { color: "#cbd5e1" }
        },
        match: {
          item: { color: "#ffffff" }
        },
        puzzle: {
          item: { color: "#ffffff" }
        }
      },
      cardList: {
        card: { bg: "dark_midnight" },
        backText: { font: "Comfortaa", weight: "500" }
      }
    }),
  },
  {
    id: "aurora",
    get name() { return tr("Сияние 🌌"); },
    configV2: normalizeDesignConfig({
      front: {
        card: { background: "aurora" },
        mainText: { font: "Outfit", size: 1.8, color: "#ffffff" },
        matchRightText: { font: "Inter", size: 1.1, weight: "400", style: "normal", lineHeight: 1.5, color: "#ffffff", align: "left", shadow: "shadow" }
      },
      back: {
        card: { background: "aurora" },
        referenceText: { font: "Outfit", size: 1.8, color: "#ffffff" },
        answerText: { font: "Outfit", size: 1.8, weight: "700", lineHeight: 1.35, shadow: "glow" },
        context: { size: 1.1, color: "#ffffff", shadow: "shadow" }
      },
      exercises: {
        baseColor: "#ffffff",
        freeText: {
          input: { color: "#ffffff" }
        },
        match: {
          item: { color: "#ffffff" }
        },
        puzzle: {
          item: { color: "#ffffff" }
        }
      },
      cardList: {
        card: { bg: "dark_midnight" },
        backText: { font: "Comfortaa", weight: "500" }
      }
    }),
  },
  {
    id: "morning_sea",
    get name() { return tr("Утреннее море 🌊"); },
    configV2: normalizeDesignConfig({
      front: {
        card: { background: "liquid_morning" },
        mainText: { font: "Inter", size: 1.8, color: "#5d0e0e", shadow: "glass" },
        matchRightText: { font: "Inter", size: 1.35, weight: "400", style: "normal", lineHeight: 1.5, color: "#30172e", align: "left", shadow: "outline" }
      },
      back: {
        card: { background: "liquid_morning" },
        referenceText: { font: "Inter", size: 1.8, color: "#5d0e0e", shadow: "glass" },
        answerText: { size: 1.8, weight: "700", lineHeight: 1.35, shadow: "glass" },
        context: { size: 1.35, color: "#30172e", shadow: "outline" }
      },
      exercises: {
        baseColor: "#5d0e0e",
        freeText: {
          input: { color: "#30172e" }
        },
        match: {
          item: { color: "#5d0e0e" }
        },
        puzzle: {
          item: { color: "#5d0e0e" }
        }
      },
      cardList: {
        card: { bg: "sunset_soft" },
        backText: { font: "Comfortaa", weight: "500" }
      }
    }),
  },
  {
    id: "cyberpunk",
    get name() { return tr("Киберпанк 🤖"); },
    configV2: normalizeDesignConfig({
      front: {
        card: { background: "holographic" },
        mainText: { font: "Roboto", size: 1.9, weight: "600", color: "#00ffff" },
        matchRightText: { font: "Roboto", size: 1.2, weight: "400", style: "italic", lineHeight: 1.5, color: "#57d6ce", align: "left", shadow: "glow" }
      },
      back: {
        card: { background: "holographic" },
        referenceText: { font: "Roboto", size: 1.9, weight: "600", color: "#00ffff" },
        answerText: { font: "Roboto", size: 1.9, weight: "600", lineHeight: 1.35, shadow: "glow" },
        context: { font: "Roboto", size: 1.2, style: "italic", color: "#57d6ce" }
      },
      exercises: {
        baseColor: "#00ffff",
        freeText: {
          input: { color: "#57d6ce" }
        },
        match: {
          item: { color: "#00ffff" }
        },
        puzzle: {
          item: { color: "#00ffff" }
        }
      },
      cardList: {
        card: { bg: "dark_obsidian" },
        backText: { font: "Comfortaa", weight: "500" }
      }
    }),
  },
  {
    id: "deep_ocean",
    get name() { return tr("Океан 🌊"); },
    configV2: normalizeDesignConfig({
      front: {
        card: { background: "liquid_ocean" },
        mainText: { font: "Playfair Display", size: 1.8, color: "#ffffff", shadow: "shadow" },
        matchRightText: { font: "Inter", size: 1.1, weight: "400", style: "normal", lineHeight: 1.5, color: "#94a3b8", align: "left", shadow: "none" }
      },
      back: {
        card: { background: "liquid_ocean" },
        referenceText: { font: "Playfair Display", size: 1.8, color: "#ffffff", shadow: "shadow" },
        answerText: { font: "Playfair Display", size: 1.8, weight: "700", lineHeight: 1.35, shadow: "shadow" },
        context: { size: 1.1, color: "#94a3b8", shadow: "none" }
      },
      exercises: {
        baseColor: "#ffffff",
        freeText: {
          input: { color: "#94a3b8" }
        },
        match: {
          item: { color: "#ffffff" }
        },
        puzzle: {
          item: { color: "#ffffff" }
        }
      },
      cardList: {
        card: { bg: "ocean_soft" },
        backText: { font: "Comfortaa", weight: "500" }
      }
    }),
  }
];

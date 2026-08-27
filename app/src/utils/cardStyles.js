/**
 * Shared card style computation for all study mode components.
 * Replaces duplicated cardStyle/contextStyle objects in StudyCard, StudyCardTrainer, StudyCardPuzzle, StudyCardSpeech.
 */

export const getCardStyle = (styles) => {
  if (!styles) return {};
  return {
    fontFamily: styles.cardFont || undefined,
    color: styles.cardTextColor || undefined,
    fontSize: styles.cardFontSize ? `${styles.cardFontSize}rem` : undefined,
    fontWeight: styles.cardFontWeight || undefined,
    fontStyle: styles.cardFontStyle || undefined,
    textShadow: styles.cardTextShadow || undefined,
    textAlign: styles.cardTextAlign || 'center',
  };
};

export const getBackCardStyle = (styles) => {
  if (!styles) return {};
  return {
    fontFamily: styles.cardFont || undefined,
    color: styles.backTextColor || styles.cardTextColor || undefined,
    fontSize: styles.cardFontSize ? `${styles.cardFontSize}rem` : undefined,
    fontWeight: styles.cardFontWeight || undefined,
    fontStyle: styles.cardFontStyle || undefined,
    textShadow: styles.cardTextShadow || undefined,
    textAlign: styles.contextTextAlign || 'left',
  };
};

/**
 * Derives a soft, high-contrast, harmonized color for context / example sentences
 * based on the back translation text color.
 */
export const getHarmonizedContextColor = (baseColor) => {
  const { h, s } = hexToHsl(baseColor);

  // If base color is grayscale or very low saturation:
  if (s < 10) {
    return '#94a3b8'; // Elegant muted slate-grey
  }

  // Derive soft pastel saturation and comfortable reading lightness
  const targetSaturation = Math.min(Math.max(s * 0.45, 25), 50);
  const targetLightness = 84;

  return `hsl(${h}, ${targetSaturation}%, ${targetLightness}%)`;
};

export const getContextStyle = (styles) => {
  if (!styles) return {};
  const baseColor = styles.backTextColor || styles.cardTextColor || '#ffffff';
  let color = styles.contextTextColor;
  if (!color || color === 'auto' || color.toLowerCase() === baseColor.toLowerCase()) {
    color = getHarmonizedContextColor(baseColor);
  }

  return {
    fontFamily: styles.contextFont || styles.cardFont || undefined,
    color,
    fontSize: styles.contextFontSize ? `${styles.contextFontSize}rem` : (styles.cardFontSize ? `${styles.cardFontSize * 0.9}rem` : undefined),
    fontWeight: styles.contextFontWeight || styles.cardFontWeight || undefined,
    fontStyle: styles.contextFontStyle || styles.cardFontStyle || undefined,
    textShadow: styles.contextTextShadow || styles.cardTextShadow || undefined,
    textAlign: styles.contextTextAlign || 'left',
  };
};

/**
 * Convert HEX color to HSL components
 */
export const hexToHsl = (hex) => {
  if (!hex || typeof hex !== 'string') return { h: 210, s: 20, l: 90 };
  let c = hex.trim().replace('#', '');
  if (c.length === 3) {
    c = c.split('').map(x => x + x).join('');
  }
  if (c.length !== 6) {
    return { h: 210, s: 20, l: 90 };
  }
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
      default:
        break;
    }
    h = Math.round(h * 60);
  }
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
};

/**
 * Derives a soft, high-contrast, harmonized color palette for test/quiz options
 * based on the user's card text color.
 */
export const getHarmonizedOptionStyles = (baseColor) => {
  const { h, s } = hexToHsl(baseColor);

  // If base color is grayscale or very low saturation:
  if (s < 10) {
    return {
      textColor: '#e2e8f0',
      badgeBg: 'rgba(255, 255, 255, 0.08)',
      badgeBorder: 'rgba(255, 255, 255, 0.2)',
      badgeColor: '#ffffff',
      buttonBorder: 'rgba(255, 255, 255, 0.12)',
      buttonBg: 'rgba(15, 23, 42, 0.55)'
    };
  }

  // Derive soft pastel saturation and high legibility lightness
  const targetSaturation = Math.min(Math.max(s * 0.5, 30), 55);
  const targetLightness = 88;

  const textColor = `hsl(${h}, ${targetSaturation}%, ${targetLightness}%)`;
  const badgeColor = `hsl(${h}, ${Math.min(s, 75)}%, 94%)`;
  const badgeBg = `hsla(${h}, ${targetSaturation}%, 65%, 0.14)`;
  const badgeBorder = `hsla(${h}, ${targetSaturation}%, 65%, 0.3)`;
  const buttonBorder = `hsla(${h}, ${targetSaturation}%, 60%, 0.16)`;
  const buttonBg = 'rgba(15, 23, 42, 0.55)';

  return {
    textColor,
    badgeBg,
    badgeBorder,
    badgeColor,
    buttonBorder,
    buttonBg
  };
};

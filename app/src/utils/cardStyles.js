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
    color: styles.cardTextColor || undefined,
    fontSize: styles.cardFontSize ? `${styles.cardFontSize}rem` : undefined,
    fontWeight: styles.cardFontWeight || undefined,
    fontStyle: styles.cardFontStyle || undefined,
    textShadow: styles.cardTextShadow || undefined,
    textAlign: styles.contextTextAlign || 'left',
  };
};

export const getContextStyle = (styles) => {
  if (!styles) return {};
  return {
    fontFamily: styles.contextFont || styles.cardFont || undefined,
    color: styles.contextTextColor || styles.cardTextColor || undefined,
    fontSize: styles.contextFontSize ? `${styles.contextFontSize}rem` : (styles.cardFontSize ? `${styles.cardFontSize * 0.9}rem` : undefined),
    fontWeight: styles.contextFontWeight || styles.cardFontWeight || undefined,
    fontStyle: styles.contextFontStyle || styles.cardFontStyle || undefined,
    textShadow: styles.contextTextShadow || styles.cardTextShadow || undefined,
    textAlign: styles.contextTextAlign || 'left',
  };
};

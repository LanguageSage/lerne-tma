import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { CardBackground } from '../common/CardBackground';
import { getTextShadow, getContextShadow } from '../../utils/style';
import { useSettingsStore } from '../../store/useSettingsStore';
import { getHarmonizedContextColor } from '../../utils/cardStyles';

export const TypographyPreview = ({ styleType = 'standard', showContext = true }) => {
  useInterfaceLocale();
  const {
    cardFont, cardTextColor, cardFontSize, cardTextShadow, cardFontWeight, cardFontStyle, cardTextAlign,
    backTextColor,
    contextFont, contextTextColor, contextFontSize, contextTextShadow, contextFontWeight, contextFontStyle, contextTextAlign
  } = useSettingsStore();

  const effectiveBackColor = backTextColor || cardTextColor || '#ffffff';
  const effectiveContextColor = (!contextTextColor || contextTextColor === 'auto' || contextTextColor.toLowerCase() === effectiveBackColor.toLowerCase())
    ? getHarmonizedContextColor(effectiveBackColor)
    : contextTextColor;

  const displayColor = showContext ? effectiveBackColor : cardTextColor;
  const displayShadow = showContext ? getTextShadow(cardTextShadow, effectiveBackColor) : getTextShadow(cardTextShadow, cardTextColor);

  return (
    <div className="typography-preview glass" style={{ 
      margin: '10px 0 20px 0', 
      padding: '30px 20px', 
      border: '1px solid rgba(255,255,255,0.1)',
      position: 'relative',
      overflow: 'hidden',
      minHeight: '120px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: '16px'
    }}>
      <CardBackground styleType={styleType} />
      <div style={{ position: 'relative', zIndex: 1, width: '100%' }}>
        <div style={{ 
          fontFamily: cardFont, 
          color: displayColor, 
          fontSize: `${cardFontSize}rem`,
          textShadow: displayShadow,
          fontWeight: cardFontWeight,
          fontStyle: cardFontStyle,
          textAlign: showContext ? (contextTextAlign || 'left') : (cardTextAlign || 'center'),
          marginBottom: showContext ? '10px' : '0'
        }}>
          {showContext ? tr("Перевод фразы") : 'Sample Phrase'}
        </div>
        {showContext && (
          <div style={{ 
            fontFamily: contextFont, 
            color: effectiveContextColor, 
            fontSize: `${contextFontSize}rem`,
            textShadow: getContextShadow(contextTextShadow, effectiveContextColor),
            fontWeight: contextFontWeight,
            fontStyle: contextFontStyle,
            textAlign: contextTextAlign || 'left',
            opacity: 0.95
          }}>{tr("Пример контекста и предложения")}{' '}</div>
        )}
      </div>
    </div>
  );
};

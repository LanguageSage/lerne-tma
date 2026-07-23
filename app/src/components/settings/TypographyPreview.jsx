import React from 'react';
import { CardBackground } from '../common/CardBackground';
import { getTextShadow, getContextShadow } from '../../utils/style';
import { useSettingsStore } from '../../store/useSettingsStore';

export const TypographyPreview = ({ styleType = 'standard', showContext = true }) => {
  const {
    cardFont, cardTextColor, cardFontSize, cardTextShadow, cardFontWeight, cardFontStyle,
    contextFont, contextTextColor, contextFontSize, contextTextShadow, contextFontWeight, contextFontStyle
  } = useSettingsStore();

  return (
    <div className="typography-preview glass" style={{ 
      margin: '10px 0 20px 0', 
      padding: '30px 20px', 
      textAlign: 'center',
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
          color: cardTextColor, 
          fontSize: `${cardFontSize}rem`,
          textShadow: getTextShadow(cardTextShadow, cardTextColor),
          fontWeight: cardFontWeight,
          fontStyle: cardFontStyle,
          marginBottom: showContext ? '10px' : '0'
        }}>
          Sample Phrase
        </div>
        {showContext && (
          <div style={{ 
            fontFamily: contextFont, 
            color: contextTextColor, 
            fontSize: `${contextFontSize}rem`,
            textShadow: getContextShadow(contextTextShadow, contextTextColor),
            fontWeight: contextFontWeight,
            fontStyle: contextFontStyle,
            opacity: 0.8
          }}>
            This is a context example
          </div>
        )}
      </div>
    </div>
  );
};

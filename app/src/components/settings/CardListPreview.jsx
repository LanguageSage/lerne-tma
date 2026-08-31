import React from 'react';
import { GripHorizontal, MoreHorizontal } from 'lucide-react';
import { CardBackground } from '../common/CardBackground';
import { getTextShadow } from '../../utils/style';
import { useSettingsStore } from '../../store/useSettingsStore';

export const CardListPreview = ({ styleType = 'standard' }) => {
  const {
    previewCardFont,
    previewCardTextColor,
    previewBackTextColor,
    previewCardFontSize,
    previewBackFontSize,
    previewCardFontWeight,
    previewCardFontStyle,
    previewTextShadow,
    previewCardTextAlign,
    previewCardLines,
  } = useSettingsStore();

  const frontShadow = getTextShadow(previewTextShadow, previewCardTextColor || '#ffffff');
  const backShadow = getTextShadow(previewTextShadow, previewBackTextColor || '#cbd5e1');

  const lines = previewCardLines === 0 ? 'unset' : (previewCardLines || 2);
  const clampStyle = previewCardLines === 0 ? {
    display: 'block',
    WebkitLineClamp: 'unset',
    lineClamp: 'unset',
    overflow: 'visible'
  } : {
    display: '-webkit-box',
    WebkitLineClamp: lines,
    lineClamp: lines,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden'
  };

  return (
    <div 
      className="card-list-live-preview-box"
      style={{
        margin: '10px 0 18px 0',
        padding: '12px',
        borderRadius: '20px',
        background: 'rgba(15, 23, 42, 0.4)',
        border: '1px solid rgba(255, 255, 255, 0.08)'
      }}
    >
      <div 
        className="card-item card-front glass"
        style={{
          margin: 0,
          position: 'relative',
          overflow: 'hidden',
          cursor: 'default',
          userSelect: 'none'
        }}
      >
        <CardBackground styleType={styleType} />

        <div className="card-item-text" style={{ position: 'relative', zIndex: 1 }}>
          <div 
            className="front-min"
            style={{
              fontFamily: previewCardFont || undefined,
              color: previewCardTextColor || '#ffffff',
              fontSize: `${previewCardFontSize || 1.08}rem`,
              fontWeight: previewCardFontWeight || 600,
              fontStyle: previewCardFontStyle || 'normal',
              textShadow: frontShadow,
              textAlign: previewCardTextAlign || 'left',
              lineHeight: 1.4,
              ...clampStyle
            }}
          >
            Guten Tag! Wie geht es Ihnen heute? Ich freue mich, Sie kennenzulernen. ✨
          </div>

          <div 
            className="back-min"
            style={{
              fontFamily: previewCardFont || undefined,
              color: previewBackTextColor || '#cbd5e1',
              fontSize: `${previewBackFontSize || 0.98}rem`,
              fontWeight: 500,
              fontStyle: previewCardFontStyle || 'normal',
              textShadow: backShadow,
              textAlign: previewCardTextAlign || 'left',
              lineHeight: 1.4,
              marginTop: '6px',
              paddingTop: '6px',
              borderTop: '1px dashed rgba(255, 255, 255, 0.08)',
              ...clampStyle
            }}
          >
            Добрый день! Как ваши дела сегодня? Очень рад с вами познакомиться.
          </div>
        </div>

        <div className="card-item-footer" style={{ marginTop: '8px', position: 'relative', zIndex: 1 }}>
          <div className="card-item-footer-left" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div 
              className="deck-drag-handle-bottom" 
              style={{ width: '34px', height: '28px', pointerEvents: 'none' }}
            >
              <GripHorizontal size={18} />
            </div>
            <span style={{ 
              fontSize: '0.68rem', 
              fontWeight: 700, 
              color: '#38bdf8', 
              background: 'rgba(56, 189, 248, 0.15)', 
              border: '1px solid rgba(56, 189, 248, 0.3)', 
              borderRadius: '6px', 
              padding: '2px 6px' 
            }}>
              Уровень 1
            </span>
          </div>

          <div className="card-item-footer-right" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
            <span className="card-item-corner-number" style={{ height: '28px', fontSize: '0.75rem' }}>
              1
            </span>
            <div 
              className="card-item-actions-trigger" 
              style={{ width: '28px', height: '28px', pointerEvents: 'none' }}
            >
              <MoreHorizontal size={16} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

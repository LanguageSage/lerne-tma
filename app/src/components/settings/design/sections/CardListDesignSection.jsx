import React, { useState } from 'react';
import { tr } from '../../../../i18n/locale';
import { TypographyControls } from '../controls/TypographyControls';
import { ColorControl } from '../controls/ColorControl';
import { SliderControl } from '../controls/SliderControl';
import { DesignPreviewScope } from '../DesignPreviewScope';
import { CARD_LIST_BG_PRESETS } from '../../../../constants/appConstants';
import { getCardListBgStyle, CARD_LIST_PRESET_GRADIENTS } from '../../../../utils/style';
import { useSettingsStore } from '../../../../store/useSettingsStore';

export const CardListDesignSection = React.memo(({ config, onChangeField }) => {
  const [subTab, setSubTab] = useState('frontText'); // 'frontText' | 'backText' | 'divider' | 'cardBg'
  const cardList = config?.cardList || {};
  const previewCardBg = useSettingsStore(s => s.previewCardBg);
  const currentCardBg = cardList.card?.bg || previewCardBg || 'rgba(15,23,42,0.55)';
  const liveCardListBg = getCardListBgStyle(currentCardBg);

  const handleSelectBg = (val) => {
    onChangeField('cardList.card.bg', val);
  };

  return (
    <div className="card-list-design-section">
      {/* Live Preview of CardList Item */}
      <DesignPreviewScope>
        <div style={{
          background: 'rgba(15, 23, 42, 0.4)',
          borderRadius: '20px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '12px',
          marginBottom: '20px'
        }}>
          <div 
            className={`card-item card-front glass ${liveCardListBg.className || ''}`}
            style={{
              borderRadius: 'var(--design-cl-card-radius, 12px)',
              border: 'var(--design-cl-card-bw, 1px) solid var(--design-cl-card-border, rgba(255,255,255,0.08))',
              padding: 'var(--design-cl-card-padding, 12px 14px)',
              position: 'relative',
              ...liveCardListBg.style
            }}
          >
            {/* Front text */}
            <div style={{
              fontFamily: 'var(--design-cl-front-font)',
              fontSize: 'var(--design-cl-front-size)',
              fontWeight: 'var(--design-cl-front-weight)',
              fontStyle: 'var(--design-cl-front-style, normal)',
              color: 'var(--design-cl-front-color)',
              textAlign: 'var(--design-cl-front-align)',
              lineHeight: 'var(--design-cl-front-lh, 1.4)'
            }}>
              Guten Tag! Wie geht es Ihnen heute? Ich freue mich, Sie kennenzulernen. ✨
            </div>

            {/* Divider */}
            <div style={{
              height: 'var(--design-cl-divider-width, 1px)',
              background: 'var(--design-cl-divider-color, rgba(255,255,255,0.08))',
              opacity: 'var(--design-cl-divider-opacity, 1)',
              margin: '8px 0'
            }} />

            {/* Back text */}
            <div style={{
              fontFamily: 'var(--design-cl-back-font)',
              fontSize: 'var(--design-cl-back-size)',
              fontWeight: 'var(--design-cl-back-weight)',
              color: 'var(--design-cl-back-color)',
              textAlign: 'var(--design-cl-back-align)',
              lineHeight: 'var(--design-cl-back-lh, 1.4)'
            }}>
              {tr('Добрый день! Как ваши дела сегодня? Очень рад с вами познакомиться.')}
            </div>
          </div>
        </div>
      </DesignPreviewScope>

      {/* Sub tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'frontText' ? 'active' : ''}`}
          onClick={() => setSubTab('frontText')}
          style={{ flex: 1, minWidth: '70px', padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Лицевая сторона')}
        </button>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'backText' ? 'active' : ''}`}
          onClick={() => setSubTab('backText')}
          style={{ flex: 1, minWidth: '70px', padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Обратная сторона')}
        </button>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'divider' ? 'active' : ''}`}
          onClick={() => setSubTab('divider')}
          style={{ flex: 1, minWidth: '70px', padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Разделитель')}
        </button>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'cardBg' ? 'active' : ''}`}
          onClick={() => setSubTab('cardBg')}
          style={{ flex: 1, minWidth: '70px', padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Цвет фона')}
        </button>
      </div>

      {subTab === 'frontText' && (
        <div>
          <TypographyControls
            title={tr('Текст лицевой стороны (список карточек)')}
            typography={cardList.frontText}
            onChangeField={(field, val) => onChangeField(`cardList.frontText.${field}`, val)}
            minSize={0.75}
            maxSize={2.0}
          />
          <SliderControl
            label={tr('Ограничение строк (0 = без ограничений)')}
            value={cardList.frontText?.lines !== undefined ? Number(cardList.frontText.lines) : 3}
            min={0}
            max={8}
            step={1}
            unit={tr('строк')}
            onChange={val => onChangeField('cardList.frontText.lines', val)}
          />
        </div>
      )}

      {subTab === 'backText' && (
        <div>
          <TypographyControls
            title={tr('Текст обратной стороны (список карточек)')}
            typography={cardList.backText}
            onChangeField={(field, val) => onChangeField(`cardList.backText.${field}`, val)}
            minSize={0.7}
            maxSize={1.8}
          />
        </div>
      )}

      {subTab === 'divider' && (
        <div>
          <ColorControl
            label={tr('Цвет разделителя')}
            value={cardList.divider?.color || 'rgba(255,255,255,0.08)'}
            onChange={val => onChangeField('cardList.divider.color', val)}
          />
          <SliderControl
            label={tr('Прозрачность разделителя')}
            value={Number(cardList.divider?.opacity) || 1}
            min={0}
            max={1}
            step={0.05}
            unit=""
            onChange={val => onChangeField('cardList.divider.opacity', val)}
          />
        </div>
      )}

      {subTab === 'cardBg' && (
        <div className="design-cardlist-bg-controls">
          {/* Preset themes */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 500, marginBottom: '8px', display: 'block' }}>
              {tr('Готовые темы фона')}
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px' }}>
              {CARD_LIST_BG_PRESETS.map(preset => {
                const isSelected = currentCardBg === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`btn-secondary btn-tiny ${isSelected ? 'active' : ''}`}
                    onClick={() => handleSelectBg(preset.id)}
                    style={{
                      padding: '8px 10px',
                      fontSize: '0.78rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      border: isSelected ? '1px solid #a855f7' : '1px solid rgba(255,255,255,0.1)',
                      background: isSelected ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.04)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <span
                      style={{
                        width: '14px',
                        height: '14px',
                        borderRadius: '50%',
                        background: CARD_LIST_PRESET_GRADIENTS[preset.id] || preset.accent,
                        flexShrink: 0,
                        border: '1px solid rgba(255,255,255,0.3)'
                      }}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ColorControl: Palette + Rainbow custom color picker */}
          <ColorControl
            label={tr('Выбор цвета фона')}
            value={
              currentCardBg && !CARD_LIST_BG_PRESETS.some(p => p.id === currentCardBg)
                ? currentCardBg
                : '#1e293b'
            }
            onChange={handleSelectBg}
          />
        </div>
      )}
    </div>
  );
});

CardListDesignSection.displayName = 'CardListDesignSection';

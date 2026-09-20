import React, { useState } from 'react';
import { tr } from '../../../../i18n/locale';
import { TypographyControls } from '../controls/TypographyControls';
import { ColorControl } from '../controls/ColorControl';
import { SliderControl } from '../controls/SliderControl';
import { DesignPreviewScope } from '../DesignPreviewScope';

export const CardListDesignSection = React.memo(({ config, onChangeField }) => {
  const [subTab, setSubTab] = useState('frontText'); // 'frontText' | 'backText' | 'divider'
  const cardList = config?.cardList || {};

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
          <div style={{
            background: 'var(--design-glass-bg, rgba(255,255,255,0.05))',
            borderRadius: 'var(--design-cl-card-radius, 12px)',
            border: 'var(--design-cl-card-bw, 1px) solid var(--design-cl-card-border, rgba(255,255,255,0.08))',
            padding: 'var(--design-cl-card-padding, 12px 14px)',
            position: 'relative'
          }}>
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
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'frontText' ? 'active' : ''}`}
          onClick={() => setSubTab('frontText')}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Лицевая сторона')}
        </button>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'backText' ? 'active' : ''}`}
          onClick={() => setSubTab('backText')}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Обратная сторона')}
        </button>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'divider' ? 'active' : ''}`}
          onClick={() => setSubTab('divider')}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Разделитель')}
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
    </div>
  );
});

CardListDesignSection.displayName = 'CardListDesignSection';

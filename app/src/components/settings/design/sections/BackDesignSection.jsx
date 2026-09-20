import React, { useState } from 'react';
import { tr } from '../../../../i18n/locale';
import { TypographyControls } from '../controls/TypographyControls';
import { SurfaceControls } from '../controls/SurfaceControls';
import { ColorControl } from '../controls/ColorControl';
import { SliderControl } from '../controls/SliderControl';
import { DesignPreviewScope } from '../DesignPreviewScope';

export const BackDesignSection = React.memo(({ config, onChangeField }) => {
  const [subTab, setSubTab] = useState('answerText'); // 'answerText' | 'context' | 'card' | 'reference'
  const back = config?.back || {};

  return (
    <div className="back-design-section">
      {/* Live Preview of Back Card */}
      <DesignPreviewScope>
        <div style={{
          background: 'linear-gradient(145deg, #1e1b4b, #0f172a)',
          border: 'var(--design-back-card-bw, 1px) solid var(--design-back-card-border, rgba(196,181,253,0.17))',
          borderRadius: 'var(--design-back-card-radius, 20px)',
          boxShadow: 'var(--design-back-card-shadow, none)',
          padding: 'var(--design-back-card-padding, 16px)',
          marginBottom: '20px',
          minHeight: '140px',
          position: 'relative'
        }}>
          {/* Reference text (original phrase) */}
          <div style={{
            fontFamily: 'var(--design-ref-font)',
            fontSize: 'var(--design-ref-font-size)',
            fontWeight: 'var(--design-ref-weight)',
            fontStyle: 'var(--design-ref-style)',
            color: 'var(--design-ref-color)',
            textAlign: 'var(--design-ref-align)',
            opacity: 0.8,
            marginBottom: '10px'
          }}>
            Ich interessiere mich sehr für diese Stelle.
          </div>

          {/* Separator line */}
          <div style={{
            height: 'var(--design-sep-width, 1px)',
            background: 'var(--design-sep-color, rgba(255,255,255,0.12))',
            opacity: 'var(--design-sep-opacity, 1)',
            margin: '10px 0'
          }} />

          {/* Answer text (translation) */}
          <div style={{
            fontFamily: 'var(--design-back-font)',
            fontSize: 'var(--design-back-font-size)',
            fontWeight: 'var(--design-back-weight)',
            fontStyle: 'var(--design-back-style)',
            color: 'var(--design-back-color)',
            textAlign: 'var(--design-back-align)',
            lineHeight: 'var(--design-back-lh)',
            marginBottom: '12px'
          }}>
            Я очень интересуюсь этой должностью.
          </div>

          {/* Context block */}
          <div style={{
            fontFamily: 'var(--design-ctx-font)',
            fontSize: 'var(--design-ctx-font-size)',
            fontWeight: 'var(--design-ctx-weight)',
            fontStyle: 'var(--design-ctx-style)',
            color: 'var(--design-ctx-color)',
            textAlign: 'var(--design-ctx-align)',
            lineHeight: 'var(--design-ctx-lh)',
            background: 'rgba(255,255,255,0.04)',
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.06)'
          }}>
            {tr('Пример контекста: Bewerbung um eine Arbeitsstelle.')}
          </div>
        </div>
      </DesignPreviewScope>

      {/* Sub tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'answerText' ? 'active' : ''}`}
          onClick={() => setSubTab('answerText')}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Ответ / Перевод')}
        </button>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'context' ? 'active' : ''}`}
          onClick={() => setSubTab('context')}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Контекст')}
        </button>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'reference' ? 'active' : ''}`}
          onClick={() => setSubTab('reference')}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Исходный текст')}
        </button>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'card' ? 'active' : ''}`}
          onClick={() => setSubTab('card')}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Карточка')}
        </button>
      </div>

      {subTab === 'answerText' && (
        <TypographyControls
          title={tr('Основной ответ (перевод)')}
          typography={back.answerText}
          onChangeField={(field, val) => onChangeField(`back.answerText.${field}`, val)}
          minSize={0.8}
          maxSize={2.8}
        />
      )}

      {subTab === 'context' && (
        <TypographyControls
          title={tr('Контекст / Примеры предложений')}
          typography={back.context}
          onChangeField={(field, val) => onChangeField(`back.context.${field}`, val)}
          minSize={0.75}
          maxSize={2.4}
          allowAutoColor={true}
          isAutoColor={back.context?.color === 'auto'}
          onAutoColorToggle={() => onChangeField('back.context.color', back.context?.color === 'auto' ? '#94a3b8' : 'auto')}
        />
      )}

      {subTab === 'reference' && (
        <TypographyControls
          title={tr('Мини-вопрос вверху обратной стороны')}
          typography={back.referenceText}
          onChangeField={(field, val) => onChangeField(`back.referenceText.${field}`, val)}
          minSize={0.8}
          maxSize={2.4}
        />
      )}

      {subTab === 'card' && (
        <div>
          <SurfaceControls
            title={tr('Поверхность обратной стороны')}
            surface={back.card}
            onChangeField={(field, val) => onChangeField(`back.card.${field}`, val)}
          />
          <h4 style={{ fontSize: '0.95rem', color: '#e2e8f0', margin: '14px 0 10px 0', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }}>
            {tr('Линия-разделитель')}
          </h4>
          <ColorControl
            label={tr('Цвет разделителя')}
            value={back.separator?.color || 'rgba(255,255,255,0.12)'}
            onChange={val => onChangeField('back.separator.color', val)}
          />
          <SliderControl
            label={tr('Прозрачность разделителя')}
            value={Number(back.separator?.opacity) || 1}
            min={0}
            max={1}
            step={0.05}
            unit=""
            onChange={val => onChangeField('back.separator.opacity', val)}
          />
        </div>
      )}
    </div>
  );
});

BackDesignSection.displayName = 'BackDesignSection';

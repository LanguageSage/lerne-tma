import React, { useState } from 'react';
import { CardBackground } from '../../../common/CardBackground';
import { getDesignStylesFromV2 } from '../../../../utils/cardStyles';
import { useSettingsStore } from '../../../../store/useSettingsStore';
import { tr } from '../../../../i18n/locale';
import { TypographyControls } from '../controls/TypographyControls';
import { SurfaceControls } from '../controls/SurfaceControls';
import { DesignPreviewScope } from '../DesignPreviewScope';

export const BackDesignSection = React.memo(({ config, onChangeField }) => {
  const [subTab, setSubTab] = useState('answerText');
  const back = config?.back || {};
  const fallbackBackground = useSettingsStore(s => s.personalDesignV2?.config?.back?.card?.background);
  const textStyles = getDesignStylesFromV2(config);

  return (
    <div className="back-design-section">
      {/* Live Preview of Back Card */}
      <DesignPreviewScope>
        <div className="card-back" style={{
          overflow: 'hidden', isolation: 'isolate',
          background: 'linear-gradient(145deg, #25263f, #111b30)',
          border: 'var(--design-back-card-bw, 1px) solid var(--design-back-card-border, rgba(196,181,253,0.17))',
          borderRadius: 'var(--design-back-card-radius, 20px)',
          boxShadow: 'var(--design-back-card-shadow, none)',
          padding: 'var(--design-back-card-padding, 16px)',
          marginBottom: '20px',
          minHeight: '140px',
          position: 'relative'
        }}>
          <CardBackground background={back.card?.background} styleType={fallbackBackground} cardId={1} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ ...textStyles.backText, marginBottom: '12px' }}>
              Я очень интересуюсь этой должностью.
            </div>

            <div style={{
              ...textStyles.contextText,
              background: 'rgba(255,255,255,0.04)',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.06)'
            }}>
              {tr('Пример контекста: Bewerbung um eine Arbeitsstelle.')}
            </div>
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

      {subTab === 'card' && (
        <SurfaceControls
          title={tr('Поверхность обратной стороны')}
          surface={back.card}
          onChangeField={(field, val) => onChangeField(`back.card.${field}`, val)}
        />
      )}
    </div>
  );
});

BackDesignSection.displayName = 'BackDesignSection';

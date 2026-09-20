import React, { useState } from 'react';
import { tr } from '../../../../i18n/locale';
import { TypographyControls } from '../controls/TypographyControls';
import { SurfaceControls } from '../controls/SurfaceControls';
import { ColorControl } from '../controls/ColorControl';
import { SliderControl } from '../controls/SliderControl';
import { DesignPreviewScope } from '../DesignPreviewScope';
import { ExerciseInfoBlocks } from '../../../study/ExerciseInfoBlocks';

export const FrontDesignSection = React.memo(({ config, onChangeField }) => {
  const [subTab, setSubTab] = useState('mainText'); // 'mainText' | 'card' | 'infoBlocks'
  const front = config?.front || {};

  // Mock content for live preview
  const previewInfoContent = {
    blocks: [
      { type: 'task', content: 'Wählen Sie die richtige Option aus.' },
      { type: 'source', content: 'Goethe B1 Prüfung — Teil 2' },
      { type: 'example', content: 'Er geht jeden Morgen um 8 Uhr zur Arbeit.' },
      { type: 'options', content: 'weil, obwohl, deshalb, trotzdem', options: ['weil', 'obwohl', 'deshalb', 'trotzdem'] }
    ]
  };

  return (
    <div className="front-design-section">
      {/* Live Preview of Front Card */}
      <DesignPreviewScope>
        <div style={{
          background: 'linear-gradient(145deg, #25263f, #111b30)',
          border: 'var(--design-front-card-bw, 1px) solid var(--design-front-card-border, rgba(196,181,253,0.3))',
          borderRadius: 'var(--design-front-card-radius, 20px)',
          boxShadow: 'var(--design-front-card-shadow, 0 16px 32px -16px rgba(0,0,0,0.65))',
          padding: 'var(--design-front-card-padding, 16px)',
          marginBottom: '20px',
          minHeight: '140px',
          position: 'relative'
        }}>
          {/* Information blocks preview */}
          <ExerciseInfoBlocks content={previewInfoContent} />

          {/* Main Card Text */}
          <div style={{
            fontFamily: 'var(--design-front-font)',
            fontSize: 'var(--design-front-font-size)',
            fontWeight: 'var(--design-front-weight)',
            fontStyle: 'var(--design-front-style)',
            color: 'var(--design-front-color)',
            textAlign: 'var(--design-front-align)',
            lineHeight: 'var(--design-front-lh)',
            margin: '14px 0'
          }}>
            Ich interessiere mich sehr für diese Stelle.
          </div>
        </div>
      </DesignPreviewScope>

      {/* Sub tabs: Основной текст / Рамка карточки / Инфо-блоки */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'mainText' ? 'active' : ''}`}
          onClick={() => setSubTab('mainText')}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Основной текст')}
        </button>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'card' ? 'active' : ''}`}
          onClick={() => setSubTab('card')}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Карточка')}
        </button>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'infoBlocks' ? 'active' : ''}`}
          onClick={() => setSubTab('infoBlocks')}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Инфо-блоки')}
        </button>
      </div>

      {subTab === 'mainText' && (
        <TypographyControls
          title={tr('Основной текст карточки')}
          typography={front.mainText}
          onChangeField={(field, val) => onChangeField(`front.mainText.${field}`, val)}
          minSize={0.9}
          maxSize={3.0}
        />
      )}

      {subTab === 'card' && (
        <SurfaceControls
          title={tr('Свойства поверхности карточки')}
          surface={front.card}
          onChangeField={(field, val) => onChangeField(`front.card.${field}`, val)}
        />
      )}

      {subTab === 'infoBlocks' && (
        <div className="design-info-blocks-controls">
          {/* Task block controls */}
          <h4 style={{ fontSize: '0.9rem', color: '#38bdf8', margin: '14px 0 8px 0' }}>
            ::task ({tr('Задание')})
          </h4>
          <ColorControl
            label={tr('Цвет текста')}
            value={front.task?.color || '#94a3b8'}
            onChange={val => onChangeField('front.task.color', val)}
          />
          <SliderControl
            label={tr('Размер шрифта')}
            value={front.task?.size || 0.88}
            min={0.65}
            max={1.5}
            step={0.02}
            onChange={val => onChangeField('front.task.size', val)}
          />

          {/* Example block controls */}
          <h4 style={{ fontSize: '0.9rem', color: '#c084fc', margin: '18px 0 8px 0' }}>
            ::example ({tr('Пример')})
          </h4>
          <ColorControl
            label={tr('Цвет текста')}
            value={front.example?.color || '#94a3b8'}
            onChange={val => onChangeField('front.example.color', val)}
          />
          <SliderControl
            label={tr('Размер шрифта')}
            value={front.example?.size || 0.88}
            min={0.65}
            max={1.5}
            step={0.02}
            onChange={val => onChangeField('front.example.size', val)}
          />

          {/* Options chips controls */}
          <h4 style={{ fontSize: '0.9rem', color: '#4ade80', margin: '18px 0 8px 0' }}>
            ::options ({tr('Чипы вариантов')})
          </h4>
          <ColorControl
            label={tr('Цвет текста чипа')}
            value={front.options?.chip?.color || '#e2e8f0'}
            onChange={val => onChangeField('front.options.chip.color', val)}
          />
          <ColorControl
            label={tr('Цвет фона чипа')}
            value={front.options?.chip?.bg || 'rgba(255,255,255,0.06)'}
            onChange={val => onChangeField('front.options.chip.bg', val)}
          />
          <SliderControl
            label={tr('Размер шрифта чипа')}
            value={front.options?.chip?.size || 0.88}
            min={0.65}
            max={1.3}
            step={0.02}
            onChange={val => onChangeField('front.options.chip.size', val)}
          />
        </div>
      )}
    </div>
  );
});

FrontDesignSection.displayName = 'FrontDesignSection';

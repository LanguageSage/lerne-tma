import React, { useState } from 'react';
import { tr } from '../../../../i18n/locale';
import { ColorControl } from '../controls/ColorControl';
import { SliderControl } from '../controls/SliderControl';
import { DesignPreviewScope } from '../DesignPreviewScope';

export const ExerciseDesignSection = React.memo(({ config, onChangeField }) => {
  const [previewType, setPreviewType] = useState('quiz'); // 'quiz' | 'cloze' | 'match' | 'wordBank'
  const [subTab, setSubTab] = useState('palette'); // 'palette' | 'choice' | 'cloze' | 'match' | 'wordBank'
  const ex = config?.exercises || {};
  const isAutoPalette = ex.paletteMode === 'auto';

  return (
    <div className="exercise-design-section">
      {/* Exercise Live Preview */}
      <DesignPreviewScope>
        <div style={{
          background: 'linear-gradient(145deg, #25263f, #111b30)',
          borderRadius: '20px',
          border: '1px solid rgba(196,181,253,0.3)',
          padding: '16px',
          marginBottom: '20px',
          boxShadow: '0 16px 32px -16px rgba(0,0,0,0.65)'
        }}>
          {/* Switch preview mode */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
            {['quiz', 'cloze', 'match', 'wordBank'].map(type => (
              <button
                key={type}
                type="button"
                className={`btn-secondary btn-tiny ${previewType === type ? 'active' : ''}`}
                onClick={() => setPreviewType(type)}
                style={{ fontSize: '0.75rem', padding: '4px 8px', borderRadius: '12px' }}
              >
                {type === 'quiz' && tr('Тест / Выбор')}
                {type === 'cloze' && tr('Пропуск')}
                {type === 'match' && tr('Пары')}
                {type === 'wordBank' && tr('Банк слов')}
              </button>
            ))}
          </div>

          {/* Quiz Preview */}
          {previewType === 'quiz' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1px solid var(--design-choice-normal-border, rgba(255,255,255,0.12))',
                background: 'var(--design-choice-normal-bg, rgba(15,23,42,0.55))',
                color: 'var(--design-choice-normal-color, #e2e8f0)',
                fontSize: '0.9rem'
              }}>
                A) Обычный вариант ответа (normal)
              </div>
              <div style={{
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1px solid var(--design-choice-selected-border, rgba(167,139,250,0.35))',
                background: 'var(--design-choice-selected-bg, rgba(167,139,250,0.18))',
                color: 'var(--design-choice-selected-color, #a78bfa)',
                fontSize: '0.9rem'
              }}>
                B) Выбранный вариант (selected)
              </div>
              <div style={{
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1px solid var(--design-choice-correct-border, rgba(34,197,94,0.35))',
                background: 'var(--design-choice-correct-bg, rgba(34,197,94,0.18))',
                color: 'var(--design-choice-correct-color, #4ade80)',
                fontSize: '0.9rem'
              }}>
                C) Правильный ответ (correct) ✓
              </div>
              <div style={{
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1px solid var(--design-choice-wrong-border, rgba(239,68,68,0.35))',
                background: 'var(--design-choice-wrong-bg, rgba(239,68,68,0.18))',
                color: 'var(--design-choice-wrong-color, #f87171)',
                fontSize: '0.9rem'
              }}>
                D) Неверный ответ (wrong) ✕
              </div>
            </div>
          )}

          {/* Cloze Preview */}
          {previewType === 'cloze' && (
            <div style={{ fontSize: '1.05rem', lineHeight: 1.8, color: '#f8fafc' }}>
              <span>Ich lebe </span>
              <span style={{
                display: 'inline-block',
                padding: '2px 10px',
                borderRadius: '8px',
                border: '1px solid var(--design-cloze-gap-border, rgba(255,255,255,0.4))',
                background: 'var(--design-cloze-gap-bg, rgba(255,255,255,0.05))',
                color: 'var(--design-cloze-gap-color, rgba(255,255,255,0.5))'
              }}>
                [ пустой пропуск ]
              </span>
              <span> seit vielen Jahren in Deutschland. </span>
              <div style={{ marginTop: '10px' }}>
                <span>Richtig: </span>
                <span style={{
                  display: 'inline-block',
                  padding: '2px 10px',
                  borderRadius: '8px',
                  border: '1px solid var(--design-cloze-correct-border, #22c55e)',
                  background: 'var(--design-cloze-correct-bg, rgba(34,197,94,0.2))',
                  color: 'var(--design-cloze-correct-color, #4ade80)'
                }}>
                  seit ✓
                </span>
              </div>
            </div>
          )}

          {/* Match Preview */}
          {previewType === 'match' && (
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'var(--design-match-selected-bg, rgba(167,139,250,0.18))', border: '1px solid #a78bfa', color: '#a78bfa', fontSize: '0.85rem' }}>
                  die Katze (selected)
                </div>
                <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'var(--design-match-matched-bg, rgba(34,197,94,0.15))', border: '1px solid #22c55e', color: '#4ade80', fontSize: '0.85rem' }}>
                  der Hund (matched)
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'var(--design-match-item-bg, rgba(255,255,255,0.06))', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0', fontSize: '0.85rem' }}>
                  кошка
                </div>
                <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'var(--design-match-matched-bg, rgba(34,197,94,0.15))', border: '1px solid #22c55e', color: '#4ade80', fontSize: '0.85rem' }}>
                  собака
                </div>
              </div>
            </div>
          )}

          {/* Word Bank Preview */}
          {previewType === 'wordBank' && (
            <div style={{
              background: 'var(--design-wb-word-bg, rgba(255,255,255,0.03))',
              padding: '12px',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px'
            }}>
              <span style={{ padding: '4px 10px', borderRadius: '8px', background: 'var(--design-wb-word-bg, rgba(255,255,255,0.07))', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0', fontSize: '0.85rem' }}>
                gestern
              </span>
              <span style={{ padding: '4px 10px', borderRadius: '8px', background: 'var(--design-wb-selected-bg, rgba(167,139,250,0.18))', border: '1px solid rgba(167,139,250,0.35)', color: '#a78bfa', fontSize: '0.85rem' }}>
                heute (selected)
              </span>
              <span style={{ padding: '4px 10px', borderRadius: '8px', background: 'var(--design-correct-bg, rgba(34,197,94,0.18))', border: '1px solid rgba(34,197,94,0.35)', color: '#4ade80', fontSize: '0.85rem' }}>
                morgen (correct)
              </span>
            </div>
          )}
        </div>
      </DesignPreviewScope>

      {/* Sub tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'palette' ? 'active' : ''}`}
          onClick={() => setSubTab('palette')}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Режим палитры')}
        </button>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'choice' ? 'active' : ''}`}
          onClick={() => setSubTab('choice')}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Тесты / Выбор')}
        </button>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'cloze' ? 'active' : ''}`}
          onClick={() => setSubTab('cloze')}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Пропуски')}
        </button>
      </div>

      {/* Palette Mode */}
      {subTab === 'palette' && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div>
              <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.9rem' }}>
                {tr('Гармоничная палитра (Auto)')}
              </span>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>
                {isAutoPalette
                  ? tr('Цвета вариантов вычисляются автоматически из базового цвета')
                  : tr('Все цвета вариантов настраиваются вручную')}
              </p>
            </div>
            <button
              type="button"
              className={`btn-secondary btn-tiny ${isAutoPalette ? 'active' : ''}`}
              onClick={() => onChangeField('exercises.paletteMode', isAutoPalette ? 'manual' : 'auto')}
              style={{ padding: '6px 14px', borderRadius: '16px' }}
            >
              {isAutoPalette ? `✨ ${tr('Авто')}` : tr('Вручную')}
            </button>
          </div>

          <ColorControl
            label={tr('Базовый цвет гармонии упражнений')}
            value={ex.baseColor || '#fde047'}
            onChange={val => onChangeField('exercises.baseColor', val)}
          />
        </div>
      )}

      {/* Choice States */}
      {subTab === 'choice' && (
        <div>
          <h4 style={{ fontSize: '0.9rem', color: '#4ade80', margin: '0 0 10px 0' }}>
            ✓ {tr('Правильный ответ (Correct state)')}
          </h4>
          <ColorControl
            label={tr('Цвет текста')}
            value={ex.choice?.correct?.color || '#4ade80'}
            onChange={val => onChangeField('exercises.choice.correct.color', val)}
          />
          <ColorControl
            label={tr('Цвет фона')}
            value={ex.choice?.correct?.bg || 'rgba(34,197,94,0.18)'}
            onChange={val => onChangeField('exercises.choice.correct.bg', val)}
          />

          <h4 style={{ fontSize: '0.9rem', color: '#f87171', margin: '16px 0 10px 0' }}>
            ✕ {tr('Неверный ответ (Wrong state)')}
          </h4>
          <ColorControl
            label={tr('Цвет текста')}
            value={ex.choice?.wrong?.color || '#f87171'}
            onChange={val => onChangeField('exercises.choice.wrong.color', val)}
          />
          <ColorControl
            label={tr('Цвет фона')}
            value={ex.choice?.wrong?.bg || 'rgba(239,68,68,0.18)'}
            onChange={val => onChangeField('exercises.choice.wrong.bg', val)}
          />

          <h4 style={{ fontSize: '0.9rem', color: '#a78bfa', margin: '16px 0 10px 0' }}>
            ◉ {tr('Выбранный вариант (Selected state)')}
          </h4>
          <ColorControl
            label={tr('Цвет текста')}
            value={ex.choice?.selected?.color || '#a78bfa'}
            onChange={val => onChangeField('exercises.choice.selected.color', val)}
          />
          <ColorControl
            label={tr('Цвет фона')}
            value={ex.choice?.selected?.bg || 'rgba(167,139,250,0.18)'}
            onChange={val => onChangeField('exercises.choice.selected.bg', val)}
          />
        </div>
      )}

      {/* Cloze Gap */}
      {subTab === 'cloze' && (
        <div>
          <h4 style={{ fontSize: '0.9rem', color: '#94a3b8', margin: '0 0 10px 0' }}>
            {tr('Пустой пропуск (Gap)')}
          </h4>
          <ColorControl
            label={tr('Цвет рамки')}
            value={ex.clozeGap?.gap?.borderColor || 'rgba(255,255,255,0.4)'}
            onChange={val => onChangeField('exercises.clozeGap.gap.borderColor', val)}
          />
          <ColorControl
            label={tr('Цвет фона')}
            value={ex.clozeGap?.gap?.bg || 'rgba(255,255,255,0.05)'}
            onChange={val => onChangeField('exercises.clozeGap.gap.bg', val)}
          />

          <h4 style={{ fontSize: '0.9rem', color: '#4ade80', margin: '16px 0 10px 0' }}>
            ✓ {tr('Правильно заполненный пропуск')}
          </h4>
          <ColorControl
            label={tr('Цвет текста')}
            value={ex.clozeGap?.correct?.color || '#4ade80'}
            onChange={val => onChangeField('exercises.clozeGap.correct.color', val)}
          />
          <ColorControl
            label={tr('Цвет фона')}
            value={ex.clozeGap?.correct?.bg || 'rgba(34,197,94,0.2)'}
            onChange={val => onChangeField('exercises.clozeGap.correct.bg', val)}
          />
        </div>
      )}
    </div>
  );
});

ExerciseDesignSection.displayName = 'ExerciseDesignSection';

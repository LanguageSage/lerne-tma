import React, { useState } from 'react';
import { tr } from '../../../../i18n/locale';
import { ColorControl } from '../controls/ColorControl';
import { SliderControl } from '../controls/SliderControl';
import { DesignPreviewScope } from '../DesignPreviewScope';
import { FONT_OPTIONS } from '../designConstants';
import { ExerciseRenderer } from '../../../study/ExerciseRenderer.jsx';

const PREVIEW_CARDS = {
  quiz: { id: 'design-quiz', front: 'Welche Antwort passt?\n\n- Gestern\n* Heute\n- Morgen', back: '' },
  match: { id: 'design-match', front: '@match\ndie Katze => кошка\nder Hund => собака\nder Vogel => птица', back: '' },
};

export const ExerciseDesignSection = React.memo(({ config, onChangeField }) => {
  const [previewType, setPreviewType] = useState('quiz'); // 'quiz' | 'cloze' | 'match' | 'wordBank'
  const [previewRevision, setPreviewRevision] = useState(0);
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
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

          {/* Use the real renderer in the existing preview surface. */}
          {['quiz', 'match'].includes(previewType) && <>
            <ExerciseRenderer key={`${previewType}:${previewRevision}`}
              card={PREVIEW_CARDS[previewType]} designConfig={config} />
            <button type="button" className="btn-secondary btn-tiny"
              onClick={() => setPreviewRevision(value => value + 1)}>{tr('Сбросить')}</button>
          </>}

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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
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
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'gapDropdown' ? 'active' : ''}`}
          onClick={() => setSubTab('gapDropdown')}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Меню')}
        </button>
        <button type="button" className={`btn-secondary btn-tiny ${subTab === 'match' ? 'active' : ''}`}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
          onClick={() => setSubTab('match')}>{tr('Пары')}</button>
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

      {/* Separate exercise-state controls; main typography stays in Front. */}
      {['choice', 'match'].includes(subTab) && (
        <div>
          {(subTab === 'choice' ? ['normal', 'selected', 'correct', 'wrong', 'disabled']
            : ['item', 'selected', 'matched', 'wrong', 'disabled']).map(state => (
            <fieldset key={state} style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
              <legend>{state}</legend>
              <ColorControl label={tr('Цвет текста')} value={ex[subTab][state].color}
                onChange={value => onChangeField(`exercises.${subTab}.${state}.color`, value)} />
              <ColorControl label={tr('Цвет фона')} value={ex[subTab][state].bg}
                onChange={value => onChangeField(`exercises.${subTab}.${state}.bg`, value)} />
              <ColorControl label={tr('Цвет рамки')} value={ex[subTab][state].borderColor}
                onChange={value => onChangeField(`exercises.${subTab}.${state}.borderColor`, value)} />
            </fieldset>
          ))}
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

      {/* Gap Dropdown Menu */}
      {subTab === 'gapDropdown' && (
        <div>
          <h4 style={{ fontSize: '0.9rem', color: '#f8fafc', margin: '0 0 10px 0' }}>
            {tr('Выпадающий список вариантов')}
          </h4>
          
          <div className="form-group" style={{ marginBottom: '10px' }}>
            <label style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{tr('Шрифт')}</label>
            <select
              value={ex.gapDropdown?.font || 'Comfortaa'}
              onChange={e => onChangeField('exercises.gapDropdown.font', e.target.value)}
              style={{ width: '100%', padding: '6px 10px', borderRadius: '8px' }}
            >
              <option value="inherit">{tr('По умолчанию (как в карточке)')}</option>
              {FONT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {tr(opt.label)}
                </option>
              ))}
            </select>
          </div>

          <SliderControl
            label={tr('Размер шрифта')}
            value={Number(ex.gapDropdown?.size) || 1.15}
            min={0.8}
            max={2.5}
            step={0.05}
            unit="rem"
            onChange={val => onChangeField('exercises.gapDropdown.size', val)}
          />

          <ColorControl
            label={tr('Фон списка')}
            value={ex.gapDropdown?.bg || 'rgba(15,23,42,0.94)'}
            onChange={val => onChangeField('exercises.gapDropdown.bg', val)}
          />
          <ColorControl
            label={tr('Цвет рамки списка')}
            value={ex.gapDropdown?.borderColor || 'rgba(168,85,247,0.4)'}
            onChange={val => onChangeField('exercises.gapDropdown.borderColor', val)}
          />

          <h4 style={{ fontSize: '0.9rem', color: '#f8fafc', margin: '16px 0 10px 0' }}>
            {tr('Обычный вариант')}
          </h4>
          <ColorControl
            label={tr('Цвет текста')}
            value={ex.gapDropdown?.item?.color || '#f1f5f9'}
            onChange={val => onChangeField('exercises.gapDropdown.item.color', val)}
          />
          <ColorControl
            label={tr('Фон пункта')}
            value={ex.gapDropdown?.item?.bg || 'rgba(255,255,255,0.04)'}
            onChange={val => onChangeField('exercises.gapDropdown.item.bg', val)}
          />

          <h4 style={{ fontSize: '0.9rem', color: '#c084fc', margin: '16px 0 10px 0' }}>
            {tr('Выбранный вариант')}
          </h4>
          <ColorControl
            label={tr('Цвет текста')}
            value={ex.gapDropdown?.selected?.color || '#c084fc'}
            onChange={val => onChangeField('exercises.gapDropdown.selected.color', val)}
          />
          <ColorControl
            label={tr('Фон пункта')}
            value={ex.gapDropdown?.selected?.bg || 'rgba(168,85,247,0.25)'}
            onChange={val => onChangeField('exercises.gapDropdown.selected.bg', val)}
          />
        </div>
      )}
    </div>
  );
});

ExerciseDesignSection.displayName = 'ExerciseDesignSection';

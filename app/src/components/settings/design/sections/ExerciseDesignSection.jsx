import React, { useState } from 'react';
import { tr } from '../../../../i18n/locale';
import { ColorControl } from '../controls/ColorControl';
import { SliderControl } from '../controls/SliderControl';
import { DesignPreviewScope } from '../DesignPreviewScope';
import { FONT_OPTIONS } from '../designConstants';
import { ExerciseRenderer } from '../../../study/ExerciseRenderer.jsx';
import { StudyCardSpeech } from '../../../study/StudyCardSpeech.jsx';
import { CardBackground } from '../../../common/CardBackground';
import { useSettingsStore } from '../../../../store/useSettingsStore';

const PREVIEW_CARDS = {
  speech: { id: -1003, front: 'Ich lerne jeden Tag Deutsch.', back: 'Каждый день я учу немецкий.' },
  cloze: { id: -1001, front: 'Ich [[lerne]] mit klein{en} Hunden {*heute|morgen}.', back: 'Сегодня я учусь.' },
  puzzle: { id: -1002, front: '@puzzle\nIch lerne heute Deutsch.', back: 'Сегодня я учу немецкий.' },
  quiz: { id: 'design-quiz', front: 'Welche Antwort passt?\n\n- Gestern\n* Heute\n- Morgen', back: '' },
  match: { id: 'design-match', front: '@match\ndie Katze => кошка\nder Hund => собака\nder Vogel => птица', back: '' },
  wordBank: { id: 'design-wordbank', front: '@wordbank\nIch <<1>> <<2>> Deutsch.\n@options\nlerne | heute | morgen', back: '1=lerne\n2=heute' },
  freeText: { id: 'design-free', front: '@free\nSchreiben Sie einen Satz über Ihren Alltag.', back: 'Ich lerne jeden Tag Deutsch.' },
  editableText: { id: 'design-edit', front: '@edit\nIch lernen jeden Tag Deutsch.', back: 'Ich lerne jeden Tag Deutsch.' },
};

const STATE_GROUPS = {
  choice: ['normal', 'selected', 'correct', 'wrong', 'disabled'],
  match: ['item', 'selected', 'matched', 'wrong', 'disabled'],
  wordBank: ['container', 'word', 'selected', 'correct', 'wrong'],
  freeText: ['input', 'focus', 'correct', 'wrong'],
  clozeGap: ['gap', 'filled', 'correct', 'wrong'],
  puzzle: ['container', 'item', 'selected', 'correct', 'wrong'],
};

const PREVIEW_TYPES = [
  ['quiz', 'Тест / Выбор'], ['cloze', 'Пропуск'], ['match', 'Пары'], ['puzzle', 'Пазл'],
  ['wordBank', 'Банк слов'], ['freeText', 'Свободный ответ / Письмо'], ['editableText', 'Редактируемый текст'], ['speech', 'Речь'],
];

export const ExerciseDesignSection = React.memo(({ config, onChangeField }) => {
  const [previewType, setPreviewType] = useState('quiz');
  const [previewRevision, setPreviewRevision] = useState(0);
  const [subTab, setSubTab] = useState('palette');
  const ex = config?.exercises || {};
  const fallbackBackground = useSettingsStore(s => s.cardBgFront);
  const isInputPreview = ['freeText', 'editableText', 'speech'].includes(previewType);

  return (
    <div className="exercise-design-section">
      {/* Exercise Live Preview */}
      <DesignPreviewScope>
        <div className="card-front" style={{
          position: 'relative', overflow: 'hidden',
          background: 'linear-gradient(145deg, #25263f, #111b30)',
          borderRadius: '20px',
          border: '1px solid rgba(196,181,253,0.3)',
          padding: '16px',
          marginBottom: '20px',
          boxShadow: '0 16px 32px -16px rgba(0,0,0,0.65)'
        }}>
          <CardBackground background={config?.front?.card?.background} styleType={fallbackBackground} cardId={1} />
          <div style={{ position: 'relative', zIndex: 1 }}>
          {/* Switch preview mode */}
          <label className="exercise-preview-type-select design-editor-select">
            {tr('Предпросмотр (Лицевая сторона)')}
            <select value={previewType} onChange={event => setPreviewType(event.target.value)}>
              {PREVIEW_TYPES.map(([type, label]) => <option key={type} value={type}>{tr(label)}</option>)}
            </select>
          </label>
          <div className="exercise-preview-type-buttons">
            {PREVIEW_TYPES.map(([type, label]) => (
              <button
                key={type}
                type="button"
                className={`btn-secondary btn-tiny ${previewType === type ? 'active' : ''}`}
                onClick={() => setPreviewType(type)}
                style={{ fontSize: '0.75rem', padding: '4px 8px', borderRadius: '12px', minHeight: '44px' }}
              >
                {tr(label)}
              </button>
            ))}
          </div>

          {/* Use the real renderer in the existing preview surface. */}
          {PREVIEW_CARDS[previewType] && <>
            {/* Free/Edit are appearance samples: no evaluation or microphone requests. */}
            <fieldset disabled={isInputPreview} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              {previewType === 'speech' ? <StudyCardSpeech key={`speech:${previewRevision}`}
                card={PREVIEW_CARDS.speech} designConfig={config} /> : <ExerciseRenderer key={`${previewType}:${previewRevision}`}
                card={PREVIEW_CARDS[previewType]} designConfig={config}
                savedState={previewType === 'freeText' ? { userInput: PREVIEW_CARDS.freeText.back } : undefined} />}
            </fieldset>
            <button type="button" className="btn-secondary btn-tiny"
              onClick={() => setPreviewRevision(value => value + 1)}>{tr('Сбросить')}</button>
          </>}

          </div>
        </div>
      </DesignPreviewScope>

      {/* Sub tabs */}
      <div className="exercise-design-tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${subTab === 'palette' ? 'active' : ''}`}
          onClick={() => setSubTab('palette')}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
        >
          {tr('Акцент упражнений')}
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
          className={`btn-secondary btn-tiny ${subTab === 'clozeGap' ? 'active' : ''}`}
          onClick={() => setSubTab('clozeGap')}
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
        <button type="button" className={`btn-secondary btn-tiny ${subTab === 'wordBank' ? 'active' : ''}`}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
          onClick={() => setSubTab('wordBank')}>{tr('Банк слов')}</button>
        <button type="button" className={`btn-secondary btn-tiny ${subTab === 'freeText' ? 'active' : ''}`}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
          onClick={() => setSubTab('freeText')}>{tr('Свободный ответ / Письмо')}</button>
        <button type="button" className={`btn-secondary btn-tiny ${subTab === 'puzzle' ? 'active' : ''}`}
          style={{ flex: 1, padding: '6px 4px', fontSize: '0.8rem' }}
          onClick={() => setSubTab('puzzle')}>{tr('Пазл')}</button>
      </div>

      {/* Palette Mode */}
      {subTab === 'palette' && (
        <div style={{ marginBottom: '16px' }}>
          <ColorControl
            label={tr('Базовый цвет гармонии упражнений')}
            value={ex.baseColor || '#fde047'}
            onChange={val => onChangeField('exercises.baseColor', val)}
          />
        </div>
      )}

      {/* Edit shares Free Text states; no duplicate configuration. */}
      {STATE_GROUPS[subTab] && (
        <div>
          {STATE_GROUPS[subTab].map(state => (
            <fieldset key={state} style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
              <legend>{state}</legend>
              {ex[subTab][state].color !== undefined && <ColorControl label={tr('Цвет текста')} value={ex[subTab][state].color}
                onChange={value => onChangeField(`exercises.${subTab}.${state}.color`, value)} />}
              {ex[subTab][state].bg !== undefined && <ColorControl label={tr('Цвет фона')} value={ex[subTab][state].bg}
                onChange={value => onChangeField(`exercises.${subTab}.${state}.bg`, value)} />}
              <ColorControl label={tr('Цвет рамки')} value={ex[subTab][state].borderColor}
                onChange={value => onChangeField(`exercises.${subTab}.${state}.borderColor`, value)} />
              {ex[subTab][state].radius !== undefined && <SliderControl label={tr('Скругление углов')}
                value={parseFloat(ex[subTab][state].radius)} min={0} max={40} step={1} unit="px"
                onChange={value => onChangeField(`exercises.${subTab}.${state}.radius`, `${value}px`)} />}
            </fieldset>
          ))}
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

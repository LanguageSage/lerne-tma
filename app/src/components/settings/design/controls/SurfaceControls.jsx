import React from 'react';
import { tr } from '../../../../i18n/locale';
import { ColorControl } from './ColorControl';
import { SliderControl } from './SliderControl';
import { CARD_BACKGROUND_PRESETS } from '../../../../utils/style';

const BACKGROUND_LABELS = {
  standard: 'Стандартный', auto: 'Автоматически', mesh: 'Сетка', aurora: 'Северное сияние',
  holographic: 'Голографический', liquid: 'Жидкий', liquid_sunset: 'Закат', liquid_ocean: 'Океан',
  liquid_cosmic: 'Космос', liquid_emerald: 'Изумруд', liquid_morning: 'Рассвет',
  video_aquarium: 'Аквариум', video_space: 'Космос (видео)', video_nature: 'Природа (видео)',
  dark_obsidian: 'Обсидиан', dark_minimal: 'Тёмный минимализм', dark_midnight: 'Полночь',
  dark_emerald: 'Тёмный изумруд', dark_mocha: 'Мокко',
};

export const SurfaceControls = React.memo(({
  title,
  surface,
  onChangeField
}) => {
  const {
    borderColor = 'rgba(196,181,253,0.3)',
    borderRadius = '16px',
    padding = '12px'
  } = surface || {};

  // Extract numeric values from strings like '16px' or '12px'
  const radiusNum = Number.isFinite(parseFloat(borderRadius)) ? parseFloat(borderRadius) : 16;
  const paddingNum = parseInt(padding, 10) || 12;

  return (
    <div className="design-surface-controls" style={{ marginBottom: '16px' }}>
      {title && (
        <h4 style={{ fontSize: '0.95rem', color: '#e2e8f0', margin: '0 0 10px 0', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }}>
          {title}
        </h4>
      )}

      {surface?.background !== undefined && <>
        <label className="design-editor-select">
          {tr('Фон карточки')}
          <select value={CARD_BACKGROUND_PRESETS.includes(surface.background) || surface.background === '' ? surface.background : '$custom'}
            onChange={event => onChangeField('background', event.target.value === '$custom' ? '#1e293b' : event.target.value)}>
            <option value="">{tr('Текущее оформление')}</option>
            {CARD_BACKGROUND_PRESETS.map(value => <option key={value} value={value}>{tr(BACKGROUND_LABELS[value])}</option>)}
            <option value="$custom">{tr('Свой цвет / градиент')}</option>
          </select>
        </label>
        {!CARD_BACKGROUND_PRESETS.includes(surface.background) && surface.background !== '' && <label className="design-editor-select">
          {tr('Свой цвет / градиент')}
          <input key={surface.background} defaultValue={surface.background}
            onBlur={event => onChangeField('background', event.target.value)} />
        </label>}
      </>}

      <ColorControl
        label={tr('Цвет рамки')}
        value={borderColor}
        onChange={val => onChangeField('borderColor', val)}
      />

      <SliderControl
        label={tr('Скругление углов')}
        value={radiusNum}
        min={0}
        max={40}
        step={1}
        unit="px"
        onChange={val => onChangeField('borderRadius', `${val}px`)}
      />

      <SliderControl
        label={tr('Внутренний отступ (Padding)')}
        value={paddingNum}
        min={4}
        max={32}
        step={1}
        unit="px"
        onChange={val => onChangeField('padding', `${val}px`)}
      />
    </div>
  );
});

SurfaceControls.displayName = 'SurfaceControls';

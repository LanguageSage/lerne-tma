import React from 'react';
import { tr } from '../../../../i18n/locale';
import { ColorControl } from './ColorControl';
import { SliderControl } from './SliderControl';
import { AlignmentControl } from './AlignmentControl';
import { FONT_OPTIONS, SHADOW_OPTIONS } from '../designConstants';

export const TypographyControls = React.memo(({
  title,
  typography,
  onChangeField,
  minSize = 0.7,
  maxSize = 3.0,
  stepSize = 0.05,
  showAlign = true,
  showShadow = true,
  showColor = true,
  allowAutoColor = false,
  isAutoColor = false,
  onAutoColorToggle
}) => {
  const {
    font = 'Inter',
    size = 1.4,
    weight = '400',
    style = 'normal',
    color = '#ffffff',
    align = 'left',
    shadow = 'none'
  } = typography || {};

  return (
    <div className="design-typography-group" style={{ marginBottom: '18px' }}>
      {title && (
        <h4 style={{ fontSize: '0.95rem', color: '#e2e8f0', margin: '0 0 10px 0', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }}>
          {title}
        </h4>
      )}

      {showColor && (
        <ColorControl
          label={tr('Цвет текста')}
          value={color}
          onChange={val => onChangeField('color', val)}
          allowAuto={allowAutoColor}
          isAuto={isAutoColor}
          onAutoToggle={onAutoColorToggle}
        />
      )}

      <div className="form-group" style={{ marginBottom: '10px' }}>
        <label style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{tr('Шрифт')}</label>
        <select
          value={font}
          onChange={e => onChangeField('font', e.target.value)}
          style={{ width: '100%', padding: '6px 10px', borderRadius: '8px' }}
        >
          {FONT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {tr(opt.label)}
            </option>
          ))}
        </select>
      </div>

      <SliderControl
        label={tr('Размер шрифта')}
        value={Number(size) || 1.4}
        min={minSize}
        max={maxSize}
        step={stepSize}
        unit="rem"
        onChange={val => onChangeField('size', val)}
      />

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${weight === '700' ? 'active' : ''}`}
          onClick={() => onChangeField('weight', weight === '700' ? '400' : '700')}
          style={{ flex: 1, padding: '6px 0', fontWeight: 'bold' }}
        >
          {tr('Жирный')}
        </button>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${style === 'italic' ? 'active' : ''}`}
          onClick={() => onChangeField('style', style === 'italic' ? 'normal' : 'italic')}
          style={{ flex: 1, padding: '6px 0', fontStyle: 'italic' }}
        >
          {tr('Курсив')}
        </button>
      </div>

      {showShadow && (
        <div className="form-group" style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{tr('Эффект тени / свечения')}</label>
          <select
            value={shadow}
            onChange={e => onChangeField('shadow', e.target.value)}
            style={{ width: '100%', padding: '6px 10px', borderRadius: '8px' }}
          >
            {SHADOW_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {tr(opt.label)}
              </option>
            ))}
          </select>
        </div>
      )}

      {showAlign && (
        <AlignmentControl
          label={tr('Выравнивание текста')}
          value={align}
          onChange={val => onChangeField('align', val)}
        />
      )}
    </div>
  );
});

TypographyControls.displayName = 'TypographyControls';

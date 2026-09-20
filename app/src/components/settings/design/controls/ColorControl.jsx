import React from 'react';
import { tr } from '../../../../i18n/locale';
import { PRESET_COLORS } from '../designConstants';

function toSafeHex(val) {
  if (typeof val === 'string' && /^#[0-9a-f]{6}$/i.test(val.trim())) {
    return val.trim();
  }
  if (typeof val === 'string' && /^#[0-9a-f]{3}$/i.test(val.trim())) {
    const raw = val.trim().slice(1);
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
  }
  return '#ffffff';
}

export const ColorControl = React.memo(({
  label,
  value,
  onChange,
  allowAuto = false,
  isAuto = false,
  onAutoToggle,
  presetColors = PRESET_COLORS
}) => {
  const isAutoActive = allowAuto && isAuto;

  return (
    <div className="design-color-control" style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <label style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 500 }}>
          {label}
        </label>
        {allowAuto && (
          <button
            type="button"
            className={`btn-secondary btn-tiny ${isAutoActive ? 'active' : ''}`}
            onClick={onAutoToggle}
            style={{ fontSize: '0.75rem', padding: '2px 8px' }}
          >
            {isAutoActive ? `✨ ${tr('Автоматически')}` : tr('Вручную')}
          </button>
        )}
      </div>

      {!isAutoActive && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
          {presetColors.map(color => {
            const isSelected = typeof value === 'string' && value.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                className={`design-color-swatch ${isSelected ? 'active' : ''}`}
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: color,
                  border: isSelected ? '2px solid #a855f7' : '1px solid rgba(255,255,255,0.2)',
                  cursor: 'pointer',
                  transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                  transition: 'transform 0.15s ease',
                  padding: 0
                }}
                onClick={() => onChange(color)}
                title={color}
              />
            );
          })}

          <label
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)',
              cursor: 'pointer',
              border: '1.5px solid rgba(255, 255, 255, 0.6)',
              position: 'relative',
              overflow: 'hidden',
              display: 'inline-block'
            }}
            title={tr('Выбрать свой цвет (спектр)')}
          >
            <input
              type="color"
              value={toSafeHex(value)}
              onChange={e => onChange(e.target.value)}
              style={{
                position: 'absolute',
                top: '-50%',
                left: '-50%',
                width: '200%',
                height: '200%',
                opacity: 0,
                cursor: 'pointer'
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
});

ColorControl.displayName = 'ColorControl';

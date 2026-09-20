import React from 'react';
import { tr } from '../../../../i18n/locale';
import { ColorControl } from '../controls/ColorControl';
import { SliderControl } from '../controls/SliderControl';
import { FONT_OPTIONS } from '../designConstants';
import { DesignPreviewScope } from '../DesignPreviewScope';

const APP_BG_PRESETS = [
  { id: 'default_dark', label: 'Космический синий', value: 'radial-gradient(circle at top right, #1a1a2e, #16213e, #0f3460)' },
  { id: 'deep_purple', label: 'Глубокий фиолетовый', value: 'radial-gradient(circle at top right, #2e1065, #1e1b4b, #0f172a)' },
  { id: 'dark_emerald', label: 'Тёмный изумруд', value: 'radial-gradient(circle at top right, #064e3b, #022c22, #0f172a)' },
  { id: 'pure_dark', label: 'Чистый графит', value: 'linear-gradient(180deg, #111827 0%, #030712 100%)' },
  { id: 'sunset_dark', label: 'Закатный градиент', value: 'radial-gradient(circle at top right, #4c0519, #1c1917, #09090b)' },
];

export const GeneralDesignSection = React.memo(({ config, onChangeField }) => {
  const global = config?.global || {};
  const glassBlurNum = parseInt(global.glassBlur, 10) || 12;
  const commonRadiusNum = parseInt(global.commonRadius, 10) || 12;

  return (
    <div className="general-design-section">
      {/* Live Preview */}
      <DesignPreviewScope>
        <div style={{
          background: 'var(--design-app-bg)',
          borderRadius: 'var(--design-radius)',
          padding: '20px',
          marginBottom: '20px',
          border: '1px solid var(--design-glass-border, rgba(255,255,255,0.1))',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{
            background: 'var(--design-glass-bg)',
            backdropFilter: 'blur(var(--design-glass-blur))',
            borderRadius: 'var(--design-radius)',
            padding: '16px',
            border: '1px solid var(--design-glass-border)',
            color: '#f8fafc',
            fontFamily: 'var(--design-ui-font)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontWeight: 600, color: 'var(--design-accent)' }}>✨ Live Preview (Общее)</span>
              <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>UI Demo</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.9rem', opacity: 0.9 }}>
              {tr('Пример отображения глобального фона, шрифта интерфейса и акцентного цвета.')}
            </p>
          </div>
        </div>
      </DesignPreviewScope>

      {/* App Background Presets */}
      <div className="form-group" style={{ marginBottom: '16px' }}>
        <label style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 500, marginBottom: '8px', display: 'block' }}>
          {tr('Фон приложения')}
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {APP_BG_PRESETS.map(preset => {
            const isSelected = global.appBg === preset.value;
            return (
              <button
                key={preset.id}
                type="button"
                className={`btn-secondary btn-tiny ${isSelected ? 'active' : ''}`}
                onClick={() => onChangeField('global.appBg', preset.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '10px',
                  fontSize: '0.8rem',
                  border: isSelected ? '1px solid #a855f7' : '1px solid rgba(255,255,255,0.1)',
                  background: isSelected ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.05)',
                  color: isSelected ? '#f3e8ff' : '#cbd5e1'
                }}
              >
                {tr(preset.label)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Accent Color */}
      <ColorControl
        label={tr('Акцентный цвет')}
        value={global.accentColor || '#a78bfa'}
        onChange={val => onChangeField('global.accentColor', val)}
      />

      {/* UI Font */}
      <div className="form-group" style={{ marginBottom: '16px' }}>
        <label style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: '6px', display: 'block' }}>
          {tr('Шрифт интерфейса (UI)')}
        </label>
        <select
          value={global.uiFont || 'Inter'}
          onChange={e => onChangeField('global.uiFont', e.target.value)}
          style={{ width: '100%', padding: '8px 10px', borderRadius: '8px' }}
        >
          {FONT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {tr(opt.label)}
            </option>
          ))}
        </select>
      </div>

      {/* Common Radius */}
      <SliderControl
        label={tr('Базовый радиус скруглений')}
        value={commonRadiusNum}
        min={0}
        max={28}
        step={1}
        unit="px"
        onChange={val => onChangeField('global.commonRadius', `${val}px`)}
      />

      {/* Glass Blur */}
      <SliderControl
        label={tr('Размытие стекла (Glass Blur)')}
        value={glassBlurNum}
        min={0}
        max={30}
        step={1}
        unit="px"
        onChange={val => onChangeField('global.glassBlur', `${val}px`)}
      />
    </div>
  );
});

GeneralDesignSection.displayName = 'GeneralDesignSection';

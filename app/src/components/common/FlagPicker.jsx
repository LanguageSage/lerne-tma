import React from 'react';
import { FLAG_COLORS } from '../../constants/cardFlags';

export const FlagPicker = ({ value = 0, onChange, size = 30, label = "ЦВЕТОВАЯ МЕТКА (ФЛАГ)" }) => {
  return (
    <div className="flag-picker-container" style={{ marginTop: '10px', marginBottom: '10px', padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.05)' }}>
      {label && (
        <label className="sub-label" style={{ marginBottom: '6px', fontSize: '0.75rem', opacity: 0.7, display: 'block', fontWeight: 600, letterSpacing: '0.5px' }}>
          {label}
        </label>
      )}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {Object.values(FLAG_COLORS).map(f => {
          const isSelected = (value || 0) === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onChange && onChange(f.id)}
              title={f.name}
              style={{
                width: `${size}px`,
                height: `${size}px`,
                borderRadius: '50%',
                background: f.id === 0 ? 'rgba(255, 255, 255, 0.1)' : f.hex,
                border: isSelected ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.2)',
                boxShadow: isSelected && f.hex ? `0 0 10px ${f.hex}` : 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.7rem',
                color: '#fff',
                transition: 'all 0.2s ease',
                transform: isSelected ? 'scale(1.15)' : 'scale(1)'
              }}
            >
              {f.id === 0 ? '✕' : isSelected ? '✓' : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
};

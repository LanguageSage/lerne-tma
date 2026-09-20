import React from 'react';

export const SliderControl = React.memo(({
  label,
  value,
  onChange,
  min = 0.5,
  max = 3.0,
  step = 0.05,
  unit = 'rem',
  formatDisplay
}) => {
  const displayVal = formatDisplay ? formatDisplay(value) : `${value} ${unit}`;

  return (
    <div className="design-slider-control" style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <label style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{label}</label>
        <span style={{ fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 600 }}>{displayVal}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#a855f7', cursor: 'pointer' }}
      />
    </div>
  );
});

SliderControl.displayName = 'SliderControl';

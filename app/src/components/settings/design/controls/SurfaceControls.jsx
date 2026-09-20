import React from 'react';
import { tr } from '../../../../i18n/locale';
import { ColorControl } from './ColorControl';
import { SliderControl } from './SliderControl';

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
  const radiusNum = parseInt(borderRadius, 10) || 16;
  const paddingNum = parseInt(padding, 10) || 12;

  return (
    <div className="design-surface-controls" style={{ marginBottom: '16px' }}>
      {title && (
        <h4 style={{ fontSize: '0.95rem', color: '#e2e8f0', margin: '0 0 10px 0', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }}>
          {title}
        </h4>
      )}

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

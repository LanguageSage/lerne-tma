import React from 'react';
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { tr } from '../../../../i18n/locale';

export const AlignmentControl = React.memo(({ value = 'left', onChange, label }) => {
  return (
    <div className="design-align-control" style={{ marginBottom: '12px' }}>
      {label && <label style={{ fontSize: '0.82rem', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>{label}</label>}
      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${value === 'left' ? 'active' : ''}`}
          onClick={() => onChange('left')}
          title={tr('По левому краю')}
          style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '6px' }}
        >
          <AlignLeft size={16} />
        </button>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${value === 'center' ? 'active' : ''}`}
          onClick={() => onChange('center')}
          title={tr('По центру')}
          style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '6px' }}
        >
          <AlignCenter size={16} />
        </button>
        <button
          type="button"
          className={`btn-secondary btn-tiny ${value === 'right' ? 'active' : ''}`}
          onClick={() => onChange('right')}
          title={tr('По правому краю')}
          style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '6px' }}
        >
          <AlignRight size={16} />
        </button>
      </div>
    </div>
  );
});

AlignmentControl.displayName = 'AlignmentControl';

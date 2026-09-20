import React from 'react';
import { tr } from '../../../i18n/locale';
import { DESIGN_SECTIONS } from './designConstants';

export const DesignSectionTabs = React.memo(({ activeSection, onSelectSection }) => {
  return (
    <div
      className="design-section-tabs"
      style={{
        display: 'flex',
        overflowX: 'auto',
        gap: '6px',
        padding: '6px 0 14px 0',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        marginBottom: '16px',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none'
      }}
    >
      {DESIGN_SECTIONS.map(sec => {
        const isActive = activeSection === sec.id;
        return (
          <button
            key={sec.id}
            type="button"
            className={`btn-secondary btn-tiny ${isActive ? 'active' : ''}`}
            onClick={() => onSelectSection(sec.id)}
            style={{
              padding: '6px 12px',
              borderRadius: '20px',
              whiteSpace: 'nowrap',
              fontSize: '0.85rem',
              fontWeight: isActive ? 600 : 400,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              border: isActive ? '1px solid #a855f7' : '1px solid rgba(255,255,255,0.1)',
              background: isActive ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.05)',
              color: isActive ? '#f3e8ff' : '#cbd5e1',
              cursor: 'pointer'
            }}
          >
            <span>{sec.icon}</span>
            <span>{tr(sec.label)}</span>
          </button>
        );
      })}
    </div>
  );
});

DesignSectionTabs.displayName = 'DesignSectionTabs';

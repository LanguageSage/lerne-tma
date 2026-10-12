import React from 'react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { tr } from '../../i18n/locale';

/** Заметный индикатор: черновик дизайна применён только в этом браузере. */
export const LocalDesignBadge = () => {
  const active = useSettingsStore(s => s.isLocalDesignPreviewActive);
  const isAdmin = useSettingsStore(s => s.isAdmin);
  const toggle = useSettingsStore(s => s.toggleLocalDesignPreview);
  if (!active || !isAdmin) return null;
  return (
    <div className="local-design-badge" role="status">
      <span>{tr('Дизайн: только у меня')}</span>
      <button type="button" onClick={toggle} aria-label={tr('Выключить')}>{tr('Выключить')}</button>
    </div>
  );
};

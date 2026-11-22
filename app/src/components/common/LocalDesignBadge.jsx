import React from 'react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { tr } from '../../i18n/locale';

/** Заметный индикатор: временный предпросмотр дизайна применён только в этом окне. */
export const LocalDesignBadge = () => {
  const active = useSettingsStore(s => s.designPreviewInApp);
  const hasDraft = useSettingsStore(s => Boolean(s.designEditorDraft));
  const toggle = useSettingsStore(s => s.toggleDesignPreviewInApp);
  if (!active || !hasDraft) return null;
  return (
    <div className="local-design-badge" role="status">
      <span>{tr('Дизайн: только у меня')}</span>
      <button type="button" onClick={toggle} aria-label={tr('Выключить')}>{tr('Выключить')}</button>
    </div>
  );
};

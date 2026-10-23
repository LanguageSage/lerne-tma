import React, { useEffect, useState } from 'react';
import { CloudUpload } from 'lucide-react';
import { IS_LOCAL } from '../../utils/localMode.js';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { networkApi } from '../../services/api';
import { syncService } from '../../services/syncService';
import { useUiStore } from '../../store/useUiStore';
import { prepareExternalLink } from '../../utils/platform';

export function LocalPublishButton({ cardId, beforeOpen, compact = false }) {
  useInterfaceLocale();
  const [allowedId, setAllowedId] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (IS_LOCAL && Number(cardId) > 0) {
      networkApi.get(`/local/transfer-card/${cardId}`).then(() => {
        if (active) setAllowedId(cardId);
      }).catch(() => { if (active) setAllowedId(null); });
    }
    return () => { active = false; };
  }, [cardId]);
  if (!IS_LOCAL || allowedId !== cardId || !cardId) return null;

  const open = async () => {
    if (busy) return;
    const popup = prepareExternalLink();
    setBusy(true);
    try {
      const saved = beforeOpen ? await beforeOpen() : { id: cardId };
      if (!saved?.id) throw new Error(tr('Сначала сохраните карточку.'));
      // Push the existing Dexie queue to LOCAL PostgreSQL before the admin reads
      // it; publication itself always happens after admin preview/confirmation.
      const sync = await syncService.sync();
      if (!sync.success) throw new Error(sync.reason || tr('Дождитесь завершения синхронизации.'));
      const result = await networkApi.get(`/local/transfer-card/${saved.id}`);
      if (!popup) throw new Error(tr('Разрешите открытие вкладки административной консоли.'));
      popup.location = result.data.url;
    } catch (error) {
      popup?.close();
      useUiStore.getState().showToast(error.response?.data?.detail || error.message, 'error');
    } finally { setBusy(false); }
  };
  return <button type="button" className={`local-publish-button ${compact ? 'header-action-btn' : 'btn btn-secondary'}`}
    disabled={busy} onClick={open} title={tr('Опубликовать в Supabase')}
    aria-label={tr('Опубликовать в Supabase')}>
    <CloudUpload size={20} />{!compact && tr('Опубликовать в Supabase')}
  </button>;
}

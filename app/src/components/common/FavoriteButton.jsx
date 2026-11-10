import React from 'react';
import { Heart } from 'lucide-react';
import { useCardFavorite } from '../../hooks/useFavorites.js';
import { useUiStore } from '../../store/useUiStore.js';
import { tr } from '../../i18n/locale.js';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale.js';
import { getUserId } from '../../utils/auth.js';
import './FavoriteButton.css';

export function FavoriteButton({ card, className = '' }) {
  useInterfaceLocale();
  const { selected, busy, toggle } = useCardFavorite(card);
  const label = selected ? tr('Убрать из избранного') : tr('Добавить в избранное');
  return <button type="button" className={`favorite-button ${selected ? 'is-selected' : ''} ${className}`}
    aria-label={label} title={label} aria-pressed={selected} disabled={busy}
    onClick={async event => {
      event.stopPropagation();
      const ui = useUiStore.getState();
      if (getUserId() == null || ui.userProfile?.is_guest) { ui.setIsAuthModalOpen(true, tr('Вход в аккаунт')); return; }
      try {
        const result = await toggle();
        if (result?.syncPending) ui.showToast(tr('Избранное сохранено на устройстве. Синхронизируем при подключении.'), 'info');
      } catch { ui.showToast(tr('Не удалось сохранить избранное. Повторите попытку.'), 'error'); }
    }}><Heart size={20} aria-hidden="true" /></button>;
}

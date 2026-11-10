import React, { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Heart, RefreshCw } from 'lucide-react';
import { useFavorites } from '../../hooks/useFavorites.js';
import { useLanguageStore } from '../../store/useLanguageStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useDeckStore } from '../../store/useDeckStore.js';
import { FavoriteButton } from '../common/FavoriteButton.jsx';
import { CardLevelBadge } from '../common/CardLevelBadge.jsx';
import { stripMarkdown } from '../../utils/text.js';
import { navigateUp } from '../../utils/navigation.js';
import { tr } from '../../i18n/locale.js';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale.js';
import './FavoritesView.css';

export function FavoritesShortcut() {
  useInterfaceLocale();
  const language = useLanguageStore(s => s.activeLanguage);
  const { cards, loading, error } = useFavorites(language);
  return <button type="button" className="favorites-shortcut glass" onClick={() => {
    useUiStore.setState({ favoritesScrollTop: 0 });
    useUiStore.getState().setView('favorites');
  }}>
    <Heart size={20} className="favorites-shortcut-heart" aria-hidden="true" />
    <span>{tr('Избранное')}</span>
    <span className="favorites-shortcut-count">{loading && !cards.length ? '…' : error && !cards.length ? '—' : cards.length}</span>
    <ChevronRight size={16} aria-hidden="true" />
  </button>;
}

export function FavoritesView({ startStudy, startStudyCard }) {
  useInterfaceLocale();
  const language = useLanguageStore(s => s.activeLanguage);
  const { cards, loading, error, reload } = useFavorites(language);
  const isOpening = useUiStore(s => s.isOpeningDeck);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || (loading && !cards.length)) return;
    const container = document.getElementById('app-container');
    const frame = requestAnimationFrame(() => {
      if (container) container.scrollTop = useUiStore.getState().favoritesScrollTop || 0;
      restored.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, cards.length]);
  useEffect(() => {
    const container = document.getElementById('app-container');
    const save = () => {
      if (restored.current) useUiStore.setState({ favoritesScrollTop: container.scrollTop });
    };
    container?.addEventListener('scroll', save, { passive: true });
    return () => container?.removeEventListener('scroll', save);
  }, []);
  const open = cardId => {
    const container = document.getElementById('app-container');
    useUiStore.setState({ favoritesScrollTop: container?.scrollTop || 0 });
    const deck = { id: 'favorites', name: tr('Избранное'), target_language: language,
      is_pseudo: true, role: 'viewer', stats: { total: cards.length } };
    useDeckStore.getState().setCurrentDeck(deck);
    useDeckStore.getState().setDeckCards(cards);
    if (cardId != null) startStudyCard(deck, cardId);
    else startStudy(deck, { reviewContext: 'forced' });
  };
  return <div className="view view-favorites">
    <div className="header-compact">
      <button type="button" className="back-btn" aria-label={tr('Назад')} onClick={navigateUp}><ChevronLeft size={24} /></button>
      <h2>{tr('Избранное')}</h2>
      <button type="button" className="header-action-btn" aria-label={tr('Обновить')} disabled={loading} onClick={reload}>
        <RefreshCw size={20} className={loading ? 'spin' : ''} />
      </button>
    </div>
    <p className="favorites-description">{tr('Любимые карточки из ваших колод — всё для быстрого повторения.')}</p>
    {error && <div className="favorites-status glass" role="alert">
      <p>{tr('Не удалось обновить избранное. Сохранённые карточки доступны на устройстве.')}</p>
      <button type="button" className="btn btn-secondary" disabled={loading} onClick={reload}>{tr('Повторить загрузку')}</button>
    </div>}
    {cards.length > 0 && <button type="button" className="btn btn-primary favorites-study" disabled={isOpening} onClick={() => open()}>
      {tr('Повторить избранное')} · {cards.length}
    </button>}
    {loading && !cards.length ? <p role="status">{tr('Загрузка…')}</p> : !cards.length && !error ? <div className="favorites-empty glass">
      <Heart size={32} aria-hidden="true" />
      <h3>{tr('Пока нет избранных карточек')}</h3>
      <p>{tr('Нажмите сердечко между лайком и дизлайком на карточке, чтобы сохранить её здесь.')}</p>
    </div> : null}
    <div className="favorites-list">
      {cards.map(card => <article key={card.id} className="favorites-card glass">
        <button type="button" className="favorites-card-open" disabled={isOpening} onClick={() => open(card.id)}>
          <span className="favorites-card-source">{card.deck_name}</span>
          <strong>{stripMarkdown(card.front || '')}</strong>
          <span className="favorites-card-back">{stripMarkdown(card.back || '')}</span>
        </button>
        <div className="favorites-card-footer"><CardLevelBadge card={card} size="sm" /><FavoriteButton card={card} /></div>
      </article>)}
    </div>
  </div>;
}

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Plus, Settings, RefreshCw, Info, Copy, Trash2, Share2, Inbox, Download, X, BookOpen, ChevronRight } from 'lucide-react';
import { HelpButton } from './TutorialOverlay';
import { UserProfileBadge } from './common/UserBadge';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import api from '../services/api';

// Compact share banner shown above the deck list when a share link is opened
const ShareBanner = ({ shareId, onSuccess, onClose }) => {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const { showToast, userProfile } = useUiStore();
  const { fetchDecks } = useDeckStore();

  useEffect(() => {
    if (!shareId) return;
    api.get(`/share/info/${shareId}`)
      .then(r => setInfo(r.data))
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, [shareId]);

  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await api.post('/share/import', { share_id: shareId });
      if (res.data.status === 'ok') {
        const msg = res.data.type === 'deck'
          ? `✅ Колода «${res.data.deck_name}» добавлена!`
          : '✅ Карточка добавлена во Входящие!';
        showToast(msg, 'success');
        await fetchDecks(userProfile?.user_id);
        onSuccess();
      }
    } catch {
      showToast('Ошибка при добавлении', 'error');
    } finally {
      setImporting(false);
    }
  };

  if (!shareId) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="share-banner glass"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        transition={{ duration: 0.3 }}
      >
        {loading ? (
          <div className="share-banner-inner">
            <RefreshCw size={16} className="spin" color="#818cf8" />
            <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Загрузка...</span>
          </div>
        ) : !info ? (
          <div className="share-banner-inner">
            <span style={{ color: '#fca5a5', fontSize: '0.85rem' }}>⚠️ Ссылка недействительна</span>
            <button className="share-banner-close" onClick={onClose}><X size={16} /></button>
          </div>
        ) : (
          <div className="share-banner-inner">
            {/* Left: icon + text */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
              <div className="share-banner-icon">
                <BookOpen size={16} color="#a5b4fc" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 1 }}>
                  {info.creator_name ? `от ${info.creator_name}` : 'Вам поделились'}
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {info.type === 'deck' ? `📚 ${info.name}` : `🃏 ${info.front_text}`}
                </div>
              </div>
            </div>

            {/* Right: action buttons */}
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button
                className="share-banner-btn share-banner-btn-primary"
                onClick={handleImport}
                disabled={importing}
              >
                {importing
                  ? <RefreshCw size={13} className="spin" />
                  : <><Download size={13} /> <span>Добавить</span></>
                }
              </button>
              <button className="share-banner-close" onClick={onClose}><X size={15} /></button>
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

export const DeckGrid = ({ startTutorial, userId, openSyncModal, startStudy, importShareId, onImportSuccess, onImportClose }) => {
  const { view, loading, setIsNewDeckModalOpen, setIsSettingsOpen, showToast } = useUiStore();
  const { decks, setCurrentDeck, fetchDeckCards, handleSyncDeck, handleResetProgress, handleDeleteDeck } = useDeckStore();
  
  if (view !== 'decks') return null;

  return (
    <div className="view-decks">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="view"
      >
        <div className="header">
          <div className="header-title-row">
            <div className="header-left">
              <UserProfileBadge />
              <h1>Lerne TMA</h1>
            </div>
            <div className="header-actions">
              <HelpButton onClick={() => startTutorial('decks')} />
              <button id="tut-add-deck" className="add-deck-btn" onClick={() => setIsNewDeckModalOpen(true)}>
                <Plus size={20} />
              </button>
              <button id="tut-main-settings" className="settings-btn" onClick={(e) => { e.stopPropagation(); setIsSettingsOpen(true); }}>
                <Settings size={20} />
              </button>
            </div>
          </div>
          <p>Выбирайте колоду и начните обучение</p>
          <div className="commercial-info glass">
            <Info size={16} />
            <div className="web-link-container">
              <span>Персональная ссылка: </span>
              <code className="web-link">{window.location.origin}/?user_id={userId}</code>
              <button 
                className="copy-link-btn" 
                onClick={() => {
                  const link = `${window.location.origin}/?user_id=${userId}`;
                  navigator.clipboard.writeText(link);
                  showToast("Ссылка скопирована!", "success");
                }}
                title="Копировать ссылку"
              >
                <Copy size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Share banner — shown when opened via share link */}
        {importShareId && (
          <ShareBanner
            shareId={importShareId}
            onSuccess={onImportSuccess}
            onClose={onImportClose}
          />
        )}

        {/* Duplicate cards banner */}
        {useDeckStore.getState().duplicateCards.length > 0 && (
          <div className="duplicate-banner glass" onClick={() => showToast("Скоро: Управление дубликатами. Пока вы можете найти их в списках колод.", "info")}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Copy size={16} />
              <span>У вас есть дубликаты ({Math.floor(useDeckStore.getState().duplicateCards.length / 2)} пар)</span>
            </div>
            <button className="btn-clean">Посмотреть</button>
          </div>
        )}

        <div id="tut-deck-list" className="deck-grid">
          {loading && decks.length === 0 ? (
            <div className="empty-decks-state glass">
              <RefreshCw size={48} className="spin" color="#a855f7" />
              <h3>Идет загрузка колод...</h3>
              <p>Пожалуйста, подождите немного.</p>
            </div>
          ) : decks.length === 0 ? (
            <div className="empty-decks-state glass">
              <Layers size={48} opacity={0.3} />
              <h3>У вас пока нет колод</h3>
              <p>Нажмите "+", чтобы создать свою или импортировать из библиотеки.</p>
              <button className="btn btn-primary" onClick={() => setIsNewDeckModalOpen(true)}>Добавить первую колоду</button>
            </div>
          ) : (
            decks.map((deck, index) => (
              <div 
                key={deck.id} 
                className={`deck-card glass ${deck.is_inbox ? 'deck-card-inbox' : ''}`}
              >
                <div className="deck-main-action" onClick={() => {
                  setCurrentDeck(deck);
                  fetchDeckCards(deck.id);
                  useUiStore.getState().setView('cards');
                }}>
                  <div className="deck-icon">
                    {deck.is_inbox ? <Inbox size={24} /> : <Layers size={24} />}
                  </div>
                  <h3>
                    {deck.name}
                    {deck.is_inbox && deck.stats.total > 0 && (
                      <span style={{ marginLeft: 8, fontSize: '0.7rem', background: 'rgba(99,102,241,0.3)', color: '#818cf8', padding: '2px 7px', borderRadius: 6, fontWeight: 700 }}>
                        новые
                      </span>
                    )}
                  </h3>
                  <div className="deck-stats">
                    <span className="stat total" title="Всего карточек">{deck.stats.total}</span>
                    <span className="stat new" title="Новые">{deck.stats.new}</span>
                    <span className="stat learning" title="В изучении">{deck.stats.learning}</span>
                    <span className="stat due" title="К повторению">{deck.stats.due}</span>
                  </div>
                </div>
                <div className="deck-footer-actions">
                  {!deck.is_inbox && (
                    <button 
                      className="deck-action-btn" 
                      onClick={async (e) => { 
                        e.stopPropagation(); 
                        try {
                          const result = await useDeckStore.getState().handleShareDeck(deck.id);
                          if (result.success) {
                            if (result.type === 'copy') showToast('Ссылка скопирована!', 'success');
                            else if (result.type === 'telegram') showToast('Открываем Telegram Share...', 'success');
                          }
                        } catch (err) {
                          showToast('Ошибка при создании ссылки', 'error');
                        }
                      }}
                      title="Поделиться колодой"
                    >
                      <Share2 size={16} /> Поделиться
                    </button>
                  )}
                  {!deck.is_inbox && (
                    <button 
                      className={`deck-action-btn ${deck.has_updates ? 'has-update-btn' : ''}`} 
                      onClick={(e) => { e.stopPropagation(); openSyncModal ? openSyncModal(deck) : handleSyncDeck(deck.id); }} 
                      title="Синхронизировать с библиотекой"
                    >
                      <RefreshCw size={16} /> {deck.has_updates ? '❗️ Обновить' : 'Обновить'}
                    </button>
                  )}
                  {deck.is_inbox && (
                    <button 
                      className="deck-action-btn" 
                      style={{ flex: 2, color: '#94a3b8', fontSize: '0.7rem', cursor: 'default' }}
                      disabled
                    >
                      📥 Переместите карточки в нужные колоды
                    </button>
                  )}
                  <button 
                    className="deck-action-btn" 
                    onClick={async (e) => { 
                      e.stopPropagation(); 
                      if(window.confirm("Это сбросит весь прогресс обучения по этой колоде. Вы уверены?")) {
                        try {
                          await handleResetProgress(deck.id);
                          showToast("Прогресс успешно сброшен", "success");
                        } catch (err) {
                          showToast("Ошибка при сбросе прогресса");
                        }
                      }
                    }} 
                    title="Сбросить прогресс обучения"
                  >
                    <RefreshCw size={16} style={{ color: '#ef4444' }} /> Сбросить прогресс
                  </button>
                  {!deck.is_inbox && (
                    <button className="deck-action-btn delete-btn-minimal" onClick={(e) => { e.stopPropagation(); if(window.confirm("Вы уверены, что хотите полностью удалить эту колоду и весь прогресс?")) handleDeleteDeck(deck.id); }} title="Удалить колоду">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
};

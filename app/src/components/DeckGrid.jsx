import React from 'react';
import { motion } from 'framer-motion';
import { Layers, Plus, Settings, RefreshCw, Info, Copy, Trash2 } from 'lucide-react';
import { HelpButton } from './TutorialOverlay';

export const DeckGrid = ({
  view,
  decks,
  loading,
  userId,
  setIsNewDeckModalOpen,
  setIsSettingsOpen,
  fetchDecks,
  startStudy,
  setCurrentDeck,
  fetchDeckCards,
  handleSyncDeck,
  handleResetProgress,
  handleDeleteDeck,
  showToast,
  openSyncModal,
  startTutorial
}) => {
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
            <h1>Lerne TMA</h1>
            <div style={{fontSize: '10px', opacity: 0.5, marginLeft: '10px'}}>ID: {userId}</div>
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
              <div key={deck.id} className="deck-card glass">
                <div className="deck-main-action" onClick={() => startStudy(deck)}>
                  <div className="deck-icon"><Layers size={24} /></div>
                  <h3>
                    {deck.level && <span className="deck-level">{deck.level}</span>}
                    {deck.name}
                  </h3>
                  <div className="deck-stats">
                    <span className="stat total" title="Всего карточек">{deck.stats.total}</span>
                    <span className="stat new" title="Новые">{deck.stats.new}</span>
                    <span className="stat learning" title="В изучении">{deck.stats.learning}</span>
                    <span className="stat due" title="К повторению">{deck.stats.due}</span>
                  </div>
                </div>
                <div className="deck-footer-actions">
                  <button 
                    id={index === 0 ? 'tut-deck-cards-btn' : undefined}
                    className="deck-action-btn" 
                    onClick={() => { setCurrentDeck(deck); fetchDeckCards(deck.id); }}
                  >
                    <Layers size={16} /> Карточки
                  </button>
                  <button 
                    className={`deck-action-btn ${deck.has_updates ? 'has-update-btn' : ''}`} 
                    onClick={(e) => { e.stopPropagation(); openSyncModal ? openSyncModal(deck) : handleSyncDeck(deck.id); }} 
                    title="Синхронизировать с библиотекой"
                  >
                    <RefreshCw size={16} /> {deck.has_updates ? '❗️ Обновить' : 'Обновить'}
                  </button>
                  <button className="deck-action-btn" onClick={(e) => { e.stopPropagation(); handleResetProgress(deck.id); }} title="Сбросить прогресс обучения">
                    <RefreshCw size={16} style={{ color: '#ef4444' }} /> Сбросить
                  </button>
                  <button className="deck-action-btn delete-btn-minimal" onClick={(e) => handleDeleteDeck(e, deck.id)} title="Удалить колоду">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        
        <div className="debug-footer glass" style={{marginTop: '20px', padding: '10px', fontSize: '10px', opacity: 0.5}}>
            DEBUG: UserID={userId} | Decks={decks.length} | 
            Stats: {decks.map(d => `${d.name}:${d.stats.total}`).join(', ')}
        </div>
      </motion.div>
    </div>
  );
};

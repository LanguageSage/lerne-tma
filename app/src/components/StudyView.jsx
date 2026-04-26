import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Volume2, CheckCircle, Edit2, Settings, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { stripMarkdown } from '../utils/text';

export const StudyView = ({
  view,
  currentDeck,
  card,
  loading,
  isFlipped,
  setIsFlipped,
  studyHistory,
  historyIndex,
  apiError,
  setView,
  setCard,
  openEditor,
  handleQuickAudio,
  playAudio,
  submitGrade,
  goBack,
  goNext,
  handleSyncDeck,
  handleResetProgress,
  setIsSettingsOpen
}) => {
  if (view !== 'study') return null;

  return (
    <div className="view-study">
      <motion.div 
        key="study"
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        className="view"
      >
        <div className="header-compact">
          <button className="back-btn" onClick={() => { setView('decks'); setCard(null); }}>
            <ChevronLeft size={24} />
          </button>
          <div className="header-study-info">
            <h2>{currentDeck?.name}</h2>
          </div>
          <div className="header-actions">
            <a 
              href={`https://www.google.com/search?q=${encodeURIComponent(card?.front || '')}&tbm=isch`} 
              target="_blank" 
              rel="noreferrer" 
              className="edit-btn-study"
              title="Найти картинку"
            >
              <ImageIcon size={20} />
            </a>
            <button 
              className="edit-btn-study" 
              onClick={() => handleQuickAudio(card)} 
              disabled={loading}
              title="Добавить озвучку"
            >
              <Volume2 size={20} />
            </button>
            <button className="edit-btn-study" onClick={() => openEditor(currentDeck?.id, card, 'study')} title="Редактировать">
              <Edit2 size={20} />
            </button>
            <button className="settings-btn" onClick={() => setIsSettingsOpen(true)}>
              <Settings size={22} />
            </button>
          </div>
        </div>

        {loading && !card ? (
          <div className="finished-view glass">
            <RefreshCw size={48} className="spin" color="#a855f7" />
            <h3>Загрузка карточек...</h3>
          </div>
        ) : card ? (
          <div className="study-flow">
            <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={card.id}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.2 }}
              className={`card-container ${loading ? 'loading-card' : ''}`}
              onClick={() => !loading && setIsFlipped(!isFlipped)}
            >
              {!isFlipped ? (
                <div className="card-inner card-front glass">
                  <div className="card-face">
                    <div className="card-q">❓</div>
                    <div className="text-front">{stripMarkdown(card.front)}</div>
                    {card.audio_url && (
                      <button 
                        className="audio-btn" 
                        disabled={loading}
                        onClick={(e) => { e.stopPropagation(); playAudio(card.audio_url); }}
                      >
                        <Volume2 size={20} />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="card-inner card-back glass">
                  <div className="card-face">
                    <div className="text-front-mini">{stripMarkdown(card.front)}</div>
                    <div className="text-back">{stripMarkdown(card.back)}</div>
                    {card.image_url && (
                      <img 
                        src={card.image_url} 
                        className="card-img" 
                        alt="Card"
                        onError={(e) => { console.warn('Image load error:', card.image_url); e.target.style.display='none'; }}
                      />
                    )}
                    {card.context && <div className="text-context">{stripMarkdown(card.context)}</div>}
                    {card.audio_url && (
                      <button 
                        className="audio-btn bg-audio-btn" 
                        disabled={loading}
                        onClick={(e) => { e.stopPropagation(); playAudio(card.audio_url); }}
                      >
                        <Volume2 size={24} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {loading && (
                <div className="card-loading-overlay">
                  <RefreshCw size={40} className="spin" />
                </div>
              )}
            </motion.div>
            </AnimatePresence>

            {isFlipped && (
              <div className="grade-buttons">
                <button disabled={loading} title="Again" className="btn btn-grade grade-0" onClick={() => submitGrade(0)}>{card.intervals?.[0] || 'Снова'}</button>
                <button disabled={loading} title="Hard" className="btn btn-grade grade-1" onClick={() => submitGrade(1)}>{card.intervals?.[1] || 'Трудно'}</button>
                <button disabled={loading} title="Good" className="btn btn-grade grade-2" onClick={() => submitGrade(2)}>{card.intervals?.[2] || 'Хорошо'}</button>
                <button disabled={loading} title="Easy" className="btn btn-grade grade-3" onClick={() => submitGrade(3)}>{card.intervals?.[3] || 'Легко'}</button>
              </div>
            )}
            
            {!isFlipped && (
              <p className="hint">Нажмите на карточку, чтобы увидеть ответ</p>
            )}

            <div className="study-navigation">
              <div className="nav-counter nav-counter-current" title="Текущая позиция">
                {historyIndex + 1}
              </div>
              <div className="nav-buttons-group">
                <button 
                  className="nav-arrow-btn" 
                  onClick={goBack} 
                  disabled={historyIndex <= 0 || loading}
                  title="Назад"
                >
                  <ChevronLeft size={28} />
                </button>
                <button 
                  className="nav-arrow-btn" 
                  onClick={goNext} 
                  disabled={loading}
                  title="Вперед (пропустить)"
                >
                  <ChevronRight size={28} />
                </button>
              </div>
              <div className="nav-counter nav-counter-total" title="Всего в колоде">
                {currentDeck?.stats?.total || 0}
              </div>
            </div>
          </div>
        ) : (
          <div className="finished-view glass">
            <CheckCircle size={48} color="#22c55e" />
            <h3>Колода пройдена!</h3>
            <p>На сегодня больше нет карточек для повторения.</p>
            {apiError && (
              <div className="api-error-box glass" style={{color: '#f87171', padding: '10px', margin: '10px 0', border: '1px solid #ef4444'}}>
                 Ошибка сервера: {apiError}
              </div>
            )}
            <div className="finished-actions">
              <button className="btn btn-primary" onClick={() => setView('decks')}>В меню</button>
              <button className="btn btn-secondary" onClick={() => handleSyncDeck(currentDeck.id)}>Обновить данные</button>
              <button className="btn btn-secondary" onClick={() => handleResetProgress(currentDeck.id)}>Учить заново</button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};

import React from 'react';
import { ChevronLeft, Volume2, Edit2, Settings, RefreshCw, Plus, Sparkles } from 'lucide-react';
import { HelpButton } from '../TutorialOverlay';
import { UserProfileBadge } from '../common/UserBadge';

export const StudyHeader = ({
  deckName,
  card,
  loading,
  isAudioLoading,
  onBack,
  onOpenCreator,
  onStartTutorial,
  onQuickAudio,
  onOpenEditor,
  onOpenSettings,
  isTrainerDeck = false,
}) => (
  <div className="header-compact">
    <button className="back-btn" onClick={onBack}>
      <ChevronLeft size={24} />
    </button>
    <div className="header-study-info" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <h2>{deckName}</h2>
      {isTrainerDeck && (
        <span style={{
          fontSize: '0.7rem',
          fontWeight: 700,
          color: '#c084fc',
          background: 'rgba(168, 85, 247, 0.2)',
          border: '1px solid rgba(168, 85, 247, 0.4)',
          borderRadius: '8px',
          padding: '2px 6px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '3px',
          flexShrink: 0
        }}>
          🏋️ Тренажер
        </span>
      )}
    </div>
    <div className="header-actions">
      <UserProfileBadge />
      <button
        id="tut-study-add-card"
        className="header-action-btn"
        onClick={onOpenCreator}
        title="Добавить карточку"
      >
        <Plus size={22} />
      </button>

      <HelpButton onClick={onStartTutorial} />



      <button
        id="tut-study-gen-audio"
        className="header-action-btn"
        onClick={onQuickAudio}
        disabled={loading || !card}
        title="Добавить озвучку"
      >
        {isAudioLoading ? (
          card?.audio_is_generating ? (
            <Sparkles size={22} className="sparkles-spin" style={{ color: '#a855f7' }} />
          ) : (
            <RefreshCw size={22} className="spin" />
          )
        ) : (
          <Volume2 size={22} />
        )}
      </button>

      <button
        id="tut-study-edit-card"
        className="header-action-btn"
        onClick={onOpenEditor}
        disabled={!card}
        title="Редактировать"
      >
        <Edit2 size={22} />
      </button>

      <button
        className="header-action-btn settings-btn"
        onClick={onOpenSettings}
        title="Настройки"
      >
        <Settings size={22} />
      </button>
    </div>
  </div>
);

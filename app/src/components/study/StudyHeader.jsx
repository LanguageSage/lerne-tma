import React from 'react';
import { ChevronLeft, Edit2, Settings, Plus, Palette } from 'lucide-react';
import { HelpButton } from '../TutorialOverlay';
import { UserProfileBadge } from '../common/UserBadge';
import { useUiStore } from '../../store/useUiStore';

export const StudyHeader = ({
  deckName,
  card,
  onBack,
  onOpenCreator,
  onStartTutorial,
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

      <HelpButton onClick={onStartTutorial} />

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
        id="tut-study-design"
        className="header-action-btn design-btn"
        onClick={() => useUiStore.getState().openSettings('design')}
        title="Дизайн карточек"
        style={{ color: '#c084fc' }}
      >
        <Palette size={22} />
      </button>

      <button
        id="tut-study-settings"
        className="header-action-btn settings-btn"
        onClick={onOpenSettings}
        title="Настройки"
      >
        <Settings size={22} />
      </button>

      <button
        id="tut-study-add-card"
        className="header-action-btn study-add-card-btn"
        onClick={onOpenCreator}
        title="Добавить карточку"
      >
        <Plus size={22} />
      </button>
    </div>
  </div>
);

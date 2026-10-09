import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  ArrowLeft, 
  Play, 
  List, 
  Edit3, 
  Clock, 
  Layers, 
  Target, 
  CheckCircle, 
  Lightbulb,
  GraduationCap
} from 'lucide-react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { useDeckStore } from '../../store/useDeckStore';
import { useUiStore } from '../../store/useUiStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useAuthStore } from '../../store/useAuthStore';
import { navigateUp } from '../../utils/navigation';
import { parseDeckMetadata } from '../../utils/deckUtils';
import { computeDeckSrsStats } from '../../utils/sessionStats';
import { CourseProgressPlaceholder } from './CourseProgressPlaceholder';
import { DeckIntroEditModal } from './DeckIntroEditModal';
import './DeckIntro.css';

const CEFR_LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const LEVEL_CONFIG = {
  A1: { color: "#4ade80", bgColor: "rgba(74, 222, 128, 0.14)", borderColor: "rgba(74, 222, 128, 0.3)" },
  A2: { color: "#2dd4bf", bgColor: "rgba(45, 212, 191, 0.14)", borderColor: "rgba(45, 212, 191, 0.3)" },
  B1: { color: "#38bdf8", bgColor: "rgba(56, 189, 248, 0.14)", borderColor: "rgba(56, 189, 248, 0.3)" },
  B2: { color: "#818cf8", bgColor: "rgba(129, 140, 248, 0.14)", borderColor: "rgba(129, 140, 248, 0.3)" },
  C1: { color: "#c084fc", bgColor: "rgba(192, 132, 252, 0.14)", borderColor: "rgba(192, 132, 252, 0.3)" },
  C2: { color: "#f59e0b", bgColor: "rgba(245, 158, 11, 0.18)", borderColor: "rgba(245, 158, 11, 0.35)" }
};

export const DeckIntro = ({ startStudy }) => {
  useInterfaceLocale();

  const currentDeck = useDeckStore(state => state.currentDeck);
  const deckCards = useDeckStore(state => state.deckCards);
  const folders = useDeckStore(state => state.folders);
  const updateDeckMetadata = useDeckStore(state => state.updateDeckMetadata);

  const setView = useUiStore(state => state.setView);
  const showToast = useUiStore(state => state.showToast);
  const isSettingsAdmin = useSettingsStore(state => state.isAdmin);
  const isAuthAdmin = useAuthStore(state => state.userProfile?.is_admin);
  const isAdmin = Boolean(isSettingsAdmin || isAuthAdmin);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Parse existing metadata
  const metadata = useMemo(() => parseDeckMetadata(currentDeck), [currentDeck]);
  const intro = metadata.intro || {};

  // Check editing permissions
  const canEdit = useMemo(() => {
    if (!currentDeck) return false;
    if (isAdmin) return true;
    if (currentDeck.role === 'owner' || currentDeck.role === 'editor') return true;
    if (currentDeck.is_global_readonly) return false;
    return !currentDeck.role;
  }, [currentDeck, isAdmin]);

  // Determine CEFR level reliably from existing data
  const detectedLevel = useMemo(() => {
    if (intro.level && CEFR_LEVELS.has(String(intro.level).toUpperCase())) {
      return String(intro.level).toUpperCase();
    }
    if (currentDeck?.level && CEFR_LEVELS.has(String(currentDeck.level).toUpperCase())) {
      return String(currentDeck.level).toUpperCase();
    }
    if (currentDeck?.folder_id && folders) {
      let currentFolderId = currentDeck.folder_id;
      const visited = new Set();
      while (currentFolderId && !visited.has(currentFolderId)) {
        visited.add(currentFolderId);
        const folder = folders.find(f => f.id === currentFolderId);
        if (folder?.name) {
          const match = folder.name.match(/\b(A1|A2|B1|B2|C1|C2)\b/i);
          if (match) return match[1].toUpperCase();
        }
        currentFolderId = folder?.parent_id;
      }
    }
    return null;
  }, [intro.level, currentDeck, folders]);

  const levelStyle = detectedLevel ? LEVEL_CONFIG[detectedLevel] : null;
  const srsStats = useMemo(() => computeDeckSrsStats(currentDeck, deckCards), [currentDeck, deckCards]);

  if (!currentDeck) {
    return (
      <div className="deck-intro-container">
        <p style={{ textAlign: 'center', color: '#94a3b8', marginTop: '40px' }}>
          {tr("Колода не выбрана")}
        </p>
      </div>
    );
  }

  const title = intro.title || currentDeck.name;
  const topic = intro.topic || currentDeck.topic;
  const description = intro.description;
  const goal = intro.goal;
  const learningOutcomes = Array.isArray(intro.learning_outcomes) 
    ? intro.learning_outcomes.filter(Boolean) 
    : [];
  const estimatedTime = intro.estimated_time;
  const recommendations = intro.recommendations;
  const cardCount = srsStats.total || (Array.isArray(deckCards) && deckCards.length > 0 
    ? deckCards.length 
    : (currentDeck.card_count ?? 0));

  const handleStart = () => {
    if (startStudy) {
      startStudy(currentDeck);
    }
  };

  const handleShowList = () => {
    useUiStore.getState().setCardsScrollTop(0);
    useUiStore.getState().setLastSelectedCardId(null);
    setView('cards');
  };

  const handleSaveIntro = async (updatedIntro) => {
    try {
      const nextMetadata = {
        ...metadata,
        intro: updatedIntro
      };
      await updateDeckMetadata(currentDeck.id, nextMetadata);
      showToast(tr("Вступительная информация сохранена"), 'success');
    } catch {
      showToast(tr("Ошибка сохранения"), 'error');
    }
  };

  return (
    <div className="deck-intro-container">
      {/* Top action bar */}
      <div className="deck-intro-header-bar">
        <button
          type="button"
          className="deck-intro-back-btn"
          onClick={navigateUp}
          aria-label={tr("Назад")}
          title={tr("Назад")}
        >
          <ArrowLeft size={20} />
        </button>

        {canEdit && (
          <button
            type="button"
            className="deck-intro-edit-btn"
            onClick={() => setIsEditModalOpen(true)}
          >
            <Edit3 size={15} />
            <span>{tr("Редактировать")}</span>
          </button>
        )}
      </div>

      {/* Hero Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="deck-intro-hero glass"
      >
        <div className="deck-intro-top-meta">
          {detectedLevel && levelStyle && (
            <span
              className="deck-intro-level-badge"
              style={{
                color: levelStyle.color,
                background: levelStyle.bgColor,
                border: `1px solid ${levelStyle.borderColor}`
              }}
            >
              {detectedLevel}
            </span>
          )}

          {topic && (
            <span className="deck-intro-topic-badge">
              {topic}
            </span>
          )}
        </div>

        <h1 className="deck-intro-title">{title}</h1>

        {description && (
          <p className="deck-intro-desc">{description}</p>
        )}
      </motion.div>

      {/* Indicators row */}
      <div className="deck-intro-indicators">
        <div className="deck-intro-indicator-card glass">
          <div className="deck-intro-indicator-icon">
            <Layers size={18} />
          </div>
          <div className="deck-intro-indicator-content">
            <span className="deck-intro-indicator-label">{tr("Карточек")}</span>
            <span className="deck-intro-indicator-value">{cardCount}</span>
          </div>
        </div>

        {estimatedTime && (
          <div className="deck-intro-indicator-card glass">
            <div className="deck-intro-indicator-icon" style={{ color: '#f59e0b' }}>
              <Clock size={18} />
            </div>
            <div className="deck-intro-indicator-content">
              <span className="deck-intro-indicator-label">{tr("Время")}</span>
              <span className="deck-intro-indicator-value">{estimatedTime}</span>
            </div>
          </div>
        )}
      </div>

      {/* SRS Queue Progress Breakdown */}
      <div className="deck-intro-srs-block glass">
        <div className="deck-intro-srs-header">
          <span className="deck-intro-srs-title">{tr("Прогресс повторения")}</span>
        </div>
        <div className="deck-intro-srs-grid">
          <div className="deck-intro-srs-item">
            <span className="deck-intro-srs-dot dot-blue" />
            <span className="deck-intro-srs-value">{srsStats.new}</span>
            <span className="deck-intro-srs-label">{tr("новые")}</span>
          </div>
          <div className="deck-intro-srs-item">
            <span className="deck-intro-srs-dot dot-yellow" />
            <span className="deck-intro-srs-value">{srsStats.learning}</span>
            <span className="deck-intro-srs-label">{tr("изучаю")}</span>
          </div>
          <div className="deck-intro-srs-item">
            <span className="deck-intro-srs-dot dot-red" />
            <span className="deck-intro-srs-value">{srsStats.due}</span>
            <span className="deck-intro-srs-label">{tr("повторить")}</span>
          </div>
        </div>
      </div>

      {/* Goal section (only if present) */}
      {goal && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="deck-intro-section glass"
        >
          <div className="deck-intro-section-header">
            <Target size={18} className="deck-intro-section-icon" />
            <span>{tr("Цель занятия")}</span>
          </div>
          <p className="deck-intro-section-text">{goal}</p>
        </motion.div>
      )}

      {/* Learning outcomes (only if present) */}
      {learningOutcomes.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="deck-intro-section glass"
        >
          <div className="deck-intro-section-header">
            <GraduationCap size={18} className="deck-intro-section-icon" />
            <span>{tr("Чему вы научитесь")}</span>
          </div>
          <ul className="deck-intro-outcomes-list">
            {learningOutcomes.map((item, idx) => (
              <li key={idx} className="deck-intro-outcome-item">
                <CheckCircle size={16} className="deck-intro-outcome-check" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {/* Recommendations (only if present) */}
      {recommendations && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="deck-intro-section glass"
        >
          <div className="deck-intro-section-header">
            <Lightbulb size={18} className="deck-intro-section-icon" style={{ color: '#eab308' }} />
            <span>{tr("Рекомендации")}</span>
          </div>
          <p className="deck-intro-section-text">{recommendations}</p>
        </motion.div>
      )}

      {/* Course progress placeholder (isolated, hidden by default for users) */}
      <CourseProgressPlaceholder isVisible={false} />

      {/* Primary Actions */}
      <div className="deck-intro-actions">
        <button
          type="button"
          className="deck-intro-btn-start"
          onClick={handleStart}
        >
          <Play size={22} fill="currentColor" />
          <span>{tr("Начать занятие")}</span>
        </button>

        <button
          type="button"
          className="deck-intro-btn-list"
          onClick={handleShowList}
        >
          <List size={18} />
          <span>{tr("Показать список")}</span>
        </button>
      </div>

      {/* Admin edit modal */}
      {canEdit && (
        <DeckIntroEditModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          deck={currentDeck}
          currentIntro={intro}
          onSave={handleSaveIntro}
        />
      )}
    </div>
  );
};

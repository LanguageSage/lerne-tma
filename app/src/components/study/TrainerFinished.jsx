import React from 'react';
import { Trophy, CheckCircle2, RotateCcw, ArrowLeft, Clock, Target, AlertTriangle } from 'lucide-react';
import { useTranslation } from '../../i18n/i18nContext';

export const TrainerFinished = ({
  totalCards = 0,
  correctFirstTry = 0,
  wrongCount = 0,
  elapsedSeconds = 0,
  onRetryWrong,
  onRestart,
  onGoToDecks
}) => {
  const { t } = useTranslation();

  const scorePercentage = totalCards > 0 ? Math.round((correctFirstTry / totalCards) * 100) : 0;
  const isSuccess = scorePercentage >= 80;

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="finished-view glass trainer-finished-card animate-fade-in" style={{ padding: '24px', textAlign: 'center', maxWidth: '440px', margin: '0 auto' }}>
      <div className="finished-header" style={{ marginBottom: '20px' }}>
        {isSuccess ? (
          <div className="icon-wrapper success" style={{ display: 'inline-flex', padding: '16px', borderRadius: '50%', background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', marginBottom: '12px' }}>
            <Trophy size={48} />
          </div>
        ) : (
          <div className="icon-wrapper warning" style={{ display: 'inline-flex', padding: '16px', borderRadius: '50%', background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', marginBottom: '12px' }}>
            <Target size={48} />
          </div>
        )}

        <h2 style={{ fontSize: '1.5rem', fontWeight: '700', margin: '0 0 6px 0' }}>
          {isSuccess 
            ? t('trainer.done_success', 'Тест пройден! 🎉') 
            : t('trainer.done_partial', 'Занятие завершено! 💡')}
        </h2>
        <p style={{ opacity: 0.8, fontSize: '0.95rem', margin: 0 }}>
          {isSuccess 
            ? t('trainer.subtitle_success', 'Отличный результат, тема освоена!') 
            : t('trainer.subtitle_partial', 'Попробуйте еще раз для лучшего результата')}
        </p>
      </div>

      {/* Main Score Metrics */}
      <div className="trainer-stats-grid" style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr', 
        gap: '12px', 
        marginBottom: '24px' 
      }}>
        <div className="stat-card glass" style={{ padding: '14px', borderRadius: '14px', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <Target size={14} /> {t('trainer.accuracy', 'Точность')}
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800', color: isSuccess ? '#22c55e' : '#f59e0b' }}>
            {scorePercentage}%
          </div>
          <div style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '2px' }}>
            {correctFirstTry} из {totalCards} с 1-й попытки
          </div>
        </div>

        <div className="stat-card glass" style={{ padding: '14px', borderRadius: '14px', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <Clock size={14} /> {t('trainer.time_spent', 'Время')}
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#a855f7' }}>
            {formatTime(elapsedSeconds)}
          </div>
          <div style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '2px' }}>
            мин:сек
          </div>
        </div>
      </div>

      {wrongCount > 0 && (
        <div className="wrong-summary-box glass" style={{ 
          padding: '12px 16px', 
          borderRadius: '12px', 
          background: 'rgba(239, 68, 68, 0.1)', 
          border: '1px solid rgba(239, 68, 68, 0.3)', 
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '0.88rem',
          color: '#f87171'
        }}>
          <AlertTriangle size={18} style={{ flexShrink: 0 }} />
          <div style={{ textAlign: 'left' }}>
            Ошибок: <strong>{wrongCount}</strong>. Рекомендуется повторить эти карточки!
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="finished-actions" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {wrongCount > 0 && onRetryWrong && (
          <button 
            className="btn btn-primary" 
            onClick={onRetryWrong}
            style={{ width: '100%', padding: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
          >
            <RotateCcw size={18} /> {t('trainer.retry_wrong', 'Пройти ошибки')} ({wrongCount})
          </button>
        )}

        <button 
          className={wrongCount > 0 ? "btn btn-secondary" : "btn btn-primary"} 
          onClick={onRestart}
          style={{ width: '100%', padding: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        >
          <RotateCcw size={18} /> {t('trainer.restart_all', 'Пройти заново')}
        </button>

        <button 
          className="btn btn-secondary" 
          onClick={onGoToDecks}
          style={{ width: '100%', padding: '12px', opacity: 0.9, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        >
          <ArrowLeft size={18} /> {t('study.back_to_decks', 'К списку колод')}
        </button>
      </div>
    </div>
  );
};

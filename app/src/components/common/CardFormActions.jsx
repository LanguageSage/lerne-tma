import { BookOpen, RefreshCw, Sparkles, X } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { useTranslation } from '../../i18n/i18nContext';
import { CardQuestionComposer } from '../study/CardQuestionComposer';

export function CardSaveButton({ onSave, disabled, loading = false, style }) {
  const { t } = useTranslation();
  const label = t('creator.save', 'Сохранить');
  return (
    <button type="button" className="btn btn-primary btn-save-action" aria-label={label}
      onClick={() => onSave()} disabled={disabled} style={{ minHeight: '44px', ...style }}>
      {loading ? <RefreshCw className="spin" size={18} /> : label}
    </button>
  );
}

export function CardFormActions({ isCreator, type, frontText, onAiGenerate, onStopGeneration, onSave, loading, audioBusy }) {
  const { t } = useTranslation();
  const isExistingQuiz = !isCreator && type === 'quiz';
  const hasFrontText = Boolean(frontText.trim());

  return (
    <div className={`ai-quick-actions ${loading || isExistingQuiz ? 'no-dynamic' : 'has-dynamic'}`} style={{ gap: '6px' }}>
      {loading ? (
        <button
          type="button"
          className="btn-ai-generate loading"
          onClick={onStopGeneration}
          style={{ flex: 1, background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#fca5a5' }}
        >
          <X size={18} />
          <span>{tr("Отменить")}</span>
        </button>
      ) : (
        <>
          <button type="button" className="btn-ai-generate secondary-action-btn"
            onClick={() => onAiGenerate(isExistingQuiz ? 'quiz_analysis' : 'explain_rule')}
            disabled={!hasFrontText}
            style={{
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(147, 197, 253, 0.12))',
              borderColor: 'rgba(59, 130, 246, 0.4)',
              color: '#93c5fd'
            }}
          >
            <BookOpen size={16} />
            <span>{isExistingQuiz ? tr("📝 Разбор теста") : tr("📖 Правило")}</span>
          </button>
          {!isExistingQuiz && <button type="button" className="btn-ai-generate"
            onClick={() => onAiGenerate('full_card')} disabled={!hasFrontText}>
            <Sparkles size={16} />
            <span>{t('creator.ai_generate', 'Генерировать ✨')}</span>
          </button>}
        </>
      )}
      {!isCreator && <CardQuestionComposer onSubmit={request => onAiGenerate('custom_directive', request)}
        icon="✨" triggerLabel={tr("Выполнить просьбу")} title={tr("Что изменить в карточке?")} disabled={loading} />}
      <CardSaveButton onSave={onSave} disabled={loading || audioBusy} loading={loading} style={{ padding: '8px 16px' }} />
    </div>
  );
}

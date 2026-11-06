import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Plus, Settings } from 'lucide-react';
import { HelpButton } from '../TutorialOverlay';
import { CardForm } from '../common/CardForm';
import { useUiStore } from '../../store/useUiStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useCardActions } from '../../hooks/useCardActions';
import { useAudio } from '../../hooks/useAudio';


import { navigateUp } from '../../utils/navigation';
import { LocalPublishButton } from '../common/LocalPublishButton';
import { getSessionIdentity, getUserId } from '../../utils/auth';
import { resolveCardEdit } from '../../services/offlineApi';
import { offlineEditLabel } from '../../services/offlineUi';
import { notifyCardEdit, syncService } from '../../services/syncService';
import { studySideText } from '../../utils/structuredStudyCard';

function EditVersion({ title, card }) {
  const content = card.content_v2.card;
  const media = Object.fromEntries(Object.entries(card).filter(([key, value]) => key.endsWith('_path') && value));
  return (
    <div className="card-edit-version glass">
      <h4>{title}</h4>
      <p>{studySideText(content)}</p>
      <p>{studySideText(content, 'back')}</p>
      <details>
        <summary>{tr('Все поля и медиа')}</summary>
        <pre>{JSON.stringify({ ...content, ...media }, null, 2)}</pre>
      </details>
    </div>
  );
}

export const CardEditor = () => {
  useInterfaceLocale();
  const { view, setIsSettingsOpen, showToast } = useUiStore();
  const { editingCard, setEditingCard } = useSessionStore();
  const { runAiGenerator, stopAiGeneration, saveCard, generateAudioInternal } = useCardActions();
  const { playAudio } = useAudio();

  const [animDone, setAnimDone] = React.useState(false);
  const [editingDraft, setEditingDraft] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (view === 'editor') {
      setAnimDone(false);
      setEditingDraft(false);
    }
  }, [view]);

  if (view !== 'editor') return null;

  const handleAiGenerate = async (actionType = 'full_card', userRequest = '') => {
    const content = editingCard?.content_v2;
    if (!content) return;
    const result = await runAiGenerator(content, true, actionType, userRequest);
    if (result?.content_v2) {
      setEditingCard(current => current?.content_v2 === content ? { ...current, content_v2: result.content_v2 } : current);
    }
    return result;
  };

  const handleBack = () => {
    navigateUp();
  };

  const edit = editingCard?.offline_edit;
  const conflict = edit?.status === 'conflict';
  const merging = conflict && editingDraft;
  const handleSave = async (awaitDelivery = false) => {
    const saved = await saveCard(null, { awaitDelivery });
    if (saved) setEditingDraft(false);
    return saved;
  };

  const resolve = async (keepLocal) => {
    if (busy) return;
    setBusy(true);
    const identity = getSessionIdentity();
    try {
      if (keepLocal !== undefined) {
        const card = await resolveCardEdit(editingCard.id, edit, keepLocal);
        if (identity !== getSessionIdentity()) return;
        notifyCardEdit(card, getUserId());
      }
      if (keepLocal !== false) {
        const result = await syncService.sync({ pendingNativeOnly: true });
        if (!result.success && identity === getSessionIdentity()) {
          showToast(typeof result.reason === 'string' ? result.reason : tr('Ошибка синхронизации. Карточка сохранена на устройстве.'), 'warning');
        }
      }
    } catch (error) {
      if (identity === getSessionIdentity()) showToast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view-editor">
      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        onAnimationComplete={() => setAnimDone(true)}
        style={animDone ? { transform: 'none' } : {}}
        className="view"
      >
        <div className="header-compact">
          <button className="back-btn" onClick={handleBack}><ChevronLeft size={24} /></button>
          <h2>{tr("Правка карточки")}</h2>
          <div className="header-actions">
            <button className="header-action-btn" disabled={true} title={tr("Добавить карточку")}>
              <Plus size={22} />
            </button>
            <HelpButton topic="creator" />
            <button 
              className="header-action-btn settings-btn" 
              onClick={() => setIsSettingsOpen(true)}
              title={tr("Настройки")}
            >
              <Settings size={22} />
            </button>
          </div>
        </div>

        {edit && (
          <section className="card-edit-panel" aria-label={tr('Синхронизация карточки')}>
            <h3 role="status">{offlineEditLabel(edit)}</h3>
            {edit.error && <p role="alert">{edit.error}</p>}
            <div className="card-edit-versions">
              <EditVersion title={tr('Локальная версия')} card={editingCard} />
              {edit.server && <EditVersion title={tr('Серверная версия')} card={edit.server} />}
            </div>
            {conflict && !edit.server && <p>{tr('Серверная версия ещё недоступна. Локальный черновик сохранён.')}</p>}
            {edit.server?.is_deleted && <p>{tr('Сначала восстановите карточку из корзины.')}</p>}
            {merging ? <p>{tr('Сохраните объединённый вариант, затем подтвердите его отправку.')}</p> : (
              <div className="card-edit-actions">
                {!editingDraft && <button type="button" className="btn btn-secondary" disabled={busy}
                  onClick={() => setEditingDraft(true)}>{tr('Продолжить редактирование')}</button>}
                {conflict && edit.server ? <>
                  <button type="button" className="btn btn-secondary" disabled={busy}
                    onClick={() => resolve(false)}>{tr('Оставить серверную версию')}</button>
                  <button type="button" className="btn btn-primary" disabled={busy || edit.server.is_deleted}
                    onClick={() => resolve(true)}>{tr('Сохранить мою версию')}</button>
                </> : (edit.status !== 'error' || edit.httpStatus !== 422) &&
                  <button type="button" className="btn btn-secondary" disabled={busy}
                    onClick={() => resolve()}>{tr('Повторить синхронизацию')}</button>}
              </div>
            )}
          </section>
        )}
        {(!edit || editingDraft) && (
          <CardForm
            cardData={editingCard}
            setCardData={setEditingCard}
            onSave={() => handleSave()}
            onAiGenerate={handleAiGenerate}
            onStopGeneration={stopAiGeneration}
            onGenerateAudio={generateAudioInternal}
            playAudio={playAudio}
            isCreator={false}
          />
        )}
        {!edit && <LocalPublishButton cardId={editingCard?.id} beforeOpen={async () => {
          const saved = await handleSave(true);
          return saved?.offline_edit ? null : saved;
        }} />}

      </motion.div>
    </div>
  );
};

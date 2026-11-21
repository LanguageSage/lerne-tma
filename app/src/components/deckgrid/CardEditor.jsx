import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { CardForm } from '../common/CardForm';
import { CardEditorShell } from './CardEditorShell';
import { useUiStore } from '../../store/useUiStore';
import { useSessionStore } from '../../store/useSessionStore';
import { saveCard } from '../../services/cardSave';
import { LocalPublishButton } from '../common/LocalPublishButton';
import { getSessionIdentity, getUserId } from '../../utils/auth';
import { resolveCardEdit } from '../../services/offlineApi';
import { offlineEditLabel } from '../../services/offlineUi';
import { notifyCardEdit, syncService } from '../../services/syncService';
import { studySideText } from '../../utils/structuredStudyCard';
import { navigateUp } from '../../utils/navigation';
import { IS_STANDALONE } from '../../utils/standaloneMode.js';

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

export const CardEditor = ({ onDelete = null }) => {
  useInterfaceLocale();
  const showToast = useUiStore(state => state.showToast);
  const loading = useUiStore(state => state.loading);
  const editingCard = useSessionStore(state => state.editingCard);
  const setEditingCard = useSessionStore(state => state.setEditingCard);
  const [editingDraft, setEditingDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState(() => ({
    id: editingCard?.id ?? null,
    json: editingCard ? JSON.stringify(editingCard) : '',
  }));
  if (initialSnapshot.id !== (editingCard?.id ?? null)) {
    setInitialSnapshot({
      id: editingCard?.id ?? null,
      json: editingCard ? JSON.stringify(editingCard) : '',
    });
  }

  const edit = editingCard?.offline_edit;
  const conflict = edit?.status === 'conflict';
  const merging = conflict && editingDraft;
  const handleCancel = () => {
    if (IS_STANDALONE && editingCard && JSON.stringify(editingCard) !== initialSnapshot.json) {
      if (!window.confirm(tr('Отменить редактирование? Несохранённые изменения будут потеряны.'))) {
        return;
      }
    }
    if (IS_STANDALONE) {
      setEditingCard(null);
    }
    navigateUp();
  };
  const handleSave = async (awaitDelivery = false) => {
    setEditingDraft(true);
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
        if (!result.native_success && identity === getSessionIdentity()) {
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
    <CardEditorShell view="editor" title={tr('Правка карточки')} onBack={IS_STANDALONE ? handleCancel : null}>
      {editingCard?.offline_create_error && <p role="alert">{editingCard.offline_create_error}</p>}
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
          onSave={handleSave}
          onCancel={IS_STANDALONE ? handleCancel : null}
        />
      )}
      {!IS_STANDALONE && !edit && editingCard?.id > 0 && <LocalPublishButton cardId={editingCard.id} beforeOpen={async () => {
        const saved = await handleSave(true);
        return saved?.offline_edit ? null : saved;
      }} />}
      {IS_STANDALONE && !edit && editingCard?.id > 0 && onDelete && (
        <div className="standalone-editor-danger-zone">
          <button
            type="button"
            className="btn-secondary standalone-editor-delete-btn"
            data-testid="standalone-editor-delete-btn"
            disabled={busy || loading}
            onClick={() => onDelete(editingCard.id)}
          >
            <Trash2 size={16} aria-hidden="true" />
            <span>{tr('Удалить карточку')}</span>
          </button>
        </div>
      )}
    </CardEditorShell>
  );
};

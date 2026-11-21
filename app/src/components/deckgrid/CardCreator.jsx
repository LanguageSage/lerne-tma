import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n/i18nContext';
import { tr } from '../../i18n/locale';
import { CardForm } from '../common/CardForm';
import { CardEditorShell } from './CardEditorShell';
import { useDeckStore } from '../../store/useDeckStore';
import { useSessionStore } from '../../store/useSessionStore';
import { saveCard } from '../../services/cardSave';
import { newCardContent } from '../../utils/cardDraft';
import { navigateUp } from '../../utils/navigation';
import { IS_STANDALONE } from '../../utils/standaloneMode.js';

function createDraft(currentDeckId) {
  const card = useSessionStore.getState().editingCard;
  return {
    content_v2: newCardContent(),
    flag: 0,
    deck_id: card?.deck_id !== undefined ? card.deck_id : currentDeckId || '',
    after_card_id: card?.after_card_id || null,
  };
}

export const CardCreator = () => {
  const { t } = useTranslation();
  const currentDeckId = useDeckStore(state => state.currentDeck?.id);
  const [sourceDeckId, setSourceDeckId] = useState(currentDeckId);
  const [newCardData, setNewCardData] = useState(() => createDraft(currentDeckId));
  const [initialDraftJson, setInitialDraftJson] = useState(() => JSON.stringify(newCardData));
  const liveDraft = useRef(newCardData);
  useLayoutEffect(() => {
    liveDraft.current = newCardData;
  }, [newCardData]);
  const setDraft = updater => {
    const next = typeof updater === 'function' ? updater(liveDraft.current) : updater;
    liveDraft.current = next;
    setNewCardData(next);
  };

  // The destination picker changes the draft, while the current deck starts a new one.
  if (sourceDeckId !== currentDeckId) {
    const nextDraft = createDraft(currentDeckId);
    setSourceDeckId(currentDeckId);
    setNewCardData(nextDraft);
    setInitialDraftJson(JSON.stringify(nextDraft));
  }

  const handleCancel = () => {
    if (IS_STANDALONE && JSON.stringify(liveDraft.current) !== initialDraftJson) {
      if (!window.confirm(tr('Отменить создание карточки? Несохранённые изменения будут потеряны.'))) {
        return;
      }
    }
    if (IS_STANDALONE) {
      useSessionStore.getState().setEditingCard(null);
    }
    navigateUp();
  };

  return (
    <CardEditorShell
      view="creator"
      title={t('creator.title', 'Новая карточка')}
      settingsTitle={t('settings.title', 'Настройки')}
      onBack={IS_STANDALONE ? handleCancel : null}
    >
      {newCardData.offline_create_error && <p role="alert">{newCardData.offline_create_error}</p>}
      <CardForm
        cardData={newCardData}
        setCardData={setDraft}
        onSave={() => saveCard(liveDraft.current, {
          getDraft: () => useDeckStore.getState().currentDeck?.id === sourceDeckId ? liveDraft.current : null,
          setDraft,
        })}
        onCancel={IS_STANDALONE ? handleCancel : null}
        isCreator
      />
    </CardEditorShell>
  );
};

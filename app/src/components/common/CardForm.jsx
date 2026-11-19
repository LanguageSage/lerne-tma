import { useEffect, useMemo, useRef, useState } from 'react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { useAiActions } from '../../hooks/useAiActions';
import { useAudio } from '../../hooks/useAudio';
import { useMediaUpload } from '../../hooks/useMediaUpload';
import { useDeckStore } from '../../store/useDeckStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { getDesignStylesFromV2 } from '../../utils/cardStyles';
import { attachDraftImage, changeDraft, changeDraftSource, draftSourceError } from '../../utils/cardDraft';
import { studySideText } from '../../utils/structuredStudyCard';
import { getFlagStyle } from '../../constants/cardFlags';
import { getResolvedStyle } from '../../utils/style';
import { CardBackground } from './CardBackground';
import { CardTypeField, PromptDictation, StructuredCardExtras } from './StructuredCardFields';
import { TrainerCardFields } from './TrainerCardFields';
import { QuizCardFields } from './QuizCardFields';
import { WordBankCardFields } from './WordBankCardFields';
import { PuzzleCardFields } from './PuzzleCardFields';
import { TextCardFields } from './TextCardFields';
import { MatchCardFields } from './MatchCardFields';
import { AnswerGradingFields, EditableTextCardFields, FreeTextCardFields } from './WrittenCardFields';
import { MediaPicker } from './MediaPicker';
import { ImageEditorModal } from './ImageEditorModal';
import { CardLevelControls } from './CardLevelControls';
import { CardCoverPreview, CardMediaFields } from './CardFormMedia';
import { CardFormDetails } from './CardFormDetails';
import { CardFormActions, CardSaveButton } from './CardFormActions';
import './CardForm.css';

const visualCardFields = {
  standard: TextCardFields, theory: TextCardFields, match: MatchCardFields,
  free_text: FreeTextCardFields, editable_text: EditableTextCardFields, quiz: QuizCardFields,
  word_bank: WordBankCardFields, puzzle: PuzzleCardFields, trainer: TrainerCardFields,
};

function preserveInlineFieldFocus(event) {
  const { ownerDocument } = event.currentTarget;
  if (event.button === 0 && event.target.closest(
    '.btn-save-action, .visual-card-layout-insert, .match-editor-add, .match-editor-remove, .trainer-editor button',
  )
    && ownerDocument.activeElement?.matches('.visual-card-inline-field > textarea')) {
    // Leaving an inline field can move the button before its click.
    event.preventDefault();
  }
}

function CardDeckField({ deckId, setCardData }) {
  const decks = useDeckStore(state => state.decks) ?? [];
  return (
    <div className="form-group" style={{ marginBottom: '8px' }}>
      <label className="sub-label" style={{ marginBottom: '4px', fontSize: '0.75rem', opacity: 0.7 }}>{tr("ВЫБЕРИТЕ КОЛОДУ")}</label>
      <select
        className="form-input"
        value={deckId || ''}
        onChange={event => {
          const deck_id = Number(event.target.value);
          setCardData(current => ({ ...current, deck_id }));
        }}
        style={{
          width: '100%',
          padding: '8px 12px',
          borderRadius: '10px',
          background: '#1e293b',
          color: '#ffffff',
          border: '1px solid rgba(255,255,255,0.1)',
          fontSize: '0.9rem',
          fontWeight: '500'
        }}
      >
        <option value="" disabled style={{ background: '#1e293b', color: '#ffffff' }}>{tr("-- Выберите колоду --")}</option>
        {decks.map(d => (
          <option key={d.id} value={d.id} style={{ background: '#1e293b', color: '#ffffff' }}>{d.name}</option>
        ))}
      </select>
    </div>
  );
}

export const CardForm = ({ cardData, setCardData, onSave, isCreator = false }) => {
  useInterfaceLocale();
  const content = cardData?.content_v2?.card;
  const VisualFields = visualCardFields[content?.type];
  const writtenAnswer = content?.type === 'free_text' || content?.type === 'editable_text';
  const composed = writtenAnswer || [TextCardFields, MatchCardFields, TrainerCardFields].includes(VisualFields);
  const update = patch => changeDraft(setCardData, patch);
  const personalConfig = useSettingsStore(state => state.personalDesignV2?.config);
  const effectiveConfig = useSettingsStore(state => state.activeDesignConfig);
  const textStyles = useMemo(() => getDesignStylesFromV2(effectiveConfig), [effectiveConfig]);
  const loading = useUiStore(state => state.loading);
  const creatorDeckId = useDeckStore(state => isCreator ? state.currentDeck?.id : undefined);
  const { runAiGenerator, stopAiGeneration, generateAudioInternal } = useAiActions();
  const { playAudio } = useAudio();
  const { uploadCreatorImage } = useMediaUpload();

  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [isEditingExistingImage, setIsEditingExistingImage] = useState(false);
  const mediaDraftKey = isCreator ? creatorDeckId : cardData?.id;
  const coverUpload = useRef(null);
  useEffect(() => () => {
    coverUpload.current?.abort();
    coverUpload.current = null;
  }, [isCreator, mediaDraftKey]);
  const uploadCover = async file => {
    if (!file || coverUpload.current) return;
    const request = new AbortController();
    coverUpload.current = request;
    try { await uploadCreatorImage(file, cardData.id, setCardData, request.signal); }
    finally { if (coverUpload.current === request) coverUpload.current = null; }
  };

  if (!cardData) return null;
  if (!content || !VisualFields) return <p role="alert">{tr('Карточки ещё не перенесены в Structured Cards V2.')}</p>;

  const frontText = studySideText(content);
  const flagStyle = getFlagStyle(cardData.flag);
  const source = cardData.content_v2_source ?? null;
  const isSourceMode = source !== null;
  const setSource = text => changeDraftSource(setCardData, text);
  const sourceError = draftSourceError(cardData);
  const sourceDisabled = loading || audioBusy || Boolean(sourceError);
  const dictation = isCreator && <PromptDictation type={content.type} update={update} />;
  const resolvedBgFront = getResolvedStyle(personalConfig?.front?.card?.background, cardData.id || 0);
  const resolvedBgBack = getResolvedStyle(personalConfig?.back?.card?.background, cardData.id || 0);
  const backBackground = <CardBackground background={effectiveConfig?.back?.card?.background}
    styleType={resolvedBgBack} cardId={cardData.id} />;

  const handleAiGenerate = async (actionType, userRequest = '') => {
    const envelope = cardData.content_v2;
    const result = await runAiGenerator(envelope, true, actionType, userRequest);
    if (result?.content_v2) {
      setCardData(current => current?.content_v2 === envelope
        ? { ...current, content_v2: result.content_v2 } : current);
    }
    return result;
  };

  const clearCover = () => {
    coverUpload.current?.abort();
    setCardData(current => ({ ...current, image_path: '', image_url: '' }));
  };

  return (
    <div className={`creator-form glass${composed ? ' visual-card-form' : ''}`} data-card-type={content.type}
      style={{ marginTop: '4px' }} onPointerDown={composed ? preserveInlineFieldFocus : undefined}>
      <button type="button" className="btn-secondary" style={{ minHeight: '44px' }}
        disabled={sourceDisabled}
        onClick={() => setSource(source === null ? JSON.stringify(cardData.content_v2, null, 2) : null)}>
        {source === null ? tr('Исходный JSON') : tr('Типизированная форма')}
      </button>
      {source !== null && <div className="card-form-text-field card-editor-field">
        <label htmlFor="card-editor-json">{tr('Полный content_v2 JSON')}</label>
        <textarea id="card-editor-json" className="textarea-preview card-editor-raw" rows={18} spellCheck={false}
          value={source} onChange={event => setSource(event.target.value)}
          aria-invalid={Boolean(sourceError)} aria-describedby={sourceError ? 'card-editor-json-error' : undefined}
          style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', minHeight: '280px' }} />
        {sourceError && <p id="card-editor-json-error" role="alert">{tr(sourceError)}</p>}
        {Boolean(cardData.pendingLayoutImages?.length) &&
          <p role="status">{tr('Загруженные изображения будут добавлены после исправления JSON.')}</p>}
        <CardSaveButton onSave={onSave} disabled={sourceDisabled} />
      </div>}
      <div hidden={isSourceMode}>
        {isCreator && <CardDeckField deckId={cardData.deck_id} setCardData={setCardData} />}

        <CardMediaFields cardData={cardData} setCardData={setCardData}
          openImagePicker={() => setIsImagePickerOpen(true)}
          generateAudio={() => generateAudioInternal(cardData, setCardData, playAudio)}
          loading={loading} audioBusy={audioBusy} setAudioBusy={setAudioBusy} />

        <CardTypeField card={content} update={update} />
        <div className="form-group card-container study-flashcard visual-card-editor-surface" style={flagStyle}>
          <div
            id="tut-creator-front"
            className="card-inner glass card-front"
            style={flagStyle}
          >
            <CardBackground background={effectiveConfig?.front?.card?.background} styleType={resolvedBgFront} cardId={cardData.id} />

            <div className="card-face">
              <VisualFields key={cardData.id} cardData={cardData} update={update} dictation={dictation}
                designConfig={effectiveConfig} textStyles={textStyles} />
            </div>
            <CardCoverPreview cardData={cardData} setCardData={setCardData}
              onEdit={() => setIsEditingExistingImage(true)} onClear={clearCover} />
            <CardLevelControls cardData={cardData} frontText={frontText} update={update} />
          </div>
        </div>

        {writtenAnswer && <AnswerGradingFields card={content} update={update} />}
        <StructuredCardExtras key={mediaDraftKey} card={content} update={update}
          attachImage={path => attachDraftImage(setCardData, cardData.id, path)} />

        <CardFormActions isCreator={isCreator} type={content.type} frontText={frontText}
          onAiGenerate={handleAiGenerate} onStopGeneration={stopAiGeneration} onSave={onSave}
          loading={loading} audioBusy={audioBusy} />
        <CardFormDetails content={content} update={update} backBackground={backBackground}
          textStyles={textStyles} isSourceMode={isSourceMode} />

        <MediaPicker
          isOpen={isImagePickerOpen}
          onClose={() => setIsImagePickerOpen(false)}
          onImageUpload={uploadCover}
          searchQuery={frontText || ''}
          loading={loading}
        />

        <ImageEditorModal
          isOpen={isEditingExistingImage}
          onClose={() => setIsEditingExistingImage(false)}
          imageSrc={cardData.image_url || (cardData.image_path ? `/api/media/${cardData.image_path}` : '')}
          onSave={(editedFile) => {
            setIsEditingExistingImage(false);
            uploadCover(editedFile);
          }}
          title={tr("Редактировать картинку")}
        />
      </div>
    </div>
  );
};

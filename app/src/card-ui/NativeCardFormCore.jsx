import React, { useEffect, useMemo, useRef, useState } from 'react';
import { tr } from '../i18n/locale.js';
import { useInterfaceLocale } from '../i18n/useInterfaceLocale.js';
import { DEFAULT_DESIGN_CONFIG_V2 } from '../design/designConfig.js';
import { designConfigToCssVariables } from '../design/designTokens.js';
import { getDesignStylesFromV2 } from '../utils/cardStyles.js';
import { attachDraftImage, changeDraft, changeDraftSource, draftSourceError } from '../utils/cardDraft.js';
import { studySideText } from '../utils/structuredStudyCard.js';
import { MediaResolverProvider, defaultResolveMediaUrl, defaultResolveAudioUrl } from './MediaResolverContext.jsx';
import { getFlagStyle } from '../constants/cardFlags.js';
import { getResolvedStyle } from '../utils/style.js';
import { CardBackground } from '../components/common/CardBackground.jsx';
import { CardTypeField, PromptDictation, StructuredCardExtras } from '../components/common/StructuredCardFields.jsx';
import { TrainerCardFields } from '../components/common/TrainerCardFields.jsx';
import { QuizCardFields } from '../components/common/QuizCardFields.jsx';
import { WordBankCardFields } from '../components/common/WordBankCardFields.jsx';
import { PuzzleCardFields } from '../components/common/PuzzleCardFields.jsx';
import { TextCardFields } from '../components/common/TextCardFields.jsx';
import { MatchCardFields } from '../components/common/MatchCardFields.jsx';
import { AnswerGradingFields, EditableTextCardFields, FreeTextCardFields } from '../components/common/WrittenCardFields.jsx';
import { MediaPicker } from '../components/common/MediaPicker.jsx';
import { ImageEditorModal } from '../components/common/ImageEditorModal.jsx';
import { CardLevelControls } from '../components/common/CardLevelControls.jsx';
import { CardCoverPreview, CardMediaFields } from '../components/common/CardFormMedia.jsx';
import { CardFormDetails } from '../components/common/CardFormDetails.jsx';
import { CardFormActions, CardSaveButton } from '../components/common/CardFormActions.jsx';
import '../components/common/CardForm.css';
import './CardUiScoped.css';

const visualCardFields = {
  standard: TextCardFields,
  theory: TextCardFields,
  match: MatchCardFields,
  free_text: FreeTextCardFields,
  editable_text: EditableTextCardFields,
  quiz: QuizCardFields,
  word_bank: WordBankCardFields,
  puzzle: PuzzleCardFields,
  trainer: TrainerCardFields,
};

function preserveInlineFieldFocus(event) {
  const { ownerDocument } = event.currentTarget;
  if (
    event.button === 0 &&
    event.target.closest('.btn-save-action, .visual-card-layout-insert, .match-editor-add, .match-editor-remove, .trainer-editor button') &&
    ownerDocument.activeElement?.matches('.visual-card-inline-field > textarea')
  ) {
    // Leaving an inline field can move the button before its click.
    event.preventDefault();
  }
}

export const NativeCardFormCore = ({
  cardData,
  setCardData,
  onSave,
  onCancel = null,
  isCreator = false,
  loading = false,
  deck = null,
  deckLanguage = null,
  mediaDraftKey = null,
  designConfig = DEFAULT_DESIGN_CONFIG_V2,
  resolvedBgFront: providedBgFront = '',
  resolvedBgBack: providedBgBack = '',
  topSlot = null,
  enableDictation = isCreator,
  onUploadCoverImage = null,
  onUploadLayoutImage = null,
  onUploadAudio = null,
  getSessionIdentity = null,
  resolveMediaUrl = defaultResolveMediaUrl,
  resolveAudioUrl = defaultResolveAudioUrl,
  isLocalAssetUrl = null,
  allowRemoteImageSearch = false,
  onFetchRemoteImage = null,
  onGenerateAudio = null,
  onAiGenerate = null,
  onStopGeneration = null,
  onNotify = null,
  lockLayout = false,
  allowOfflineAudioUpload = false,
  hideCoverHeightSlider = false,
}) => {
  useInterfaceLocale();

  const content = cardData?.content_v2?.card;
  const VisualFields = visualCardFields[content?.type];
  const writtenAnswer = content?.type === 'free_text' || content?.type === 'editable_text';
  const composed = writtenAnswer || [TextCardFields, MatchCardFields, TrainerCardFields].includes(VisualFields);
  const update = patch => changeDraft(setCardData, patch);
  const textStyles = useMemo(() => getDesignStylesFromV2(designConfig), [designConfig]);
  const designVariables = useMemo(() => designConfigToCssVariables(designConfig), [designConfig]);

  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [isEditingExistingImage, setIsEditingExistingImage] = useState(false);
  const draftKey = mediaDraftKey ?? cardData?.id;
  const coverUpload = useRef(null);

  useEffect(() => () => {
    coverUpload.current?.abort();
    coverUpload.current = null;
  }, [isCreator, draftKey]);

  const uploadCover = async (file) => {
    if (!file || coverUpload.current || !onUploadCoverImage) return;
    const request = new AbortController();
    coverUpload.current = request;
    try {
      await onUploadCoverImage(file, cardData?.id, setCardData, request.signal);
    } finally {
      if (coverUpload.current === request) coverUpload.current = null;
    }
  };

  if (!cardData) return null;
  if (!content || !VisualFields) {
    return <p role="alert">{tr('Карточки ещё не перенесены в Structured Cards V2.')}</p>;
  }

  const frontText = studySideText(content);
  const flagStyle = getFlagStyle(cardData.flag);
  const source = cardData.content_v2_source ?? null;
  const isSourceMode = source !== null;
  const setSource = text => changeDraftSource(setCardData, text);
  const sourceError = draftSourceError(cardData);
  const sourceDisabled = loading || audioBusy || Boolean(sourceError);
  const dictation = enableDictation ? <PromptDictation type={content.type} update={update} /> : null;
  const resolvedBgFront = providedBgFront || getResolvedStyle(designConfig?.front?.card?.background, cardData.id || 0);
  const resolvedBgBack = providedBgBack || getResolvedStyle(designConfig?.back?.card?.background, cardData.id || 0);
  const backBackground = (
    <CardBackground
      background={designConfig?.back?.card?.background}
      styleType={resolvedBgBack}
      cardId={cardData.id}
    />
  );
  const effectiveLanguage = deckLanguage ?? deck?.target_language ?? cardData?.target_language ?? 'de';
  const existingImageSrc = cardData.image_url || (cardData.image_path ? resolveMediaUrl(cardData.image_path, 'images') : '');

  return (
    <MediaResolverProvider
      resolveMediaUrl={resolveMediaUrl}
      resolveAudioUrl={resolveAudioUrl}
      isLocalAssetUrl={isLocalAssetUrl}
    >
      <div className="lerne-card-ui-root" style={designVariables}>
      <div
        className={`creator-form glass${composed ? ' visual-card-form' : ''}`}
        data-card-type={content.type}
        style={{ marginTop: '4px' }}
        onPointerDown={composed ? preserveInlineFieldFocus : undefined}
      >
        <button
          type="button"
          className="btn-secondary"
          style={{ minHeight: '44px' }}
          disabled={sourceDisabled}
          onClick={() => setSource(source === null ? JSON.stringify(cardData.content_v2, null, 2) : null)}
        >
          {source === null ? tr('Исходный JSON') : tr('Типизированная форма')}
        </button>

        {source !== null && (
          <div className="card-form-text-field card-editor-field">
            <label htmlFor="card-editor-json">{tr('Полный content_v2 JSON')}</label>
            <textarea
              id="card-editor-json"
              className="textarea-preview card-editor-raw"
              rows={18}
              spellCheck={false}
              value={source}
              onChange={event => setSource(event.target.value)}
              aria-invalid={Boolean(sourceError)}
              aria-describedby={sourceError ? 'card-editor-json-error' : undefined}
              style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', minHeight: '280px' }}
            />
            {sourceError && <p id="card-editor-json-error" role="alert">{tr(sourceError)}</p>}
            {lockLayout && (
              <p role="note" data-testid="standalone-json-layout-note" style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '4px 0' }}>
                {tr('Визуальный редактор дизайна пока недоступен автономно: создание или изменение layout будет отклонено при сохранении. Сохраняйте существующий layout без изменений.')}
              </p>
            )}
            {Boolean(cardData.pendingLayoutImages?.length) && (
              <p role="status">{tr('Загруженные изображения будут добавлены после исправления JSON.')}</p>
            )}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {onCancel && (
                <button type="button" className="btn-secondary" style={{ minHeight: '44px' }} onClick={onCancel} disabled={loading}>
                  {tr('Отмена')}
                </button>
              )}
              <CardSaveButton onSave={onSave} disabled={sourceDisabled} loading={loading} />
            </div>
          </div>
        )}

        <div hidden={isSourceMode}>
          {topSlot}

          <CardMediaFields
            cardData={cardData}
            setCardData={setCardData}
            openImagePicker={() => setIsImagePickerOpen(true)}
            generateAudio={onGenerateAudio}
            loading={loading}
            audioBusy={audioBusy}
            setAudioBusy={setAudioBusy}
            uploadAudioFile={onUploadAudio}
            allowOfflineUpload={allowOfflineAudioUpload}
            getSessionIdentity={getSessionIdentity}
            resolveAudioUrl={resolveAudioUrl}
          />

          <CardTypeField card={content} update={update} />

          <div className="form-group card-container study-flashcard visual-card-editor-surface" style={flagStyle}>
            <div
              id="tut-creator-front"
              className="card-inner glass card-front"
              style={flagStyle}
            >
              <CardBackground
                background={designConfig?.front?.card?.background}
                styleType={resolvedBgFront}
                cardId={cardData.id}
              />

              <div className="card-face">
                <VisualFields
                  key={cardData.id}
                  cardData={cardData}
                  update={update}
                  dictation={dictation}
                  designConfig={designConfig}
                  textStyles={textStyles}
                  resolveMediaUrl={resolveMediaUrl}
                  lockLayout={lockLayout}
                />
              </div>

              <CardCoverPreview
                cardData={cardData}
                setCardData={setCardData}
                deck={deck}
                resolveMediaUrl={resolveMediaUrl}
                onEdit={() => setIsEditingExistingImage(true)}
                onClear={clearCover}
                hideHeightSlider={hideCoverHeightSlider}
              />

              <CardLevelControls
                cardData={cardData}
                deckLanguage={effectiveLanguage}
                frontText={frontText}
                update={update}
                onNotify={onNotify}
              />
            </div>
          </div>

          {writtenAnswer && <AnswerGradingFields card={content} update={update} />}

          <StructuredCardExtras
            key={draftKey}
            card={content}
            update={update}
            attachImage={path => attachDraftImage(setCardData, cardData.id, path)}
            uploadLayoutImage={onUploadLayoutImage}
            lockLayout={lockLayout}
          />

          <CardFormActions
            isCreator={isCreator}
            type={content.type}
            frontText={frontText}
            onAiGenerate={onAiGenerate}
            onStopGeneration={onStopGeneration}
            onSave={onSave}
            onCancel={onCancel}
            loading={loading}
            audioBusy={audioBusy}
          />

          <CardFormDetails
            content={content}
            update={update}
            backBackground={backBackground}
            textStyles={textStyles}
            isSourceMode={isSourceMode}
          />

          <MediaPicker
            isOpen={isImagePickerOpen}
            onClose={() => setIsImagePickerOpen(false)}
            onImageUpload={uploadCover}
            searchQuery={frontText || ''}
            loading={loading}
            onNotify={onNotify}
            allowRemoteImageSearch={allowRemoteImageSearch}
            onFetchRemoteImage={onFetchRemoteImage}
          />

          <ImageEditorModal
            isOpen={isEditingExistingImage}
            onClose={() => setIsEditingExistingImage(false)}
            imageSrc={existingImageSrc}
            onSave={(editedFile) => {
              setIsEditingExistingImage(false);
              uploadCover(editedFile);
            }}
            title={tr('Редактировать картинку')}
          />
        </div>
      </div>
    </div>
    </MediaResolverProvider>
  );

  function clearCover() {
    coverUpload.current?.abort();
    setCardData(current => {
      if (!current) return current;
      const next = { ...current, image_path: '', image_url: '', draftImageHeight: undefined };
      if (next.content_v2?.card?.image) {
        const nextCard = { ...next.content_v2.card };
        delete nextCard.image;
        const nextEnvelope = { ...next.content_v2, card: nextCard };
        next.content_v2 = nextEnvelope;
        if (next.content_v2_source != null) {
          next.content_v2_source = JSON.stringify(nextEnvelope, null, 2);
        }
      }
      return next;
    });
  }
};

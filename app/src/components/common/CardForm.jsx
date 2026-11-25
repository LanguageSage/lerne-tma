import { useDeckStore } from '../../store/useDeckStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { useAiActions } from '../../hooks/useAiActions';
import { useAudio } from '../../hooks/useAudio';
import { fetchRemoteImageFile, useMediaUpload } from '../../hooks/useMediaUpload';
import { mediaURL } from '../../services/apiConfig';
import { getAudioUrl } from '../../utils/media';
import { isPlatformAssetUrl } from '../../utils/platform';
import { getSessionIdentity } from '../../utils/auth';
import { findCardDeck } from '../../utils/deckUtils';
import { getResolvedStyle } from '../../utils/style';
import { tr } from '../../i18n/locale';
import { NativeCardFormCore } from '../../card-ui/NativeCardFormCore.jsx';
import { IS_STANDALONE } from '../../utils/standaloneMode.js';

function CardDeckField({ deckId, setCardData, disabled }) {
  const decks = useDeckStore(state => state.decks) ?? [];
  return (
    <div className="form-group" style={{ marginBottom: '8px' }}>
      <label className="sub-label" style={{ marginBottom: '4px', fontSize: '0.75rem', opacity: 0.7 }}>
        {tr('ВЫБЕРИТЕ КОЛОДУ')}
      </label>
      <select
        className="form-input"
        value={deckId || ''}
        disabled={disabled}
        onChange={event => {
          const val = event.target.value;
          const nextDeckId = val ? (Number.isNaN(Number(val)) ? val : Number(val)) : '';
          setCardData(current => ({ ...current, deck_id: nextDeckId }));
        }}
      >
        <option value="">{tr('Выберите колоду...')}</option>
        {decks.map(deck => (
          <option key={deck.id} value={deck.id}>
            {deck.name} {deck.target_language ? `(${deck.target_language.toUpperCase()})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

export const CardForm = ({ cardData, setCardData, onSave, onCancel = null, isCreator = false }) => {
  const effectiveConfig = useSettingsStore(state => state.activeDesignConfig);
  const loading = useUiStore(state => state.loading);
  const showToast = useUiStore(state => state.showToast);
  const creatorDeckId = useDeckStore(state => (isCreator ? state.currentDeck?.id : undefined));
  const cardDeck = useDeckStore(state => findCardDeck(state, cardData?.deck_id));
  const { runAiGenerator, stopAiGeneration, generateAudioInternal } = useAiActions();
  const { playAudio } = useAudio();
  const { uploadCreatorImage, uploadLayoutImageFile, uploadAudioFile } = useMediaUpload();

  const mediaDraftKey = isCreator ? creatorDeckId : cardData?.id;
  const resolvedBgFront = getResolvedStyle(effectiveConfig?.front?.card?.background, cardData?.id || 0);
  const resolvedBgBack = getResolvedStyle(effectiveConfig?.back?.card?.background, cardData?.id || 0);

  const handleAiGenerate = async (actionType, userRequest = '') => {
    const envelope = cardData?.content_v2;
    const result = await runAiGenerator(envelope, true, actionType, userRequest);
    if (result?.content_v2) {
      setCardData(current => ({ ...current, content_v2: result.content_v2, content_v2_source: null }));
    }
  };

  return (
    <NativeCardFormCore
      cardData={cardData}
      setCardData={setCardData}
      onSave={onSave}
      onCancel={onCancel}
      isCreator={isCreator}
      loading={loading}
      deck={cardDeck}
      deckLanguage={cardDeck?.target_language}
      mediaDraftKey={mediaDraftKey}
      designConfig={effectiveConfig}
      resolvedBgFront={resolvedBgFront}
      resolvedBgBack={resolvedBgBack}
      enableDictation={!IS_STANDALONE && isCreator}
      lockLayout={false}
      allowOfflineAudioUpload={IS_STANDALONE}
      hideCoverHeightSlider={IS_STANDALONE}
      topSlot={
        isCreator && cardData ? (
          <CardDeckField deckId={cardData.deck_id} setCardData={setCardData} disabled={loading || Boolean(cardData.id)} />
        ) : null
      }
      onUploadCoverImage={uploadCreatorImage}
      onUploadLayoutImage={uploadLayoutImageFile}
      onUploadAudio={uploadAudioFile}
      getSessionIdentity={getSessionIdentity}
      resolveMediaUrl={mediaURL}
      resolveAudioUrl={getAudioUrl}
      isLocalAssetUrl={isPlatformAssetUrl}
      allowRemoteImageSearch={!IS_STANDALONE}
      onFetchRemoteImage={IS_STANDALONE ? null : fetchRemoteImageFile}
      onGenerateAudio={IS_STANDALONE ? null : (() => generateAudioInternal(cardData, setCardData, playAudio))}
      onAiGenerate={IS_STANDALONE ? null : handleAiGenerate}
      onStopGeneration={IS_STANDALONE ? null : stopAiGeneration}
      onNotify={showToast}
    />
  );
};

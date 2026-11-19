import { Image as ImageIcon, RefreshCw, RotateCw, Volume2, X } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { useDeckStore } from '../../store/useDeckStore';
import { CardAudioAttachments } from './CardAudioAttachments';
import { FlagPicker } from './FlagPicker';

export function CardMediaFields({ cardData, setCardData, openImagePicker, generateAudio, loading, audioBusy, setAudioBusy }) {
  const playGeneratedAudio = async () => {
    if (audioBusy) return;
    setAudioBusy(true);
    try { await generateAudio(); }
    finally { setAudioBusy(false); }
  };

  return (
    <details className="card-form-secondary">
      <summary>{tr("Медиа и оформление")}</summary>
      <FlagPicker
        value={cardData.flag}
        onChange={flag => setCardData(current => ({ ...current, flag }))}
      />
      <div className="form-toolbar">
        <button
          type="button"
          className="form-toolbar-btn btn-image"
          onClick={openImagePicker}
          title={tr("Добавить картинку")}
        >
          <ImageIcon size={18} />
          <span>{tr("Картинка")}</span>
        </button>
        <button
          type="button"
          className="form-toolbar-btn btn-audio"
          onClick={playGeneratedAudio}
          disabled={loading || audioBusy}
          title={tr("Озвучить")}
        >
          {loading ? <RefreshCw size={18} className="spin" /> : <Volume2 size={18} />}
          <span>{loading ? tr("Озвучивание...") : tr("Озвучить")}</span>
        </button>
      </div>
      <CardAudioAttachments cardData={cardData} setCardData={setCardData} disabled={loading || audioBusy}
        onBusyChange={setAudioBusy} />
    </details>
  );
}

export function CardCoverPreview({ cardData, setCardData, onEdit, onClear }) {
  const currentDeck = useDeckStore(state => state.currentDeck);
  const updateDeckMetadata = useDeckStore(state => state.updateDeckMetadata);
  if (!cardData.image_url && !cardData.image_path) return null;

  const getDeckH = () => {
    try {
      const meta = currentDeck?.metadata;
      const parsed = meta ? (typeof meta === 'string' ? JSON.parse(meta) : meta) : {};
      return parsed.imageHeight || 220;
    } catch { return 220; }
  };
  const currentH = cardData.image_height || getDeckH();
  const setImageHeight = value => setCardData(current => ({ ...current, image_height: value }));
  const handleHeightChange = async (val) => {
    setImageHeight(val);
    if (currentDeck?.id) {
      try {
        let meta = currentDeck.metadata;
        if (typeof meta === 'string') {
          try { meta = JSON.parse(meta); } catch { meta = {}; }
        } else {
          meta = meta ? { ...meta } : {};
        }
        meta.imageHeight = val;
        await updateDeckMetadata(currentDeck.id, meta);
      } catch (e) {
        console.error('Error syncing deck image height:', e);
      }
    }
  };

  return (
    <>
      <div className="image-preview-box" style={{ margin: '10px', position: 'relative', zIndex: 3 }}>
        <img
          src={cardData.image_url || `/api/media/${cardData.image_path}`}
          alt=""
          style={{
            display: 'block',
            width: '100%',
            height: `${currentH}px`,
            objectFit: 'contain',
            borderRadius: '8px'
          }}
        />
        <button
          type="button"
          className="image-edit-btn"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title={tr("Повернуть / Кадрировать")}
        >
          <RotateCw size={18} />
        </button>
        <button
          type="button"
          className="image-clear-btn"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          title={tr("Убрать картинку")}
        >
          <X size={20} />
        </button>
      </div>

      <div style={{ margin: '0 10px 10px 10px', zIndex: 3, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(168, 85, 247, 0.07)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{tr("Высота")}</span>
          <input
            type="range"
            min={60}
            max={800}
            step={10}
            value={currentH}
            onChange={e => setImageHeight(Number(e.target.value))}
            onMouseUp={e => handleHeightChange(Number(e.target.value))}
            onTouchEnd={e => handleHeightChange(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#a855f7', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '0.8rem', color: '#c084fc', fontWeight: 700, minWidth: '46px', textAlign: 'right' }}>
            {currentH}px
          </span>
        </div>
      </div>
    </>
  );
}

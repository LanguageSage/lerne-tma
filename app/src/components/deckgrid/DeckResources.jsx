import { Crop, ExternalLink } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { getResourceSrc } from '../../utils/deckUtils';
import DeckAudioPlayer from '../common/DeckAudioPlayer';

// Presentation only: metadata writes, resize state, editor and uploads stay in CardList.
export function DeckResources({ deckResources, imageHeight, startResizeDrag, handleToggleShowInCards, onEditImage }) {
  const deckImages = deckResources.filter(r => r.type === 'image');
  const deckAudios = deckResources.filter(r => r.type === 'audio');
  const deckVideos = deckResources.filter(r => r.type === 'video');
  const deckLinks = deckResources.filter(r => r.type === 'link');

  return (
    <>
        {deckImages.length > 0 && (
          <div className="deck-images-gallery" style={{
            margin: '4px 15px 8px 15px',
            display: 'flex',
            gap: '10px',
            overflowX: 'auto',
            paddingBottom: '4px',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch'
          }}>
            {deckImages.map((img, idx) => {
              const imgSrc = getResourceSrc(img, 'images');
              const resourceIndex = deckResources.findIndex(r => r === img || (r.type === 'image' && (r.url === img.url || r.path === img.path)));
              return (
                <div key={idx} style={{ flex: '0 0 100%', maxWidth: '100%', scrollSnapAlign: 'start' }}>
                  <div className="glass" style={{
                    position: 'relative',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0, 0, 0, 0.25)'
                  }}>
                    <img 
                      src={imgSrc} 
                      alt="" 
                      style={{ 
                        display: 'block',
                        width: '100%', 
                        height: 'auto',
                        maxHeight: `${imageHeight}px`, 
                        objectFit: 'contain',
                        cursor: 'zoom-in' 
                      }} 
                      onClick={() => window.open(imgSrc, '_blank')}
                    />

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditImage(imgSrc, resourceIndex >= 0 ? resourceIndex : idx);
                            }}
                            style={{
                              position: 'absolute',
                              top: '8px',
                              right: '8px',
                              background: 'rgba(0, 0, 0, 0.7)',
                              backdropFilter: 'blur(6px)',
                              border: '1px solid rgba(255, 255, 255, 0.25)',
                              color: '#e9d5ff',
                              padding: '4px 10px',
                              borderRadius: '8px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '5px',
                              zIndex: 2,
                              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                              transition: 'all 0.2s'
                            }}
                            onMouseOver={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.85)'}
                            onMouseOut={e => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)'}
                            title={tr("Редактировать изображение списка")}
                          >
                            <Crop size={13} />
                            <span>{tr("Изменить")}</span>
                          </button>

                          {deckImages.length > 1 && (
                            <div style={{
                              position: 'absolute',
                              top: '8px',
                              left: '8px',
                              background: 'rgba(0, 0, 0, 0.65)',
                              color: 'white',
                              fontSize: '0.72rem',
                              padding: '2px 8px',
                              borderRadius: '8px',
                              fontWeight: 600
                            }}>
                              {idx + 1} / {deckImages.length}
                            </div>
                          )}
                        </div>

                        {/* Resize handle */}
                        <div
                          onMouseDown={startResizeDrag}
                          onTouchStart={startResizeDrag}
                          title={tr("Потяни чтобы изменить высоту")}
                          style={{
                            height: '14px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'ns-resize',
                            margin: '2px 0',
                            userSelect: 'none',
                            touchAction: 'none'
                          }}
                        >
                          <div style={{
                            width: '48px',
                            height: '4px',
                            borderRadius: '2px',
                            background: 'rgba(168, 85, 247, 0.5)',
                            transition: 'background 0.2s'
                          }}
                          onMouseOver={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.9)'}
                          onMouseOut={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.5)'}
                          />
                        </div>

                        {/* Toggle switch for showing image in every card */}
                        <label 
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                            marginTop: '4px',
                            padding: '6px 12px',
                            borderRadius: '12px',
                            background: 'rgba(255, 255, 255, 0.04)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            cursor: 'pointer',
                            userSelect: 'none',
                            width: '100%',
                            boxSizing: 'border-box'
                          }}
                        >
                          <span style={{ fontSize: '0.78rem', color: '#e2e8f0', fontWeight: 500 }}>{tr("Показывать картинку в каждой карточке")}{' '}</span>
                          <input
                            type="checkbox"
                            checked={img.show_in_cards !== false}
                            onChange={(e) => handleToggleShowInCards(img, e.target.checked)}
                            style={{
                              width: '16px',
                              height: '16px',
                              accentColor: '#a855f7',
                              cursor: 'pointer'
                            }}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}

        {deckAudios.map((aud, idx) => (
          <DeckAudioPlayer key={idx} url={aud.url} title={aud.title} />
        ))}

        {deckVideos.map((vid, idx) => (
          <div key={idx} className="glass" style={{
            margin: '0 15px 10px 15px',
            borderRadius: '16px',
            overflow: 'hidden',
            border: '1px solid rgba(251, 113, 133, 0.2)',
            background: '#000'
          }}>
            <video 
              src={vid.url} 
              controls 
              playsInline
              style={{ width: '100%', maxHeight: '200px', display: 'block', objectFit: 'contain' }} 
            />
          </div>
        ))}

        {deckLinks.length > 0 && (
          <div style={{
            margin: '0 15px 10px 15px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px'
          }}>
            {deckLinks.map((lnk, idx) => (
              <a
                key={idx}
                href={lnk.url}
                target="_blank"
                rel="noopener noreferrer"
                className="glass"
                style={{
                  padding: '6px 12px',
                  borderRadius: '10px',
                  fontSize: '0.8rem',
                  color: '#34d399',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  textDecoration: 'none',
                  border: '1px solid rgba(52, 211, 153, 0.2)'
                }}
              >
                <ExternalLink size={14} />
                <span>{lnk.title || lnk.url}</span>
              </a>
            ))}
          </div>
        )}

    </>
  );
}

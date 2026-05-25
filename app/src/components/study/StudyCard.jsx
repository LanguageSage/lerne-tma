import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Eye, Volume2, Layers } from 'lucide-react';
import { stripMarkdown } from '../../utils/text';
import { CardBackground } from '../common/CardBackground';
import { getTextShadow, getContextShadow } from '../../utils/style';

export const StudyCard = ({
  card,
  isFlipped,
  onFlip,
  loading,
  historyIndex,
  playAudio,
  isAudioLoading,
  isAutoplayActive,
  onPlayBackAudio,
  styles,
  resolvedBgFront,
  resolvedBgBack
}) => {
  if (!card) return null;

  const {
    cardFont, cardTextColor, cardFontSize, cardFontWeight, cardFontStyle, cardTextShadow,
    contextFont, contextTextColor, contextFontSize, contextFontWeight, contextFontStyle, contextTextShadow
  } = styles;

  const cardStyle = {
    fontFamily: cardFont,
    color: cardTextColor,
    fontSize: `${cardFontSize}rem`,
    fontWeight: cardFontWeight,
    fontStyle: cardFontStyle,
    textShadow: getTextShadow(cardTextShadow, cardTextColor)
  };

  const contextStyle = {
    fontFamily: contextFont,
    color: contextTextColor,
    fontSize: `${contextFontSize}rem`,
    fontWeight: contextFontWeight,
    fontStyle: contextFontStyle,
    textShadow: getContextShadow(contextTextShadow, contextTextColor)
  };


  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        id="tut-study-card"
        key={`${card.id}-${historyIndex}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className={`card-container ${loading ? 'loading-card' : ''}`}
        onClick={() => !loading && onFlip(!isFlipped)}
        style={cardStyle}
      >
        {!isFlipped ? (
          <div className="card-inner card-front glass">
            <CardBackground styleType={resolvedBgFront} />
            <div className="card-face">
              {card.audio_url && (
                <button
                  id="tut-study-audio"
                  className="audio-btn-corner"
                  disabled={loading || isAutoplayActive}
                  onClick={(e) => { e.stopPropagation(); if (!isAutoplayActive) playAudio(card.audio_url); }}
                >
                  {isAudioLoading ? <RefreshCw size={24} className="spin" /> : <Volume2 size={24} />}
                </button>
              )}

              {card.video_front_url && (
                <div className="video-container-card">
                  <video src={card.video_front_url} autoPlay loop muted playsInline />
                </div>
              )}
              <div className="text-front" style={{ fontStyle: cardFontStyle }}>{stripMarkdown(card.front)}</div>
              <div className="flip-hint-badge">
                <Eye size={16} />
                <span>Перевернуть карточку</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="card-inner card-back glass">
            <CardBackground styleType={resolvedBgBack} />
            <div className="card-face">
              <div className="front-mini-container" style={{ position: 'relative', width: '100%', marginBottom: '20px' }}>
                <div className="text-front-mini" style={{ marginBottom: 0 }}>{stripMarkdown(card.front)}</div>
                {(card.audio_back_url || card.audio_url) && (
                  <button
                    id="tut-study-audio-back"
                    className="audio-btn-back-corner"
                    disabled={loading || isAutoplayActive}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isAutoplayActive) playAudio(card.audio_back_url || card.audio_url);
                    }}
                  >
                    {isAudioLoading ? <RefreshCw size={24} className="spin" /> : <Volume2 size={24} />}
                  </button>
                )}
              </div>

              {card.video_back_url && (
                <div className="video-container-card">
                  <video src={card.video_back_url} autoPlay loop muted playsInline />
                </div>
              )}
              <div className="back-answer-block">
                <button
                  className="audio-btn-translation"
                  disabled={loading || isAudioLoading}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayBackAudio?.(card);
                  }}
                  title="Озвучить перевод"
                >
                  {isAudioLoading ? <RefreshCw size={22} className="spin" /> : <Volume2 size={22} />}
                </button>
                <div id="tut-study-answer" className="text-back" style={{ fontStyle: cardFontStyle }}>{stripMarkdown(card.back)}</div>
              </div>
              {card.image_url && (
                <img
                  src={card.image_url}
                  className="card-img"
                  alt="Card"
                  onError={(e) => { console.warn('Image load error:', card.image_url); e.target.style.display = 'none'; }}
                />
              )}
              {card.context && (
                <div className="text-context" style={contextStyle}>
                  {stripMarkdown(card.context)}
                </div>
              )}

              {card.creator_name && (
                <div className="creator-badge-corner" style={{ position: 'absolute', bottom: '10px', right: '10px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(0,0,0,0.4)', padding: '4px 10px', borderRadius: '20px', zIndex: 10, opacity: 0.8 }}>
                  {card.creator_avatar ? (
                    <img src={card.creator_avatar} alt="avatar" style={{ width: 18, height: 18, borderRadius: '50%' }} />
                  ) : (
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '9px' }}>
                      {card.creator_name.charAt(0)}
                    </div>
                  )}
                  <span style={{ fontSize: '0.65rem', color: '#fff', fontWeight: 500 }}>{card.creator_name}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {loading && (
          <div className="card-loading-overlay">
            <RefreshCw size={40} className="spin" />
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

import React, { useRef, useState, useEffect } from 'react';
import { Sparkles, RefreshCw, Volume2, Image as ImageIcon, Upload, X, RotateCw, BookOpen, MessageSquare, SlidersHorizontal, Check } from 'lucide-react';
import { CardBackground } from './CardBackground';
import { getTextShadow, getContextShadow } from '../../utils/style';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { useMediaUpload } from '../../hooks/useMediaUpload';
import { MediaPicker } from './MediaPicker';
import { ImageEditorModal } from './ImageEditorModal';
import { useDeckStore } from '../../store/useDeckStore';
import { FlagPicker } from './FlagPicker';
import { CardLevelBadge } from './CardLevelBadge';
import { buildCefrMetaFromClassifierResult, buildManualCefrMeta, updateCardLevelTags } from '../../utils/levelUtils';
import { classifySentenceFast } from '../../services/classifier';
import { triggerHaptic } from '../../utils/platform';

import { useTranslation } from '../../i18n/i18nContext';

export const CardForm = ({
  cardData,
  setCardData,
  onSave,
  onAiGenerate,
  onStopGeneration,
  onGenerateAudio,
  playAudio,
  isCreator = false
}) => {
  const { t } = useTranslation();
  const { 
    cardFont, cardTextColor, cardFontWeight, cardFontStyle, cardFontSize, cardTextShadow, cardTextAlign,
    cardBgFront, cardBgBack,
    contextFont, contextTextColor, contextFontSize, contextFontWeight, contextFontStyle, contextTextShadow, contextTextAlign
  } = useSettingsStore();

  const { loading, showToast } = useUiStore();
  const { uploadCreatorImage, uploadVideo } = useMediaUpload();
  const { decks = [], currentDeck, updateDeckMetadata } = useDeckStore();

  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);
  const [isEditingExistingImage, setIsEditingExistingImage] = useState(false);
  const [isClassifyingLevel, setIsClassifyingLevel] = useState(false);
  const [isLevelPickerOpen, setIsLevelPickerOpen] = useState(false);
  
  const frontRef = useRef(null);
  const backRef = useRef(null);
  const contextRef = useRef(null);
  const videoFrontRef = useRef(null);
  const videoBackRef = useRef(null);

  const autoResize = (ref) => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  };

  useEffect(() => {
    const handleResize = () => {
      autoResize(frontRef);
      autoResize(backRef);
      autoResize(contextRef);
    };
    window.addEventListener('resize', handleResize);
    const timer = setTimeout(handleResize, 100);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => { autoResize(frontRef); }, [cardData?.front, cardFontSize, cardFont, cardFontWeight, cardFontStyle]);
  useEffect(() => { autoResize(backRef); }, [cardData?.back, cardFontSize, cardFont, cardFontWeight, cardFontStyle]);
  useEffect(() => { autoResize(contextRef); }, [cardData?.context, contextFontSize, contextFont, contextFontWeight, contextFontStyle]);

  const availableStyles = ['mesh', 'aurora', 'holographic', 'liquid', 'liquid_sunset', 'liquid_ocean', 'liquid_cosmic', 'liquid_emerald', 'video_aquarium', 'video_space', 'video_nature'];
  const getResolvedStyle = (settingStyle, cardId) => {
    if (settingStyle !== 'auto') return settingStyle;
    if (!cardId) return 'standard';
    const sum = cardId.toString().split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return availableStyles[sum % availableStyles.length];
  };

  const resolvedBgFront = getResolvedStyle(cardBgFront, cardData?.id || 0);
  const resolvedBgBack = getResolvedStyle(cardBgBack, cardData?.id || 0);

  const timerRef = useRef(null);
  const pickerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isLevelPickerOpen) return;
    const handleOutsideClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setIsLevelPickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => document.removeEventListener('pointerdown', handleOutsideClick);
  }, [isLevelPickerOpen]);

  const handleReclassifyLevel = () => {
    if (isClassifyingLevel) return;
    setIsClassifyingLevel(true);
    setIsLevelPickerOpen(false);
    triggerHaptic('medium');

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const front = (cardData?.front || '').trim();
      const res = classifySentenceFast(front, 'de');
      const newLevel = res.level || 'A1';

      setCardData(prev => ({
        ...prev,
        level: newLevel,
        manual_level: false,
        reason: res.reason,
        reason_short: res.reason_short,
        cefr: buildCefrMetaFromClassifierResult({ ...res, level: newLevel }, 'local'),
        tags: updateCardLevelTags(prev?.tags, newLevel)
      }));

      setIsClassifyingLevel(false);
      triggerHaptic('success');
      showToast(`Уровень определен: ${newLevel} (${res.reason_short || res.reason})`, 'success');
    }, 1000);
  };

  const handleSelectManualLevel = (selectedLevel) => {
    setIsLevelPickerOpen(false);
    triggerHaptic('selection');

    if (selectedLevel === 'auto') {
      handleReclassifyLevel();
      return;
    }

    setCardData(prev => ({
      ...prev,
      level: selectedLevel,
      manual_level: true,
      reason: 'Установлен вручную пользователем',
      reason_short: 'вручную',
      cefr: buildManualCefrMeta(selectedLevel),
      tags: updateCardLevelTags(prev?.tags, selectedLevel)
    }));

    showToast(`Уровень установлен: ${selectedLevel} (вручную)`, 'info');
  };

  if (!cardData) return null;

  return (
    <div className="creator-form glass" style={{ marginTop: '20px' }}>
      
      {isCreator && (
        <div className="form-group" style={{ marginBottom: '8px' }}>
          <label className="sub-label" style={{ marginBottom: '4px', fontSize: '0.75rem', opacity: 0.7 }}>ВЫБЕРИТЕ КОЛОДУ</label>
          <select 
            className="form-input" 
            value={cardData.deck_id || ''} 
            onChange={(e) => setCardData({...cardData, deck_id: parseInt(e.target.value)})}
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
            <option value="" disabled style={{ background: '#1e293b', color: '#ffffff' }}>-- Выберите колоду --</option>
            {decks.map(d => (
              <option key={d.id} value={d.id} style={{ background: '#1e293b', color: '#ffffff' }}>{d.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* FLAG COLOR SELECTOR */}
      <FlagPicker 
        value={cardData.flag} 
        onChange={(flagId) => setCardData({ ...cardData, flag: flagId })} 
      />

      {/* Toolbar / Header Actions */}
      <div className="form-toolbar" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginBottom: '12px' }}>
        <button
          type="button"
          className="form-toolbar-btn"
          onClick={() => setIsImagePickerOpen(true)}
          title="Добавить картинку"
        >
          <ImageIcon size={22} />
        </button>
        <button 
          type="button"
          className="form-toolbar-btn" 
          onClick={() => onGenerateAudio(cardData, setCardData, playAudio)}
          disabled={loading}
          title="Озвучить"
        >
          <Volume2 size={22} />
        </button>
      </div>

      <div className="form-group">
        <div id="tut-creator-front" className="card-preview-container glass" style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px' }}>
          <CardBackground styleType={resolvedBgFront} />
          
          {/* Level Badge + Manual Override Controls */}
          <div style={{ position: 'absolute', bottom: '10px', left: '10px', zIndex: 15, pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div 
              style={{
                opacity: isClassifyingLevel ? 0 : 1,
                transform: isClassifyingLevel ? 'scale(0.8)' : 'scale(1)',
                transition: 'opacity 0.25s ease, transform 0.25s ease',
                pointerEvents: isClassifyingLevel ? 'none' : 'auto'
              }}
              title="Нажмите для автоматического пересчета уровня"
            >
              <CardLevelBadge 
                card={cardData} 
                size="sm" 
                onClick={handleReclassifyLevel} 
              />
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsLevelPickerOpen(!isLevelPickerOpen);
              }}
              title="Ручная смена уровня CEFR"
              style={{
                background: 'rgba(255, 255, 255, 0.12)',
                border: '1px solid rgba(255, 255, 255, 0.22)',
                borderRadius: '8px',
                color: 'rgba(255, 255, 255, 0.85)',
                padding: '2px 7px',
                fontSize: '0.68rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                lineHeight: 1.2
              }}
            >
              <SlidersHorizontal size={11} />
              <span>Правка</span>
            </button>

            {isLevelPickerOpen && (
              <div
                ref={pickerRef}
                style={{
                  position: 'absolute',
                  bottom: '36px',
                  left: '0',
                  background: 'rgba(24, 24, 27, 0.96)',
                  border: '1px solid rgba(255, 255, 255, 0.18)',
                  borderRadius: '12px',
                  padding: '6px',
                  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.55)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  zIndex: 50,
                  minWidth: '185px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ fontSize: '0.68rem', color: 'rgba(255, 255, 255, 0.55)', padding: '2px 6px', fontWeight: 600 }}>
                  Уровень сложности:
                </div>
                
                <button
                  type="button"
                  onClick={() => handleSelectManualLevel('auto')}
                  style={{
                    background: !cardData.manual_level ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                    border: !cardData.manual_level ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid transparent',
                    color: !cardData.manual_level ? '#a5b4fc' : 'rgba(255, 255, 255, 0.85)',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer'
                  }}
                >
                  <span>⚡ Авто (распознать)</span>
                  {!cardData.manual_level && <Check size={12} color="#a5b4fc" />}
                </button>

                <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.1)', margin: '2px 0' }} />

                {[
                  { lvl: 'A1', label: '🟢 A1 (Начальный)' },
                  { lvl: 'A2', label: '🔵 A2 (Базовый)' },
                  { lvl: 'B1', label: '🔹 B1 (Средний)' },
                  { lvl: 'B2', label: '🟣 B2 (Выше среднего)' },
                  { lvl: 'C1', label: '🔮 C1 (Продвинутый)' },
                  { lvl: 'C2', label: '🟠 C2 (В совершенстве)' }
                ].map(({ lvl, label }) => {
                  const isSelected = cardData.manual_level && cardData.level === lvl;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => handleSelectManualLevel(lvl)}
                      style={{
                        background: isSelected ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                        border: isSelected ? '1px solid rgba(255, 255, 255, 0.3)' : '1px solid transparent',
                        color: isSelected ? '#fff' : 'rgba(255, 255, 255, 0.8)',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        fontSize: '0.72rem',
                        fontWeight: isSelected ? 700 : 500,
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer'
                      }}
                    >
                      <span>{label}</span>
                      {isSelected && <Check size={12} color="#4ade80" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <textarea 
            ref={frontRef}
            className="textarea-preview textarea-front-preview"
            autoFocus={isCreator}
            value={cardData.front || ''} 
            onChange={(e) => {
              setCardData({...cardData, front: e.target.value});
            }}
            onInput={(e) => {
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            style={{ 
              fontFamily: cardFont, 
              fontWeight: cardFontWeight, 
              fontStyle: cardFontStyle,
              color: cardTextColor,
              fontSize: `${cardFontSize}rem`,
              textShadow: getTextShadow(cardTextShadow, cardTextColor),
              textAlign: cardTextAlign || 'center',
              overflow: 'hidden',
              height: 'auto',
              minHeight: '100px'
            }}
            placeholder={t('creator.word_placeholder', 'Слово или фраза...')}
          />
          
          {(cardData.image_url || cardData.image_path) && (() => {
            const getDeckH = () => {
              try {
                const meta = currentDeck?.metadata;
                const parsed = meta ? (typeof meta === 'string' ? JSON.parse(meta) : meta) : {};
                return parsed.imageHeight || 220;
              } catch { return 220; }
            };
            const currentH = cardData.image_height || getDeckH();
            const handleHeightChange = async (val) => {
              setCardData({ ...cardData, image_height: val });
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
                      setIsEditingExistingImage(true);
                    }}
                    title="Повернуть / Кадрировать"
                  >
                    <RotateCw size={18} />
                  </button>
                  <button
                    type="button"
                    className="image-clear-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCardData({...cardData, image_path: '', image_url: ''});
                    }}
                    title="Убрать картинку"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Image height slider — visible when card has an image */}
                <div style={{ margin: '0 10px 10px 10px', zIndex: 3, position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(168, 85, 247, 0.07)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>Высота</span>
                    <input
                      type="range"
                      min={60}
                      max={800}
                      step={10}
                      value={currentH}
                      onChange={e => setCardData({ ...cardData, image_height: Number(e.target.value) })}
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
          })()}

          {(cardData.audio_path || cardData.audio_url) && (
            <button 
              type="button"
              className="audio-btn-corner" 
              onClick={(e) => { e.stopPropagation(); playAudio(cardData.audio_url || `/api/media/${cardData.audio_path}`); }}
            >
              <Volume2 size={24} />
            </button>
          )}
        </div>
      </div>

      {(() => {
        const frontText = cardData.front || '';
        const hasClozeBraces = /\{([^}]+)\}/.test(frontText);
        const hasQuizStar = (/\n\*/.test(frontText) || /^\*/.test(frontText)) && frontText.includes('\n');
        const hasParentheses = /\(([^)]+)\)/.test(frontText);

        let dynamicAction = null;
        if (hasClozeBraces) {
          dynamicAction = {
            id: 'explain_rule',
            label: '📖 Правило',
            icon: BookOpen
          };
        } else if (hasQuizStar) {
          dynamicAction = {
            id: 'full_card',
            label: '📝 Разбор теста',
            icon: BookOpen
          };
        } else if (hasParentheses) {
          dynamicAction = {
            id: 'custom_directive',
            label: '💬 Только просьбу',
            icon: MessageSquare
          };
        }

        const DynamicIcon = dynamicAction?.icon || BookOpen;

        return (
          <div className={`ai-quick-actions ${dynamicAction && !loading ? 'has-dynamic' : ''}`} style={{ gap: '10px' }}>
            {loading ? (
              <button 
                type="button"
                className="btn-ai-generate loading" 
                onClick={onStopGeneration}
                style={{ flex: 1, background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#fca5a5' }}
              >
                <X size={18} />
                <span>Отменить</span>
              </button>
            ) : (
              <>
                {dynamicAction && (
                  <button
                    type="button"
                    className="btn-ai-generate secondary-action-btn"
                    onClick={() => onAiGenerate && onAiGenerate(dynamicAction.id)}
                    disabled={loading || !cardData.front}
                    style={{
                      background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(147, 197, 253, 0.12))',
                      borderColor: 'rgba(59, 130, 246, 0.4)',
                      color: '#93c5fd'
                    }}
                  >
                    <DynamicIcon size={16} />
                    <span>{dynamicAction.label}</span>
                  </button>
                )}

                <button 
                  type="button"
                  className="btn-ai-generate" 
                  onClick={() => onAiGenerate && onAiGenerate('full_card')}
                  disabled={loading || !cardData.front}
                >
                  <Sparkles size={16} />
                  <span>{t('creator.ai_generate', 'Генерировать ✨')}</span>
                </button>
              </>
            )}
            <button 
              type="button"
              className="btn btn-primary btn-save-action" 
              onClick={onSave} 
              disabled={loading}
              style={{ padding: '12px 20px' }}
            >
              {loading ? <RefreshCw className="spin" size={18} /> : t('creator.save', 'Сохранить')}
            </button>
          </div>
        );
      })()}

      <div className="media-edit-group" style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
         <div className="form-group" style={{ flex: 1 }}>
            <label className="sub-label">Видео (Лицо)</label>
            {(cardData.video_front_url || cardData.video_front_path) && (
              <div className="media-preview-mini" style={{ position: 'relative', height: '60px', borderRadius: '8px', overflow: 'hidden', background: 'rgba(0,0,0,0.2)' }}>
                <video src={cardData.video_front_url || `/api/media/${cardData.video_front_path}`} muted loop autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button 
                  type="button"
                  className="image-clear-btn" 
                  style={{ top: '5px', right: '5px', width: '32px', height: '32px' }} 
                  onClick={(e) => {
                    e.stopPropagation();
                    setCardData({...cardData, video_front_path: '', video_front_url: ''});
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <button type="button" className="btn-secondary btn-tiny" onClick={() => videoFrontRef.current?.click()} style={{ width: '100%', marginTop: '5px' }}>
              <Upload size={14} /> Выбрать
            </button>
            <input ref={videoFrontRef} type="file" accept="video/*" className="hidden-file-input" onChange={e => uploadVideo(e.target.files?.[0], cardData, setCardData, 'front')} />
         </div>
         <div className="form-group" style={{ flex: 1 }}>
            <label className="sub-label">Видео (Оборот)</label>
            {(cardData.video_back_url || cardData.video_back_path) && (
              <div className="media-preview-mini" style={{ position: 'relative', height: '60px', borderRadius: '8px', overflow: 'hidden', background: 'rgba(0,0,0,0.2)' }}>
                <video src={cardData.video_back_url || `/api/media/${cardData.video_back_path}`} muted loop autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button 
                  type="button"
                  className="image-clear-btn" 
                  style={{ top: '5px', right: '5px', width: '32px', height: '32px' }} 
                  onClick={(e) => {
                    e.stopPropagation();
                    setCardData({...cardData, video_back_path: '', video_back_url: ''});
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <button type="button" className="btn-secondary btn-tiny" onClick={() => videoBackRef.current?.click()} style={{ width: '100%', marginTop: '5px' }}>
              <Upload size={14} /> Выбрать
            </button>
            <input ref={videoBackRef} type="file" accept="video/*" className="hidden-file-input" onChange={e => uploadVideo(e.target.files?.[0], cardData, setCardData, 'back')} />
         </div>
      </div>

      <div className="form-group">
        <div className="card-preview-container glass" style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px' }}>
          <CardBackground styleType={resolvedBgBack} />
          
          <textarea 
            ref={backRef}
            className="textarea-preview textarea-back-preview"
            value={cardData.back || ''} 
            onChange={(e) => {
              setCardData({...cardData, back: e.target.value});
            }}
            onInput={(e) => {
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            style={{ 
              fontFamily: cardFont, 
              fontWeight: cardFontWeight, 
              fontStyle: cardFontStyle,
              color: cardTextColor,
              fontSize: `${cardFontSize}rem`,
              textShadow: getTextShadow(cardTextShadow, cardTextColor),
              textAlign: cardTextAlign || 'center',
              overflow: 'hidden',
              height: 'auto',
              minHeight: '100px'
            }}
            placeholder={t('creator.back', 'Перевод...')}
          />
          
          {(cardData.context || isCreator) && (
             <>
               <div style={{ width: '90%', height: '4px', background: 'rgba(255,255,255,0.7)', margin: '20px auto', borderRadius: '2px', position: 'relative', zIndex: 10, display: 'block' }}></div>
               <textarea 
                 ref={contextRef}
                 className="context-textarea textarea-preview textarea-context-preview"
                 value={cardData.context || ''} 
                 onChange={(e) => {
                   setCardData({...cardData, context: e.target.value});
                 }}
                 onInput={(e) => {
                   e.target.style.height = 'auto';
                   e.target.style.height = `${e.target.scrollHeight}px`;
                 }}
                 style={{ 
                   fontFamily: contextFont, 
                   fontSize: `${contextFontSize}rem`,
                   color: contextTextColor,
                   fontWeight: contextFontWeight,
                   fontStyle: contextFontStyle,
                   textShadow: getContextShadow(contextTextShadow, contextTextColor),
                   textAlign: contextTextAlign || 'left',
                   overflow: 'hidden',
                   height: 'auto',
                   minHeight: '100px'
                 }}
                 placeholder={t('creator.context', 'Примеры, грамматика...')}
               />
             </>
          )}


        </div>
      </div>

      {/* MODALS FOR CAMERA / IMAGE PICKER */}
      <MediaPicker 
        isOpen={isImagePickerOpen}
        onClose={() => setIsImagePickerOpen(false)}
        onImageUpload={(file) => uploadCreatorImage(file, cardData, setCardData)}
        searchQuery={cardData?.front || ''}
        loading={loading}
      />

      <ImageEditorModal
        isOpen={isEditingExistingImage}
        onClose={() => setIsEditingExistingImage(false)}
        imageSrc={cardData.image_url || (cardData.image_path ? `/api/media/${cardData.image_path}` : '')}
        onSave={(editedFile) => {
          setIsEditingExistingImage(false);
          uploadCreatorImage(editedFile, cardData, setCardData);
        }}
        title="Редактировать картинку"
      />
    </div>
  );
};

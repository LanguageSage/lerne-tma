import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RefreshCw, Trash2, Copy, Sparkles } from 'lucide-react';
import { CardBackground } from './common/CardBackground';
import { getTextShadow, getContextShadow } from '../utils/style';
import { HelpButton } from './TutorialOverlay';

const VOICE_OPTIONS = [
  { value: "de-DE-KatjaNeural", label: "Германия: Катя (Жен)" },
  { value: "de-DE-ConradNeural", label: "Германия: Конрад (Муж)" },
  { value: "de-DE-AmalaNeural", label: "Германия: Амала (Жен)" },
  { value: "ru-RU-SvetlanaNeural", label: "Россия: Светлана (Жен)" },
  { value: "ru-RU-DmitryNeural", label: "Россия: Дмитрий (Муж)" },
  { value: "en-US-AriaNeural", label: "США: Ария (Жен)" },
  { value: "en-US-GuyNeural", label: "США: Гай (Муж)" },
];

export const SettingsModal = ({
  isSettingsOpen,
  setIsSettingsOpen,
  activeSettingsTab,
  setActiveSettingsTab,
  isAdmin,
  autoPlay,
  setAutoPlay,
  autoShow,
  setAutoShow,
  userId,
  adminSettings,
  setAdminSettings,
  saveAdminSettings,
  availableModels,
  fetchModels,
  isFetchingModels,
  userPrompts,
  setUserPrompts,
  saveUserPrompts,
  newPresetName,
  setNewPresetName,
  saveCurrentAsPreset,
  presets,
  applyPreset,
  deletePreset,
  communityDecks,
  fetchCommunityDecks,
  promoteDeck,
  cardBgFront,
  setCardBgFront,
  cardBgBack,
  setCardBgBack,
  cardFont,
  setCardFont,
  cardTextColor,
  setCardTextColor,
  cardFontSize,
  setCardFontSize,
  contextFont,
  setContextFont,
  contextTextColor,
  setContextTextColor,
  contextFontSize,
  setContextFontSize,
  cardTextShadow,
  setCardTextShadow,
  contextTextShadow,
  setContextTextShadow,
  customBackgrounds,
  uploadCustomBackground,
  designPresets,
  applyDesignPreset,
  cardFontWeight,
  setCardFontWeight,
  cardFontStyle,
  setCardFontStyle,
  contextFontWeight,
  setContextFontWeight,
  contextFontStyle,
  setContextFontStyle,
  startTutorial,
  resetDesign
}) => {
  if (!isSettingsOpen) return null;

  const TypographyPreview = ({ styleType = 'standard', showContext = true }) => {
    return (
      <div className="typography-preview glass" style={{ 
        margin: '10px 0 20px 0', 
        padding: '30px 20px', 
        textAlign: 'center',
        border: '1px solid rgba(255,255,255,0.1)',
        position: 'relative',
        overflow: 'hidden',
        minHeight: '120px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: '16px'
      }}>
        <CardBackground styleType={styleType} />
        <div style={{ position: 'relative', zIndex: 1, width: '100%' }}>
          <div style={{ 
            fontFamily: cardFont, 
            color: cardTextColor, 
            fontSize: `${cardFontSize}rem`,
            textShadow: getTextShadow(cardTextShadow, cardTextColor),
            fontWeight: cardFontWeight,
            fontStyle: cardFontStyle,
            marginBottom: showContext ? '10px' : '0'
          }}>
            Sample Phrase
          </div>
          {showContext && (
            <div style={{ 
              fontFamily: contextFont, 
              color: contextTextColor, 
              fontSize: `${contextFontSize}rem`,
              textShadow: getContextShadow(contextTextShadow, contextTextColor),
              fontWeight: contextFontWeight,
              fontStyle: contextFontStyle,
              opacity: 0.8
            }}>
              This is a context example
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <AnimatePresence>
      <div className="settings-overlay" onClick={() => setIsSettingsOpen(false)}>
        <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }} className="settings-modal wide-modal" onClick={e => e.stopPropagation()}>
          <div className="settings-header">
            <h2>Настройки</h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <HelpButton onClick={() => startTutorial('settings')} />
              <button className="close-btn" onClick={() => setIsSettingsOpen(false)}><X size={24} /></button>
            </div>
          </div>

          <div id="tut-settings-tabs" className="settings-tabs">
            <button className={`tab-btn ${activeSettingsTab === 'general' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('general')}>Общие</button>
            <button className={`tab-btn ${activeSettingsTab === 'design' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('design')}>Дизайн</button>
            <button className={`tab-btn ${activeSettingsTab === 'voice' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('voice')}>Озвучка</button>
            <button className={`tab-btn ${activeSettingsTab === 'ai' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('ai')}>Провайдеры</button>
            <button className={`tab-btn ${activeSettingsTab === 'prompts' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('prompts')}>Промпты</button>
            <button className={`tab-btn ${activeSettingsTab === 'presets' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('presets')}>Пресеты</button>
            {isAdmin && <button className={`tab-btn ${activeSettingsTab === 'community' ? 'active' : ''}`} onClick={fetchCommunityDecks}>Сообщество</button>}
          </div>

          <div className="settings-content scrollable">
            <AnimatePresence mode="wait">
              {activeSettingsTab === 'general' && (
                <motion.div id="tut-settings-general" key="general" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
                  <h3>Обучение</h3>
                  <div className="settings-row">
                    <span>Авто-звук</span>
                    <label className="switch"><input type="checkbox" checked={autoPlay} onChange={e => setAutoPlay(e.target.checked)} /><span className="slider"></span></label>
                  </div>
                  <div className="settings-row">
                    <span>Авто-показ</span>
                    <label className="switch"><input type="checkbox" checked={autoShow} onChange={e => setAutoShow(e.target.checked)} /><span className="slider"></span></label>
                  </div>
                  <div className="settings-debug-info">
                    <p>User ID: <code>{userId}</code></p>
                    <p>Platform: <code>{window.Telegram?.WebApp?.platform || 'Web'}</code></p>
                  </div>
                </motion.div>
              )}

              {activeSettingsTab === 'design' && (
                <motion.div id="tut-settings-design" key="design" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
                  <h3>Внешний вид карточек</h3>

                  <div className="custom-bg-manager glass" style={{ marginBottom: '20px', padding: '15px' }}>
                    <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#94a3b8' }}>Готовые темы</h4>
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(2, 1fr)', 
                      gap: '10px' 
                    }}>
                      {designPresets && designPresets.map(p => (
                        <button 
                          key={p.id}
                          className="btn-secondary btn-small"
                          onClick={() => applyDesignPreset(p)}
                          style={{ fontSize: '0.8rem', padding: '10px 5px' }}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                      <button 
                        className="btn-secondary btn-small" 
                        style={{ flex: 1, fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)' }}
                        onClick={() => {
                          const config = {
                            cardBgFront, cardBgBack, cardFont, cardTextColor, cardFontSize,
                            contextFont, contextTextColor, contextFontSize, cardTextShadow, contextTextShadow,
                            cardFontWeight, cardFontStyle, contextFontWeight, contextFontStyle
                          };
                          navigator.clipboard.writeText(JSON.stringify(config, null, 2));
                          alert('Конфигурация темы скопирована в буфер обмена! Вставьте её сюда в чат.');
                        }}
                      >
                        📋 Конфиг
                      </button>
                      <button 
                        className="btn-secondary btn-small"
                        style={{ flex: 1, fontSize: '0.8rem', color: '#fca5a5', borderColor: 'rgba(239,68,68,0.2)' }}
                        onClick={resetDesign}
                      >
                        Сброс 🔄
                      </button>
                    </div>
                  </div>
                  <div className="form-group" style={{ marginBottom: '15px' }}>
                    <label>Фон (Лицевая сторона)</label>
                    <select value={cardBgFront} onChange={e => setCardBgFront(e.target.value)}>
                      <option value="auto">🎲 Случайный фон (Авто)</option>
                      <option disabled>──────────</option>
                      <option value="standard">Standard Glass</option>
                      <option value="mesh">Celestial Mesh</option>
                      <option value="aurora">Aurora Waves</option>
                      <option value="holographic">Holographic</option>
                      <option value="liquid">Liquid Flow 💧</option>
                      <option value="liquid_sunset">Sunset Flow 🌅</option>
                      <option value="liquid_ocean">Ocean Flow 🌊</option>
                      <option value="liquid_morning">Утреннее море 🌅</option>
                      <option value="liquid_cosmic">Cosmic Flow 🌌</option>
                      <option value="liquid_emerald">Emerald Flow 🌿</option>
                      <option disabled>──────────</option>
                      <option value="video_aquarium">Видео: Аквариум 🐠</option>
                      <option value="video_space">Видео: Космос 🌌</option>
                      <option value="video_nature">Видео: Природа 🌿</option>
                      {customBackgrounds && customBackgrounds.length > 0 && (
                        <>
                          <option disabled>── Мои фоны ──</option>
                          {customBackgrounds.map(bg => (
                            <option key={bg.filename} value={`custom_${bg.filename}`}>
                              {bg.filename}
                            </option>
                          ))}
                        </>
                      )}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Фон (Обратная сторона)</label>
                    <select value={cardBgBack} onChange={e => setCardBgBack(e.target.value)}>
                      <option value="auto">🎲 Случайный фон (Авто)</option>
                      <option disabled>──────────</option>
                      <option value="standard">Standard Glass</option>
                      <option value="mesh">Celestial Mesh</option>
                      <option value="aurora">Aurora Waves</option>
                      <option value="holographic">Holographic</option>
                      <option value="liquid">Liquid Flow 💧</option>
                      <option value="liquid_sunset">Sunset Flow 🌅</option>
                      <option value="liquid_ocean">Ocean Flow 🌊</option>
                      <option value="liquid_morning">Утреннее море 🌅</option>
                      <option value="liquid_cosmic">Cosmic Flow 🌌</option>
                      <option value="liquid_emerald">Emerald Flow 🌿</option>
                      <option disabled>──────────</option>
                      <option value="video_aquarium">Видео: Аквариум 🐠</option>
                      <option value="video_space">Видео: Космос 🌌</option>
                      <option value="video_nature">Видео: Природа 🌿</option>
                      {customBackgrounds && customBackgrounds.length > 0 && (
                        <>
                          <option disabled>── Мои фоны ──</option>
                          {customBackgrounds.map(bg => (
                            <option key={bg.filename} value={`custom_${bg.filename}`}>
                              {bg.filename}
                            </option>
                          ))}
                        </>
                      )}
                    </select>
                  </div>

                  <div className="custom-bg-manager glass" style={{ marginTop: '20px', padding: '15px' }}>
                    <h4 style={{ margin: '0 0 10px 0' }}>Предпросмотр (Лицо)</h4>
                    <TypographyPreview styleType={cardBgFront} showContext={false} />
                    
                    <h4 style={{ margin: '0 0 10px 0' }}>Основной текст (фраза, перевод)</h4>
                    <div className="form-group" style={{ marginBottom: '15px' }}>
                      <label>Шрифт</label>
                      <select value={cardFont} onChange={e => setCardFont(e.target.value)}>
                        <option value="Inter">Inter (Стандарт)</option>
                        <option value="Outfit">Outfit (Современный)</option>
                        <option value="Montserrat">Montserrat (Акцентный)</option>
                        <option value="Playfair Display">Playfair (Элегантный)</option>
                        <option value="Roboto">Roboto (Техничный)</option>
                        <option value="Caveat">Caveat (Рукописный)</option>
                        <option value="Pacifico">Pacifico (Курсивный)</option>
                        <option value="Oswald">Oswald (Строгий)</option>
                        <option value="Lobster">Lobster (Декоративный)</option>
                        <option value="Comfortaa">Comfortaa (Круглый)</option>
                      </select>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                        <button 
                          className={`btn-secondary btn-tiny ${cardFontWeight === '700' ? 'active' : ''}`}
                          onClick={() => setCardFontWeight(cardFontWeight === '700' ? '400' : '700')}
                          style={{ flex: 1, padding: '8px', fontSize: '0.9rem', background: cardFontWeight === '700' ? 'rgba(168,85,247,0.2)' : '' }}
                        >
                          <b>Ж</b>
                        </button>
                        <button 
                          className={`btn-secondary btn-tiny ${cardFontStyle === 'italic' ? 'active' : ''}`}
                          onClick={() => setCardFontStyle(cardFontStyle === 'italic' ? 'normal' : 'italic')}
                          style={{ flex: 1, padding: '8px', fontSize: '0.9rem', background: cardFontStyle === 'italic' ? 'rgba(168,85,247,0.2)' : '' }}
                        >
                          <i>К</i>
                        </button>
                      </div>
                    </div>
                    <div className="form-group">
                      <div className="label-with-value">
                        <label>Цвет и Эффект</label>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                          <input 
                            type="color" 
                            value={cardTextColor} 
                            onChange={e => setCardTextColor(e.target.value)}
                            style={{ width: '40px', height: '30px', padding: '0', border: 'none', background: 'transparent', cursor: 'pointer' }}
                          />
                          <select 
                            value={cardTextShadow} 
                            onChange={e => setCardTextShadow(e.target.value)}
                            style={{ flex: 1 }}
                          >
                            <option value="none">Без эффектов</option>
                            <option value="shadow">Мягкая тень</option>
                            <option value="glow">Свечение ✨</option>
                            <option value="neon">Неон 🌈</option>
                            <option value="outline">Контур ✏️</option>
                            <option value="glass">Стекло 🧊</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    <div className="form-group" style={{ marginTop: '10px' }}>
                      <div className="label-with-value">
                        <label>Размер</label>
                        <span className="value-badge">{cardFontSize}rem</span>
                      </div>
                      <input 
                        type="range" 
                        min="1" 
                        max="3" 
                        step="0.1"
                        value={cardFontSize} 
                        onChange={e => setCardFontSize(Number(e.target.value))} 
                      />
                    </div>
                  </div>

                  <div className="custom-bg-manager glass" style={{ marginTop: '15px', padding: '15px' }}>
                    <h4 style={{ margin: '0 0 10px 0' }}>Предпросмотр (Оборот)</h4>
                    <TypographyPreview styleType={cardBgBack} showContext={true} />
                    <div className="form-group" style={{ marginBottom: '15px' }}>
                      <label>Шрифт</label>
                      <select value={contextFont} onChange={e => setContextFont(e.target.value)}>
                        <option value="Inter">Inter (Стандарт)</option>
                        <option value="Outfit">Outfit (Современный)</option>
                        <option value="Montserrat">Montserrat (Акцентный)</option>
                        <option value="Playfair Display">Playfair (Элегантный)</option>
                        <option value="Roboto">Roboto (Техничный)</option>
                        <option value="Caveat">Caveat (Рукописный)</option>
                        <option value="Pacifico">Pacifico (Курсивный)</option>
                        <option value="Oswald">Oswald (Строгий)</option>
                        <option value="Lobster">Lobster (Декоративный)</option>
                        <option value="Comfortaa">Comfortaa (Круглый)</option>
                      </select>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                        <button 
                          className={`btn-secondary btn-tiny ${contextFontWeight === '700' ? 'active' : ''}`}
                          onClick={() => setContextFontWeight(contextFontWeight === '700' ? '400' : '700')}
                          style={{ flex: 1, padding: '8px', fontSize: '0.9rem', background: contextFontWeight === '700' ? 'rgba(168,85,247,0.2)' : '' }}
                        >
                          <b>Ж</b>
                        </button>
                        <button 
                          className={`btn-secondary btn-tiny ${contextFontStyle === 'italic' ? 'active' : ''}`}
                          onClick={() => setContextFontStyle(contextFontStyle === 'italic' ? 'normal' : 'italic')}
                          style={{ flex: 1, padding: '8px', fontSize: '0.9rem', background: contextFontStyle === 'italic' ? 'rgba(168,85,247,0.2)' : '' }}
                        >
                          <i>К</i>
                        </button>
                      </div>
                    </div>
                    <div className="form-group">
                      <div className="label-with-value">
                        <label>Цвет и Эффект</label>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                          <input 
                            type="color" 
                            value={contextTextColor} 
                            onChange={e => setContextTextColor(e.target.value)}
                            style={{ width: '40px', height: '30px', padding: '0', border: 'none', background: 'transparent', cursor: 'pointer' }}
                          />
                          <select 
                            value={contextTextShadow} 
                            onChange={e => setContextTextShadow(e.target.value)}
                            style={{ flex: 1 }}
                          >
                            <option value="none">Без эффектов</option>
                            <option value="shadow">Мягкая тень</option>
                            <option value="glow">Свечение ✨</option>
                            <option value="neon">Неон 🌈</option>
                            <option value="outline">Контур ✏️</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    <div className="form-group" style={{ marginTop: '10px' }}>
                      <div className="label-with-value">
                        <label>Размер</label>
                        <span className="value-badge">{contextFontSize}rem</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.8" 
                        max="2" 
                        step="0.05"
                        value={contextFontSize} 
                        onChange={e => setContextFontSize(Number(e.target.value))} 
                      />
                    </div>
                  </div>

                  <div className="custom-bg-manager glass" style={{ marginTop: '20px', padding: '15px' }}>
                    <h4 style={{ margin: '0 0 10px 0' }}>Загрузить свой видео-фон</h4>
                    <p className="field-hint">Загрузите MP4 видео, которое будет проигрываться за карточкой</p>
                    <input 
                      type="file" 
                      accept="video/mp4" 
                      onChange={e => {
                        if (e.target.files?.[0]) {
                          uploadCustomBackground(e.target.files[0]);
                        }
                      }}
                      className="file-input-minimal"
                    />
                  </div>
                </motion.div>
              )}

              {activeSettingsTab === 'voice' && (
                <motion.div key="voice" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
                  <h3>Синтез речи</h3>
                  <div className="form-group">
                    <label>Голос (Edge TTS)</label>
                    <select value={adminSettings.TTS_VOICE || ''} onChange={e => setAdminSettings({...adminSettings, TTS_VOICE: e.target.value})}>
                      {VOICE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <div className="label-with-value">
                      <label>Скорость</label>
                      <span className="value-badge">{adminSettings.TTS_SPEED || "+0%"}</span>
                    </div>
                    <input 
                      type="range" 
                      min="-50" 
                      max="100" 
                      step="5"
                      value={parseInt((adminSettings.TTS_SPEED || "+0%").replace('%', ''))} 
                      onChange={e => {
                        const val = parseInt(e.target.value);
                        const speed = val >= 0 ? `+${val}%` : `${val}%`;
                        setAdminSettings({...adminSettings, TTS_SPEED: speed});
                      }} 
                    />
                    <div className="range-labels">
                      <span>Медленно</span>
                      <span>Норм</span>
                      <span>Быстро</span>
                    </div>
                  </div>
                  <button className="btn btn-primary btn-small" onClick={saveAdminSettings}>Сохранить настройки голоса</button>
                </motion.div>
              )}

              {activeSettingsTab === 'ai' && (
                <motion.div key="ai" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section admin-section">
                  <h3>Настройки ИИ</h3>
                  <div className="form-group">
                    <label>Провайдер</label>
                    <select value={adminSettings.AI_PROVIDER || 'openrouter'} onChange={e => {
                      setAdminSettings({...adminSettings, AI_PROVIDER: e.target.value, DEFAULT_MODEL: ''});
                    }}>
                      <option value="ollama">Ollama (Локально)</option>
                      <option value="openrouter">OpenRouter (Облако)</option>
                    </select>
                  </div>
                  {adminSettings.AI_PROVIDER === 'ollama' ? (
                    <div className="form-group">
                      <label>Ollama URL</label>
                      <input value={adminSettings.OLLAMA_URL || ''} onChange={e => setAdminSettings({...adminSettings, OLLAMA_URL: e.target.value})} placeholder="http://localhost:11434" />
                    </div>
                  ) : (
                    <div className="form-group">
                      <label>OpenRouter API Key</label>
                      <input type="password" value={adminSettings.API_KEY || adminSettings.OPENROUTER_KEY || ''} onChange={e => setAdminSettings({...adminSettings, API_KEY: e.target.value})} placeholder="sk-or-..." />
                    </div>
                  )}
                  
                  <div className="form-group">
                    <div className="label-with-value">
                      <label>Модель</label>
                      <button className="btn-secondary btn-tiny" onClick={fetchModels} disabled={isFetchingModels}>
                        {isFetchingModels ? '...' : <RefreshCw size={12} />}
                      </button>
                    </div>
                    <div className="model-select-group">
                      <select 
                        value={availableModels.includes(adminSettings.DEFAULT_MODEL) ? adminSettings.DEFAULT_MODEL : 'custom'} 
                        onChange={e => {
                          if (e.target.value !== 'custom') {
                            setAdminSettings({...adminSettings, DEFAULT_MODEL: e.target.value});
                          }
                        }}
                      >
                        <option value="">Выберите модель...</option>
                        {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                        <option value="custom">-- Ввести вручную --</option>
                      </select>
                      {( !availableModels.includes(adminSettings.DEFAULT_MODEL) || adminSettings.DEFAULT_MODEL === '' ) && (
                        <input 
                          style={{marginTop: '8px'}}
                          value={adminSettings.DEFAULT_MODEL || ''} 
                          onChange={e => setAdminSettings({...adminSettings, DEFAULT_MODEL: e.target.value})} 
                          placeholder="Название модели вручную..." 
                        />
                      )}
                    </div>
                  </div>
                  <button className="btn btn-primary btn-small" onClick={saveAdminSettings}>Сохранить конфиг ИИ</button>
                </motion.div>
              )}

              {activeSettingsTab === 'prompts' && (
                <motion.div key="prompts" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
                  <h3>Промпты генерации</h3>
                  <div className="form-group">
                    <label>Системные инструкции</label>
                    <p className="field-hint">Определяют стиль перевода и глубину анализа</p>
                    <textarea 
                      value={userPrompts.translation_prompt || ''} 
                      onChange={e => setUserPrompts({...userPrompts, translation_prompt: e.target.value})} 
                      rows={8} 
                      placeholder="You are a language teacher..."
                    />
                  </div>
                  <button className="btn btn-primary btn-small" onClick={saveUserPrompts}>Сохранить промпты</button>
                </motion.div>
              )}

              {activeSettingsTab === 'presets' && (
                <motion.div key="presets" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
                  <h3>Управление пресетами</h3>
                  <div className="preset-save-box glass">
                    <input 
                      placeholder="Имя нового пресета..." 
                      value={newPresetName} 
                      onChange={e => setNewPresetName(e.target.value)} 
                    />
                    <button className="btn btn-primary btn-small" onClick={saveCurrentAsPreset}>Сохранить текущие</button>
                  </div>
                  
                  <div className="presets-list scrollable">
                    {presets.length === 0 ? <p className="hint">Нет сохраненных пресетов</p> : 
                      presets.map((p, idx) => (
                        <div key={idx} className="preset-item glass">
                          <div className="preset-info">
                            <strong>{p.name}</strong>
                            <span>{p.settings?.AI_PROVIDER} | {p.settings?.DEFAULT_MODEL?.split('/').pop()}</span>
                          </div>
                          <div className="preset-actions">
                            <button className="apply-btn" onClick={() => applyPreset(p)}>Применить</button>
                            <button className="delete-btn-minimal" onClick={() => deletePreset(idx)}><Trash2 size={14} /></button>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </motion.div>
              )}

              {activeSettingsTab === 'community' && (
                <motion.div key="community" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
                  <h3>Колоды пользователей</h3>
                  <p className="field-hint">Одобряйте колоды, чтобы добавить их в общую библиотеку Lerne</p>
                  
                  <div className="community-list scrollable">
                    {communityDecks.length === 0 ? <p className="hint">Новых колод пока нет</p> : 
                      communityDecks.map((d) => (
                        <div key={d.id} className="community-item glass">
                          <div className="community-info">
                            <strong>{d.name}</strong>
                            <span>Пользователь: {d.user_id} | Карточек: {d.card_count}</span>
                            {d.topic && <span className="tag">{d.topic}</span>}
                          </div>
                          <button className="btn btn-primary btn-small" onClick={() => promoteDeck(d.id)}>
                            В Библиотеку
                          </button>
                        </div>
                      ))
                    }
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

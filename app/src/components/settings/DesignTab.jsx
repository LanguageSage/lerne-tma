import React from 'react';
import { motion } from 'framer-motion';
import { TypographyPreview } from './TypographyPreview';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { DESIGN_PRESETS } from '../../constants/appConstants';
import api from '../../services/api';

export const DesignTab = () => {
  const {
    cardBgFront, setCardBgFront,
    cardBgBack, setCardBgBack,
    cardFont, setCardFont,
    cardTextColor, setCardTextColor,
    cardFontSize, setCardFontSize,
    contextFont, setContextFont,
    contextTextColor, setContextTextColor,
    contextFontSize, setContextFontSize,
    cardTextShadow, setCardTextShadow,
    contextTextShadow, setContextTextShadow,
    cardFontWeight, setCardFontWeight,
    cardFontStyle, setCardFontStyle,
    contextFontWeight, setContextFontWeight,
    contextFontStyle, setContextFontStyle,
    applyDesignPreset,
    saveUserDesign,
    applyUserDesign,
    userDesign,
    customBackgrounds,
    setCustomBackgrounds
  } = useSettingsStore();

  const { showToast } = useUiStore();

  const uploadCustomBackground = async (file) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'backgrounds');
      await api.post('/media/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      showToast("Фон загружен", "success");
      // Refresh backgrounds
      const res = await api.get('/media/backgrounds');
      setCustomBackgrounds(res.data);
    } catch (err) {
      showToast("Ошибка загрузки фона");
    }
  };

  return (
    <motion.div id="tut-settings-design" key="design" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
      <h3>Внешний вид карточек</h3>

      <div className="custom-bg-manager glass" style={{ marginBottom: '20px', padding: '15px' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#94a3b8' }}>Готовые темы</h4>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(2, 1fr)', 
          gap: '10px' 
        }}>
          {DESIGN_PRESETS && DESIGN_PRESETS.map(p => (
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
              alert('Конфигурация темы скопирована в буфер обмена!');
            }}
          >
            📋 Копировать
          </button>
          <button 
            className="btn-secondary btn-small"
            style={{ flex: 1, fontSize: '0.8rem', color: '#a78bfa', borderColor: 'rgba(167,139,250,0.2)' }}
            onClick={saveUserDesign}
          >
            Сохранить мой ✨
          </button>
          {userDesign && (
            <button 
              className="btn-secondary btn-small"
              style={{ flex: 1, fontSize: '0.8rem', color: '#34d399', borderColor: 'rgba(52,211,153,0.2)' }}
              onClick={applyUserDesign}
            >
              Мой пресет 👤
            </button>
          )}
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
  );
};

import React from 'react';
import { motion } from 'framer-motion';
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { TypographyPreview } from './TypographyPreview';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { DESIGN_PRESETS } from '../../constants/appConstants';
import api from '../../services/api';

const PRESET_COLORS = [
  '#ffffff', // Белый
  '#cbd5e1', // Серебристый
  '#ffff00', // Неоновый жёлтый
  '#fde047', // Солнечный
  '#f59e0b', // Золотистый янтарь
  '#ff9800', // Оранжевый
  '#fb923c', // Тёплый персиковый
  '#ef4444', // Красный
  '#f43f5e', // Коралловый
  '#ec4899', // Розовый
  '#d946ef', // Фуксия
  '#a855f7', // Фиолетовый
  '#c084fc', // Нежная лаванда
  '#818cf8', // Индиго
  '#3b82f6', // Насыщенный синий
  '#38bdf8', // Небесно-голубой
  '#00ffff', // Бирюзовый / Циан
  '#2dd4bf', // Мятный
  '#00e676', // Неоновый изумруд
  '#84cc16', // Лайм
  '#1e293b', // Тёмный графит
  '#080c03', // Глубокий обсидиан
];

export const DesignTab = () => {
  const {
    cardBgFront, setCardBgFront,
    cardBgBack, setCardBgBack,
    cardFont, setCardFont,
    cardTextColor, setCardTextColor,
    cardFontSize, setCardFontSize,
    cardTextAlign, setCardTextAlign,
    backTextColor, setBackTextColor,
    contextFont, setContextFont,
    contextTextColor, setContextTextColor,
    contextFontSize, setContextFontSize,
    contextTextAlign, setContextTextAlign,
    cardTextShadow, setCardTextShadow,
    contextTextShadow, setContextTextShadow,
    cardFontWeight, setCardFontWeight,
    cardFontStyle, setCardFontStyle,
    contextFontWeight, setContextFontWeight,
    contextFontStyle, setContextFontStyle,
    applyDesignPreset,
    saveUserDesign,
    applyUserDesign,
    resetDesign,
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
    } catch {
      showToast("Ошибка загрузки фона");
    }
  };

  return (
    <motion.div id="tut-settings-design" key="design" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
      <h3>Внешний вид карточек</h3>

      <div className="custom-bg-manager glass" style={{ marginBottom: '18px', padding: '14px' }}>
        <div className="form-group" style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '0.88rem', color: '#94a3b8', marginBottom: '6px' }}>Готовая тема оформления</label>
          <select 
            value="" 
            onChange={(e) => {
              const preset = DESIGN_PRESETS.find(p => p.id === e.target.value);
              if (preset) {
                applyDesignPreset(preset);
                showToast(`Применена тема: ${preset.name}`, 'success');
              }
            }}
            style={{ width: '100%' }}
          >
            <option value="" disabled>✨ Выберите готовую тему...</option>
            <optgroup label="── Строгие тёмные темы ──">
              <option value="strict_dark">Строгий тёмный 🖤</option>
              <option value="strict_minimal">Минимализм 🌑</option>
              <option value="strict_midnight">Полуночный 🌌</option>
              <option value="strict_emerald">Тёмный изумруд 🌿</option>
            </optgroup>
            <optgroup label="── Цветные и анимированные ──">
              <option value="lerne_2026">Lerne 2026 ✨</option>
              <option value="premium">Премиум 💎</option>
              <option value="aurora">Сияние 🌌</option>
              <option value="morning_sea">Утреннее море 🌊</option>
              <option value="cyberpunk">Киберпанк 🤖</option>
              <option value="deep_ocean">Океан 🌊</option>
            </optgroup>
          </select>
        </div>

        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: userDesign ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)', 
          gap: '8px', 
          marginTop: '6px' 
        }}>
          <button 
            className="btn-secondary btn-tiny" 
            style={{ fontSize: '0.78rem', background: 'rgba(255,255,255,0.05)', padding: '8px 4px' }}
            onClick={() => {
              const config = {
                cardBgFront, cardBgBack, cardFont, cardTextColor, cardFontSize, cardTextAlign,
                backTextColor,
                contextFont, contextTextColor, contextFontSize, contextTextAlign, cardTextShadow, contextTextShadow,
                cardFontWeight, cardFontStyle, contextFontWeight, contextFontStyle
              };
              navigator.clipboard.writeText(JSON.stringify(config, null, 2));
              showToast('Конфигурация темы скопирована!', 'success');
            }}
            title="Скопировать настройки в буфер"
          >
            📋 Копия
          </button>
          <button 
            className="btn-secondary btn-tiny"
            style={{ fontSize: '0.78rem', color: '#f3f4f6', borderColor: 'rgba(255,255,255,0.1)', padding: '8px 4px' }}
            onClick={() => {
              resetDesign();
              showToast('Дизайн сброшен по умолчанию', 'success');
            }}
            title="Сбросить дизайн к стандартному"
          >
            🧹 Сброс
          </button>
          <button 
            className="btn-secondary btn-tiny"
            style={{ fontSize: '0.78rem', color: '#a78bfa', borderColor: 'rgba(167,139,250,0.2)', padding: '8px 4px' }}
            onClick={() => {
              saveUserDesign();
              showToast('Мой пресет сохранен!', 'success');
            }}
            title="Сохранить текущие настройки как мой пресет"
          >
            💾 Мой
          </button>
          {userDesign && (
            <button 
              className="btn-secondary btn-tiny"
              style={{ fontSize: '0.78rem', color: '#34d399', borderColor: 'rgba(52,211,153,0.2)', padding: '8px 4px' }}
              onClick={() => {
                applyUserDesign();
                showToast('Мой пресет применен!', 'success');
              }}
              title="Применить сохраненный пресет"
            >
              👤 Мой
            </button>
          )}
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: '15px' }}>
        <label>Фон (Лицевая сторона)</label>
        <select value={cardBgFront} onChange={e => setCardBgFront(e.target.value)}>
          <option value="auto">🎲 Случайный фон (Авто)</option>
          <option disabled>── Строгие тёмные ──</option>
          <option value="dark_obsidian">Строгий графит 🖤</option>
          <option value="dark_minimal">Минимализм 🌑</option>
          <option value="dark_midnight">Полуночный синий 🌌</option>
          <option value="dark_emerald">Тёмный изумруд 🌿</option>
          <option value="dark_mocha">Тёмный мокко ☕</option>
          <option disabled>── Живые градиенты ──</option>
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
          <option disabled>── Видео фоны ──</option>
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
          <option disabled>── Строгие тёмные ──</option>
          <option value="dark_obsidian">Строгий графит 🖤</option>
          <option value="dark_minimal">Минимализм 🌑</option>
          <option value="dark_midnight">Полуночный синий 🌌</option>
          <option value="dark_emerald">Тёмный изумруд 🌿</option>
          <option value="dark_mocha">Тёмный мокко ☕</option>
          <option disabled>── Живые градиенты ──</option>
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
          <option disabled>── Видео фоны ──</option>
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
        <h4 style={{ margin: '0 0 10px 0' }}>Предпросмотр (Лицевая сторона)</h4>
        <TypographyPreview styleType={cardBgFront} showContext={false} />
        
        {/* Color Palette directly below Front Preview */}
        <div className="form-group" style={{ marginBottom: '15px' }}>
          <label>Цвет текста (Лицевая сторона)</label>
          <div style={{ 
            display: 'flex', 
            gap: '8px', 
            flexWrap: 'wrap', 
            marginTop: '8px',
            marginBottom: '10px',
            padding: '10px',
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            alignItems: 'center'
          }}>
            {PRESET_COLORS.map(color => {
              const isSelected = cardTextColor?.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={color}
                  type="button"
                  onClick={() => setCardTextColor(color)}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: color,
                    border: isSelected ? '2.5px solid #a78bfa' : '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                    padding: 0,
                    flexShrink: 0,
                    boxShadow: isSelected ? '0 0 10px rgba(167,139,250,0.6)' : 'none',
                    transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                    transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                  title={color === '#ffffff' ? 'Белый' : color}
                />
              );
            })}

            {/* Custom color picker tool */}
            <label 
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)',
                cursor: 'pointer',
                border: '1.5px solid rgba(255, 255, 255, 0.5)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                flexShrink: 0,
                position: 'relative',
                overflow: 'hidden'
              }}
              title="Выбрать свой цвет (спектр)"
            >
              <input 
                type="color" 
                value={cardTextColor} 
                onChange={e => setCardTextColor(e.target.value)}
                style={{
                  position: 'absolute',
                  top: '-50%',
                  left: '-50%',
                  width: '200%',
                  height: '200%',
                  opacity: 0,
                  cursor: 'pointer'
                }}
              />
            </label>
          </div>

          <div style={{ marginTop: '8px' }}>
            <label style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px', display: 'block' }}>Эффект свечения / тени</label>
            <select 
              value={cardTextShadow} 
              onChange={e => setCardTextShadow(e.target.value)}
              style={{ width: '100%' }}
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
        <div className="form-group" style={{ marginTop: '12px' }}>
          <label>Выравнивание текста (Лицевая сторона)</label>
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <button
              type="button"
              className={`btn-secondary btn-tiny ${cardTextAlign === 'left' ? 'active' : ''}`}
              onClick={() => setCardTextAlign('left')}
              style={{
                flex: 1,
                padding: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '0.85rem',
                background: cardTextAlign === 'left' ? 'rgba(168,85,247,0.25)' : undefined,
                borderColor: cardTextAlign === 'left' ? '#a78bfa' : undefined
              }}
            >
              <AlignLeft size={16} />
              <span>Слева</span>
            </button>
            <button
              type="button"
              className={`btn-secondary btn-tiny ${(!cardTextAlign || cardTextAlign === 'center') ? 'active' : ''}`}
              onClick={() => setCardTextAlign('center')}
              style={{
                flex: 1,
                padding: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '0.85rem',
                background: (!cardTextAlign || cardTextAlign === 'center') ? 'rgba(168,85,247,0.25)' : undefined,
                borderColor: (!cardTextAlign || cardTextAlign === 'center') ? '#a78bfa' : undefined
              }}
            >
              <AlignCenter size={16} />
              <span>Центр</span>
            </button>
            <button
              type="button"
              className={`btn-secondary btn-tiny ${cardTextAlign === 'right' ? 'active' : ''}`}
              onClick={() => setCardTextAlign('right')}
              style={{
                flex: 1,
                padding: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '0.85rem',
                background: cardTextAlign === 'right' ? 'rgba(168,85,247,0.25)' : undefined,
                borderColor: cardTextAlign === 'right' ? '#a78bfa' : undefined
              }}
            >
              <AlignRight size={16} />
              <span>Справа</span>
            </button>
          </div>
        </div>
      </div>

      <div className="custom-bg-manager glass" style={{ marginTop: '15px', padding: '15px' }}>
        <h4 style={{ margin: '0 0 10px 0' }}>Предпросмотр (Обратная сторона)</h4>
        <TypographyPreview styleType={cardBgBack} showContext={true} />

        {/* Single Color Palette directly below Back Preview */}
        <div className="form-group" style={{ marginBottom: '15px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <label style={{ margin: 0 }}>Цвет перевода (Обратная сторона)</label>
            <span style={{ fontSize: '0.78rem', color: '#a78bfa', background: 'rgba(168,85,247,0.12)', padding: '2px 6px', borderRadius: '6px', border: '1px solid rgba(168,85,247,0.25)' }}>
              Контекст адаптируется 🪄
            </span>
          </div>

          <div style={{ 
            display: 'flex', 
            gap: '8px', 
            flexWrap: 'wrap', 
            marginTop: '8px',
            marginBottom: '10px',
            padding: '10px',
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            alignItems: 'center'
          }}>
            {PRESET_COLORS.map(color => {
              const currentBack = (backTextColor || cardTextColor || '#ffffff').toLowerCase();
              const isSelected = currentBack === color.toLowerCase();
              return (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    setBackTextColor(color);
                    setContextTextColor('auto');
                  }}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: color,
                    border: isSelected ? '2.5px solid #a78bfa' : '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                    padding: 0,
                    flexShrink: 0,
                    boxShadow: isSelected ? '0 0 10px rgba(167,139,250,0.6)' : 'none',
                    transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                    transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                  title={color === '#ffffff' ? 'Белый' : color}
                />
              );
            })}

            {/* Custom color picker tool for back */}
            <label 
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)',
                cursor: 'pointer',
                border: '1.5px solid rgba(255, 255, 255, 0.5)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                flexShrink: 0,
                position: 'relative',
                overflow: 'hidden'
              }}
              title="Выбрать свой цвет (спектр)"
            >
              <input 
                type="color" 
                value={backTextColor || cardTextColor || '#ffffff'} 
                onChange={e => {
                  setBackTextColor(e.target.value);
                  setContextTextColor('auto');
                }}
                style={{
                  position: 'absolute',
                  top: '-50%',
                  left: '-50%',
                  width: '200%',
                  height: '200%',
                  opacity: 0,
                  cursor: 'pointer'
                }}
              />
            </label>
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: '15px' }}>
          <label>Шрифт контекста и примеров</label>
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

        <div className="form-group" style={{ marginBottom: '14px' }}>
          <label>Эффект тени контекста</label>
          <select 
            value={contextTextShadow} 
            onChange={e => setContextTextShadow(e.target.value)}
            style={{ width: '100%', marginTop: '6px' }}
          >
            <option value="none">Без эффектов</option>
            <option value="shadow">Мягкая тень</option>
            <option value="glow">Свечение ✨</option>
            <option value="neon">Неон 🌈</option>
            <option value="outline">Контур ✏️</option>
          </select>
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
        <div className="form-group" style={{ marginTop: '12px' }}>
          <label>Выравнивание текста (Обратная сторона)</label>
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <button
              type="button"
              className={`btn-secondary btn-tiny ${(!contextTextAlign || contextTextAlign === 'left') ? 'active' : ''}`}
              onClick={() => setContextTextAlign('left')}
              style={{
                flex: 1,
                padding: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '0.85rem',
                background: (!contextTextAlign || contextTextAlign === 'left') ? 'rgba(168,85,247,0.25)' : undefined,
                borderColor: (!contextTextAlign || contextTextAlign === 'left') ? '#a78bfa' : undefined
              }}
            >
              <AlignLeft size={16} />
              <span>Слева</span>
            </button>
            <button
              type="button"
              className={`btn-secondary btn-tiny ${contextTextAlign === 'center' ? 'active' : ''}`}
              onClick={() => setContextTextAlign('center')}
              style={{
                flex: 1,
                padding: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '0.85rem',
                background: contextTextAlign === 'center' ? 'rgba(168,85,247,0.25)' : undefined,
                borderColor: contextTextAlign === 'center' ? '#a78bfa' : undefined
              }}
            >
              <AlignCenter size={16} />
              <span>Центр</span>
            </button>
            <button
              type="button"
              className={`btn-secondary btn-tiny ${contextTextAlign === 'right' ? 'active' : ''}`}
              onClick={() => setContextTextAlign('right')}
              style={{
                flex: 1,
                padding: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '0.85rem',
                background: contextTextAlign === 'right' ? 'rgba(168,85,247,0.25)' : undefined,
                borderColor: contextTextAlign === 'right' ? '#a78bfa' : undefined
              }}
            >
              <AlignRight size={16} />
              <span>Справа</span>
            </button>
          </div>
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

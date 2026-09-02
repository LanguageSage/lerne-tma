import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Check, ArrowRight, RefreshCw, X, Search, ShieldCheck } from 'lucide-react';
import { BUNDESLAENDER, getBundeslandByCode } from '../../data/bundeslaender';
import { useLidStore } from '../../store/useLidStore';

export const BundeslandModal = ({ isOpen, onClose, onConfirm }) => {
  const {
    selectedLandCode,
    rememberLandChoice,
    isLandChangeMode,
    selectLand
  } = useLidStore();

  const [tempSelectedCode, setTempSelectedCode] = useState(selectedLandCode || 'BY');
  const [remember, setRemember] = useState(rememberLandChoice !== false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isPickerView, setIsPickerView] = useState(!selectedLandCode || isLandChangeMode);

  // Sync state when opening
  React.useEffect(() => {
    if (isOpen) {
      if (!selectedLandCode || isLandChangeMode) {
        setIsPickerView(true);
      } else {
        setIsPickerView(false);
      }
      setTempSelectedCode(selectedLandCode || 'BY');
      setRemember(rememberLandChoice !== false);
      setSearchQuery('');
    }
  }, [isOpen, selectedLandCode, isLandChangeMode, rememberLandChoice]);

  const savedLand = useMemo(() => getBundeslandByCode(selectedLandCode), [selectedLandCode]);
  const activeTempLand = useMemo(() => getBundeslandByCode(tempSelectedCode), [tempSelectedCode]);

  const filteredLands = useMemo(() => {
    if (!searchQuery.trim()) return BUNDESLAENDER;
    const q = searchQuery.toLowerCase().trim();
    return BUNDESLAENDER.filter(b =>
      b.nameDe.toLowerCase().includes(q) ||
      b.nameRu.toLowerCase().includes(q) ||
      b.capital.toLowerCase().includes(q) ||
      b.code.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  if (!isOpen) return null;

  const handleSelectAndConfirm = (code) => {
    selectLand(code, remember);
    if (onConfirm) onConfirm(code);
  };

  const handleDirectContinue = () => {
    if (onConfirm) onConfirm(selectedLandCode);
  };

  return (
    <AnimatePresence>
      <div className="modal-overlay" onClick={onClose} style={{ zIndex: 10000 }}>
        <motion.div
          className="lid-modal-card glass"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 20 }}
          transition={{ duration: 0.25 }}
        >
          {/* Header */}
          <div className="lid-modal-header">
            <div className="lid-modal-title-wrap">
              <div className="lid-modal-icon-badge">
                <span>🇩🇪</span>
              </div>
              <div>
                <h3 className="lid-modal-title">
                  {isPickerView ? 'Выбор федеральной земли' : 'Федеральная земля'}
                </h3>
                <p className="lid-modal-subtitle">
                  {isPickerView
                    ? '3 региональных вопроса будут включены в ваш экзамен'
                    : 'Выбранная земля для экзамена LiD'}
                </p>
              </div>
            </div>
            <button className="lid-modal-close-btn" onClick={onClose} aria-label="Закрыть">
              <X size={20} />
            </button>
          </div>

          {/* Body: Mode 1 - Saved Land Confirmation */}
          {!isPickerView && savedLand && (
            <div className="lid-saved-land-body">
              <motion.div
                className="lid-saved-land-card"
                style={{ background: savedLand.gradient || 'rgba(255,255,255,0.05)' }}
                whileHover={{ scale: 1.01 }}
              >
                <div className="lid-land-symbol-large">
                  <span>{savedLand.symbol}</span>
                </div>
                <div className="lid-saved-land-info">
                  <span className="lid-land-code-pill">{savedLand.code}</span>
                  <h4 className="lid-saved-land-name">{savedLand.nameDe}</h4>
                  <p className="lid-saved-land-sub">{savedLand.nameRu}</p>
                  <div className="lid-saved-land-meta">
                    <MapPin size={14} />
                    <span>Столица: {savedLand.capital}</span>
                    <span className="lid-meta-dot">•</span>
                    <span>10 вопросов</span>
                  </div>
                </div>
              </motion.div>

              <div className="lid-saved-land-actions">
                <button
                  type="button"
                  className="btn btn-secondary lid-btn-change-land"
                  onClick={() => setIsPickerView(true)}
                >
                  <RefreshCw size={16} />
                  <span>Выбрать другую землю</span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary lid-btn-continue"
                  onClick={handleDirectContinue}
                >
                  <span>Далее</span>
                  <ArrowRight size={18} />
                </button>
              </div>
            </div>
          )}

          {/* Body: Mode 2 - 16 Lands Picker Grid */}
          {isPickerView && (
            <div className="lid-picker-body">
              {/* Search Bar */}
              <div className="lid-search-box glass">
                <Search size={16} className="lid-search-icon" />
                <input
                  type="text"
                  placeholder="Поиск земли или столицы..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="lid-search-input"
                  autoFocus
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="lid-search-clear"
                    onClick={() => setSearchQuery('')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Grid of 16 Bundesländer */}
              <div className="lid-lands-grid">
                {filteredLands.map((land) => {
                  const isSelected = tempSelectedCode === land.code;
                  return (
                    <motion.div
                      key={land.code}
                      className={`lid-land-item glass ${isSelected ? 'selected' : ''}`}
                      onClick={() => setTempSelectedCode(land.code)}
                      whileTap={{ scale: 0.97 }}
                      style={{
                        borderColor: isSelected ? land.color || '#38bdf8' : undefined,
                        boxShadow: isSelected ? `0 0 16px ${land.color}40` : undefined
                      }}
                    >
                      <div className="lid-land-item-top">
                        <span className="lid-land-symbol">{land.symbol}</span>
                        <span className="lid-land-code-tag">{land.code}</span>
                      </div>
                      <div className="lid-land-item-info">
                        <div className="lid-land-name-de">{land.nameDe}</div>
                        <div className="lid-land-name-ru">{land.nameRu}</div>
                        <div className="lid-land-capital">{land.capital}</div>
                      </div>
                      {isSelected && (
                        <div className="lid-land-check-badge" style={{ background: land.color || '#38bdf8' }}>
                          <Check size={12} color="#000" strokeWidth={3} />
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>

              {/* Remember Choice Toggle */}
              <div className="lid-remember-row" onClick={() => setRemember(!remember)}>
                <div className={`lid-checkbox ${remember ? 'checked' : ''}`}>
                  {remember && <Check size={14} />}
                </div>
                <div className="lid-remember-label">
                  <span className="lid-remember-title">Запомнить мой выбор</span>
                  <span className="lid-remember-desc">
                    При следующем запуске эта земля будет выбрана автоматически
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="lid-picker-actions">
                {selectedLandCode && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsPickerView(false)}
                  >
                    Назад
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary lid-btn-submit-land"
                  disabled={!tempSelectedCode}
                  onClick={() => handleSelectAndConfirm(tempSelectedCode)}
                >
                  <ShieldCheck size={18} />
                  <span>
                    Выбрать {activeTempLand ? activeTempLand.nameDe : 'землю'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

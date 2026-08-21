import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Globe, Check } from 'lucide-react';
import { useLanguageStore, SUPPORTED_LANGUAGES } from '../../store/useLanguageStore';
import { useTranslation } from '../../i18n/i18nContext';
import { renderFlag } from './FlagIcons';
import './LanguageSelectorBadge.css';

export const LanguageSelectorBadge = ({ onLanguageChange }) => {
  const { activeLanguage, setLanguage } = useLanguageStore();
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === activeLanguage) || SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (code) => {
    setLanguage(code);
    setIsOpen(false);
    if (onLanguageChange) {
      onLanguageChange(code);
    }
  };

  return (
    <div className="language-selector-container" ref={dropdownRef}>
      <button 
        className="language-badge-btn"
        onClick={() => setIsOpen(!isOpen)}
        title={t('header.target_lang_title', 'Выбрать изучаемый язык')}
      >
        <span className="lang-flag">{renderFlag(currentLang.code, 18)}</span>
        <span className="lang-name">{currentLang.name}</span>
        <ChevronDown size={14} className={`chevron-icon ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="language-dropdown-menu">
          <div className="language-dropdown-header">
            <Globe size={14} />
            <span>{t('header.target_lang', 'Изучаемый язык')}</span>
          </div>
          <div className="language-dropdown-list">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                className={`language-option ${lang.code === activeLanguage ? 'active' : ''}`}
                onClick={() => handleSelect(lang.code)}
              >
                <span className="option-flag">{renderFlag(lang.code, 22)}</span>
                <div className="option-info">
                  <span className="option-name">{lang.name}</span>
                  <span className="option-label">{lang.label}</span>
                </div>
                {lang.code === activeLanguage && <Check size={16} className="active-check" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

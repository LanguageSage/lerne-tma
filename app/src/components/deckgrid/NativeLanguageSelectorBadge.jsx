import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Globe, Check } from 'lucide-react';
import { useTranslation } from '../../i18n/i18nContext';
import { SUPPORTED_NATIVE_LANGUAGES } from '../../constants/languageConstants';
import { useSettingsStore } from '../../store/useSettingsStore';

export const NativeLanguageSelectorBadge = () => {
  const { nativeLanguage, changeNativeLanguage, t } = useTranslation();
  const { setVoiceBack } = useSettingsStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const currentLang = SUPPORTED_NATIVE_LANGUAGES.find(l => l.code === nativeLanguage) || SUPPORTED_NATIVE_LANGUAGES[0];

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

  const handleSelect = (e, code) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(false);
    changeNativeLanguage(code);
    const langObj = SUPPORTED_NATIVE_LANGUAGES.find(l => l.code === code);
    if (langObj) {
      setVoiceBack(langObj.defaultVoice);
    }
  };

  return (
    <div className="language-selector-container" ref={dropdownRef}>
      <button 
        className="language-badge-btn"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        title={t('header.native_lang_title', 'Выбрать язык интерфейса')}
        style={{
          border: '1px solid rgba(56, 189, 248, 0.3)',
          background: 'rgba(56, 189, 248, 0.1)'
        }}
      >
        <span className="lang-flag">{currentLang.flag}</span>
        <span className="lang-name">{currentLang.name}</span>
        <ChevronDown size={14} className={`chevron-icon ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="language-dropdown-menu" onClick={(e) => e.stopPropagation()}>
          <div className="language-dropdown-header">
            <Globe size={14} />
            <span>{t('header.native_lang', 'Язык интерфейса')}</span>
          </div>
          <div className="language-dropdown-list">
            {SUPPORTED_NATIVE_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                className={`language-option ${lang.code === nativeLanguage ? 'active' : ''}`}
                onClick={(e) => handleSelect(e, lang.code)}
              >
                <span className="option-flag" style={{ fontSize: '1.2rem' }}>{lang.flag}</span>
                <div className="option-info">
                  <span className="option-name">{lang.name}</span>
                </div>
                {lang.code === nativeLanguage && <Check size={16} className="active-check" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

};

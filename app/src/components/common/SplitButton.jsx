import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, ChevronDown, MessageSquare, RefreshCw } from 'lucide-react';

export const SplitButton = ({
  onMainClick,
  onOptionClick,
  loading = false,
  disabled = false,
  mainLabel = 'Сгенерировать ИИ',
  options = [
    {
      id: 'custom_directive',
      label: '💬 Выполнить только просьбу / вопрос',
      icon: MessageSquare
    }
  ]
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMainClick = (e) => {
    e.preventDefault();
    if (loading || disabled) return;
    setIsOpen(false);
    onMainClick();
  };

  const handleOptionClick = (e, optionId) => {
    e.preventDefault();
    if (loading || disabled) return;
    setIsOpen(false);
    onOptionClick(optionId);
  };

  return (
    <div className="split-button-container" ref={dropdownRef}>
      <button
        type="button"
        className={`btn-ai-generate split-btn-main ${loading ? 'loading' : ''}`}
        onClick={handleMainClick}
        disabled={loading || disabled}
      >
        {loading ? (
          <RefreshCw className="spin" size={16} />
        ) : (
          <Sparkles size={16} />
        )}
        <span>{mainLabel}</span>
      </button>

      <button
        type="button"
        className={`split-btn-arrow ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading || disabled}
        aria-label="Больше действий ИИ"
      >
        <ChevronDown size={14} />
      </button>

      {isOpen && (
        <div className="split-button-dropdown">
          {options.map((opt) => {
            const Icon = opt.icon || MessageSquare;
            return (
              <button
                key={opt.id}
                type="button"
                className="split-dropdown-item"
                onClick={(e) => handleOptionClick(e, opt.id)}
              >
                {Icon && <Icon size={14} className="dropdown-item-icon" />}
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SplitButton;

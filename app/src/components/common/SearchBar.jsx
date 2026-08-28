import React from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from '../../i18n/i18nContext';

/**
 * Reusable SearchBar component with glassmorphic styling,
 * search icon, clear button, and optional results metadata.
 */
export const SearchBar = ({
  value = '',
  onChange,
  onClear,
  placeholder,
  count,
  total,
  countLabel,
  className = '',
  wrapperClassName = '',
  style = {},
  autoFocus = false,
  color = 'purple',
  inputRef
}) => {
  const { t } = useTranslation();

  const handleInputChange = (e) => {
    if (typeof onChange === 'function') {
      onChange(e.target.value);
    }
  };

  const handleClear = () => {
    if (typeof onClear === 'function') {
      onClear();
    } else if (typeof onChange === 'function') {
      onChange('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      handleClear();
    }
  };

  const isQueryActive = Boolean(value && value.trim());
  const showMeta = isQueryActive && typeof count === 'number' && typeof total === 'number';

  return (
    <div className={`card-search-wrapper ${wrapperClassName}`} style={style}>
      <div className={`card-search-box search-bar-theme-${color} ${className}`}>
        <Search size={18} className="card-search-icon" />
        <input
          ref={inputRef}
          type="text"
          className="card-search-input"
          placeholder={placeholder || t('cards.search_placeholder', 'Поиск...')}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
          aria-label={placeholder || 'Поиск'}
        />
        {isQueryActive && (
          <button
            type="button"
            className="card-search-clear"
            onClick={handleClear}
            title={t('cards.search_clear', 'Очистить')}
            aria-label="Очистить поиск"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {showMeta && (
        <div className="card-search-meta">
          <span>
            {countLabel || t('cards.search_found', { count, total }) || `Найдено: ${count} из ${total}`}
          </span>
          <span className="card-search-badge">
            {count} / {total}
          </span>
        </div>
      )}
    </div>
  );
};

export default SearchBar;

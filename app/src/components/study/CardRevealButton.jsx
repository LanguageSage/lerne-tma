import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { Eye } from 'lucide-react';

/**
 * Shared CardRevealButton component.
 * Replaces duplicated reveal button JSX across StudyCard, StudyCardTrainer, StudyCardPuzzle, StudyCardSpeech.
 */
const CardRevealButton = React.memo(({ onClick, label = tr("Показать ответ"), icon: CustomIcon = Eye, style = {} }) => {
  useInterfaceLocale();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (onClick) onClick(e);
      }}
      className="btn-interactive-reveal"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        width: '100%',
        padding: '12px 20px',
        borderRadius: '14px',
        border: '1px solid rgba(56, 189, 248, 0.35)',
        background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.15) 0%, rgba(99, 102, 241, 0.1) 100%)',
        color: '#38bdf8',
        fontWeight: 700,
        fontSize: '0.95rem',
        cursor: 'pointer',
        backdropFilter: 'blur(8px)',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 4px 15px rgba(56, 189, 248, 0.12)',
        userSelect: 'none',
        ...style
      }}
    >
      <CustomIcon size={18} />
      <span>{label}</span>
    </button>
  );
});

export default CardRevealButton;

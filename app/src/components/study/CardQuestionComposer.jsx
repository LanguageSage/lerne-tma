import React, { useEffect, useId, useRef, useState } from 'react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';

export function CardQuestionComposer({
  onSubmit,
  icon = '💬',
  triggerLabel = tr('Задать вопрос'),
  title = tr('Что хотите уточнить?'),
  placeholder = tr('Напишите вопрос...'),
  submitLabel = tr('Отправить'),
  disabled = false,
  variant = 'question',
}) {
  useInterfaceLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef(null);
  const inputId = useId();

  useEffect(() => {
    if (isOpen) textareaRef.current?.focus();
  }, [isOpen]);

  const handleCancel = () => {
    setQuestion('');
    setIsOpen(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const request = question.trim();
    if (!request || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const succeeded = await onSubmit?.(request);
      if (succeeded) {
        setQuestion('');
        setIsOpen(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`card-question-composer is-${variant} ${isOpen ? 'is-open' : ''}`} onClick={(event) => event.stopPropagation()}>
      {!isOpen ? (
        <button
          type="button"
          className="card-question-trigger"
          onClick={() => setIsOpen(true)}
          disabled={disabled}
        >
          <span aria-hidden="true">{icon}</span>
          <span>{triggerLabel}</span>
        </button>
      ) : (
        <form className="card-question-form" onSubmit={handleSubmit}>
          <label className="card-question-label" htmlFor={inputId}>
            <span aria-hidden="true">{icon}</span>
            <span>{title}</span>
          </label>
          <textarea
            ref={textareaRef}
            id={inputId}
            className="card-question-input"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={placeholder}
            disabled={isSubmitting || disabled}
            rows={3}
          />
          <div className="card-question-actions">
            <button type="button" className="card-question-button secondary" onClick={handleCancel} disabled={isSubmitting || disabled}>
              {tr('Отмена')}
            </button>
            <button type="submit" className="card-question-button primary" disabled={!question.trim() || isSubmitting || disabled}>
              {isSubmitting ? tr('Выполняется...') : submitLabel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

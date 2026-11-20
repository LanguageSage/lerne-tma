import { useEffect, useRef } from 'react';
import { t, tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { answerField } from '../../utils/cardDraft';
import { StudyCardText } from '../study/StudyCardText';
import { InlineText } from './VisualCardFields';
import { MarkdownRenderer } from './MarkdownRenderer';

const backLabels = { theory: 'Краткий вывод', free_text: 'Образец ответа', editable_text: 'Исправленный текст' };

function autoResize(field) {
  if (!field?.getClientRects().length) return;
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
}

function CardContextField({ explanation, update, textStyle, isSourceMode }) {
  useInterfaceLocale();
  const contextRef = useRef(null);
  const { fontFamily, fontSize, fontWeight, fontStyle, lineHeight } = textStyle;

  useEffect(() => {
    const handleResize = () => autoResize(contextRef.current);
    window.addEventListener('resize', handleResize);
    const timer = setTimeout(handleResize, 100);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => { autoResize(contextRef.current); },
    [isSourceMode, explanation, fontFamily, fontSize, fontWeight, fontStyle, lineHeight]);

  return (
    <section className="visual-card-form-section">
      <label className="visual-card-form-heading" htmlFor="card-editor-context">{tr('Контекст')}</label>
      <div className="visual-card-form-context">
        <textarea id="card-editor-context" ref={contextRef}
          className="context-textarea textarea-preview textarea-context-preview"
          value={explanation || ''}
          onChange={event => {
            const nextExplanation = event.target.value;
            update(card => ({ ...card, explanation: nextExplanation }));
          }}
          onInput={event => autoResize(event.currentTarget)}
          style={{ ...textStyle, overflow: 'hidden', minHeight: '52px' }}
          placeholder={t('creator.context', 'Примеры, грамматика...')} />
      </div>
    </section>
  );
}

export function CardFormDetails({ content, update, backBackground, textStyles, isSourceMode }) {
  const backKey = answerField[content.type];
  return (
    <>
      {backKey && <section className="visual-card-form-section visual-card-form-back">
        <h3 className="visual-card-form-heading">{tr('Обратная сторона')}</h3>
        <div className="study-flashcard visual-card-form-answer">
          <div className="card-inner glass card-back">
            {backBackground}
            <div className="card-face">
              <StudyCardText side="back" style={textStyles.backText}>
                <InlineText block id="card-editor-back" value={content.data[backKey] || ''}
                  label={tr(backLabels[content.type] ?? 'Ответ / обратная сторона')}
                  display={<MarkdownRenderer>{content.data[backKey]}</MarkdownRenderer>}
                  onChange={answer => update(card => ({ ...card, data: { ...card.data, [backKey]: answer } }))} />
              </StudyCardText>
            </div>
          </div>
        </div>
      </section>}
      <CardContextField explanation={content.explanation} update={update}
        textStyle={textStyles.contextText} isSourceMode={isSourceMode} />
    </>
  );
}

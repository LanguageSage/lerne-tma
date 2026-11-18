import React, { useLayoutEffect, useRef } from 'react';
import { Check, Circle, Plus, Trash2 } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { studyQuiz } from '../../utils/structuredStudyCard';
import { QuizContent } from '../study/StudyCardQuiz';
import { InlineText, VisualCardFields } from './VisualCardFields';

export function QuizCardFields({ cardData, update, designConfig, dictation }) {
  const card = cardData.content_v2.card;
  const quiz = studyQuiz(card.data);
  const fields = useRef(null);
  const nextFocus = useRef(null);

  useLayoutEffect(() => {
    if (nextFocus.current) {
      fields.current?.querySelector(nextFocus.current)?.focus();
      nextFocus.current = null;
    }
  }, [card]);

  const updateOptions = change => update(current => ({
    ...current, data: { ...current.data, options: change(current.data.options) },
  }));
  const editOption = (index, patch) => updateOptions(options =>
    options.map((option, i) => i === index ? { ...option, ...patch } : option));
  return <VisualCardFields cardData={cardData} update={update} dictation={dictation}
    exercise={<div ref={fields}>
      <QuizContent options={quiz.options} designConfig={designConfig}
        question={<InlineText id="card-editor-front" value={quiz.question} display={quiz.question} label={tr('Вопрос')}
          onChange={prompt => update(current => ({ ...current, data: { ...current.data, prompt } }))} />}
        renderOptionMarker={option =>
          <button type="button" className="visual-card-icon-control quiz-option-control" aria-pressed={Boolean(option.isCorrect)}
            aria-label={`${tr('Верный ответ')} ${option.id + 1}`} title={tr('Верный ответ')}
            onClick={() => editOption(option.id, { correct: !option.isCorrect })}>
            {option.isCorrect ? <Check size={16} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
          </button>}
        renderOptionText={(option, display) => <InlineText id={`quiz-editor-option-${option.id}`} value={option.text}
          display={display} label={`${tr('Вариант ответа')} ${option.id + 1}`}
          onChange={optionText => editOption(option.id, { text: optionText })} />}
        renderOptionActions={option =>
          <button type="button" className="visual-card-icon-control quiz-option-control"
            aria-label={`${tr('Удалить')} ${tr('Вариант ответа').toLowerCase()} ${option.id + 1}`}
            title={tr('Удалить')} onClick={() => updateOptions(options => options.filter((_, i) => i !== option.id))}>
            <Trash2 size={15} aria-hidden="true" />
          </button>}
        footer={<button type="button" className="visual-card-icon-control quiz-add-option"
          aria-label={tr('Добавить вариант')} title={tr('Добавить вариант')} onClick={() => {
            nextFocus.current = `#quiz-editor-option-${quiz.options.length}`;
            updateOptions(options => [...options, { text: '', correct: false }]);
          }}><Plus size={16} aria-hidden="true" /></button>}
      />
    </div>}
  />;
}

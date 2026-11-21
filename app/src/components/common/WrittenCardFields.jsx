import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { patchGradingPolicy } from '../../utils/cardDraft';
import { EditableTextField, FreeTextHeading, FreeTextPrompt } from '../study/StudyCardFreeText';
import { InlineText, VisualCardFields } from './VisualCardFields';
import './WrittenCardFields.css';

export function FreeTextCardFields({ cardData, update, dictation, textStyles, lockLayout = false, resolveMediaUrl }) {
  const { prompt } = cardData.content_v2.card.data;
  return <VisualCardFields cardData={cardData} update={update} dictation={dictation} lockLayout={lockLayout} resolveMediaUrl={resolveMediaUrl}
    exercise={<FreeTextPrompt style={textStyles.frontText}>
      <InlineText block id="card-editor-front" value={prompt} label={tr('Задание')}
        onChange={text => update(card => ({ ...card, data: { ...card.data, prompt: text } }))} />
    </FreeTextPrompt>}
    footer={<div className="free-text-editor-note"><FreeTextHeading>
      <div className="free-text-editor-note-description">{tr('Образец ответа на обратной стороне.')}</div>
    </FreeTextHeading></div>}
  />;
}

export function EditableTextCardFields({ cardData, update, dictation, textStyles, lockLayout = false, resolveMediaUrl }) {
  const { source_text } = cardData.content_v2.card.data;
  const label = tr('Исходный текст');
  return <VisualCardFields cardData={cardData} update={update} dictation={dictation} lockLayout={lockLayout} resolveMediaUrl={resolveMediaUrl}
    exercise={<EditableTextField inputId="card-editor-front" label={label}>
      <div className="editable-text-editor-input" style={{ ...textStyles.contextText, color: undefined }}>
        <InlineText block id="card-editor-front" value={source_text} label={label}
          onChange={text => update(card => ({ ...card, data: { ...card.data, source_text: text } }))} />
      </div>
    </EditableTextField>}
  />;
}

const modes = { open_text: 'Свободный ответ', controlled_text: 'Ответ по образцу', exact: 'Точное совпадение' };
const rules = {
  typo_tolerance: 'Допускать опечатки',
  semantic_equivalence: 'Принимать ответы с тем же смыслом',
  grammar_requires_retry: 'Просить исправить грамматику',
  case_sensitive: 'Учитывать регистр',
  punctuation_sensitive: 'Учитывать пунктуацию',
};
const attemptLimits = Array.from({ length: 10 }, (_, index) => index + 1);

export function AnswerGradingFields({ card, update }) {
  const { accepted_answers: answers = [], grading_policy: policy } = card.data;
  const freeText = card.type === 'free_text';
  const updateAnswers = change => update(card => ({
    ...card, data: { ...card.data, accepted_answers: change(card.data.accepted_answers ?? []) },
  }));
  const setRule = (name, value) => update(card => patchGradingPolicy(card, name, value));
  const defaultOption = <option value="">{tr('По умолчанию')}</option>;

  return <details className="card-form-secondary answer-grading">
    <summary>{tr('Настройки проверки')}</summary>
    <fieldset className="card-form-text-field">
      <legend>{tr('Допустимые ответы')}</legend>
      {answers.map((answer, index) => <div className="free-text-answer-row" key={index}>
        <textarea className="form-input" rows={2} aria-label={`${tr('Вариант ответа')} ${index + 1}`} value={answer}
          onChange={event => {
            const value = event.target.value;
            updateAnswers(items => items.map((item, position) => position === index ? value : item));
          }} />
        <button type="button" className="visual-card-icon-control" aria-label={`${tr('Удалить вариант')} ${index + 1}`}
          title={tr('Удалить вариант')} onClick={() => updateAnswers(items => items.filter((_, position) => position !== index))}>
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>)}
      <button type="button" className="visual-card-icon-control" aria-label={tr('Добавить вариант')} title={tr('Добавить вариант')}
        disabled={answers.length >= 20} onClick={() => updateAnswers(items => [...items, ''])}>
        <Plus size={16} aria-hidden="true" />
      </button>
    </fieldset>
    <fieldset className="card-form-text-field free-text-rule-grid">
      <legend>{tr('Правила проверки')}</legend>
      <label>{tr('Режим проверки')}
        <select className="form-input" value={policy?.mode ?? (freeText && !policy ? 'open_text' : 'controlled_text')}
          onChange={event => setRule('mode', event.target.value)}>
          {Object.entries(modes).filter(([mode]) => freeText || mode !== 'open_text')
            .map(([mode, label]) => <option key={mode} value={mode}>{tr(label)}</option>)}
        </select>
      </label>
      <label>{tr('Лимит попыток')}
        <select className="form-input" value={policy?.max_retries ?? ''}
          onChange={event => setRule('max_retries', event.target.value ? Number(event.target.value) : undefined)}>
          {defaultOption}
          {attemptLimits.map(limit => <option key={limit} value={limit}>{limit}</option>)}
        </select>
      </label>
      {Object.entries(rules).map(([name, label]) => <label key={name}>{tr(label)}
        <select className="form-input" value={policy?.[name] == null ? '' : String(policy[name])} onChange={event => {
          const value = event.target.value;
          setRule(name, value === '' ? undefined : value === 'true');
        }}>
          {defaultOption}
          <option value="true">{tr('Да')}</option>
          <option value="false">{tr('Нет')}</option>
        </select>
      </label>)}
    </fieldset>
  </details>;
}

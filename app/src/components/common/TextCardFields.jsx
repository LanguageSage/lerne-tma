import React from 'react';
import { tr } from '../../i18n/locale';
import { promptField } from '../../utils/cardDraft';
import { stripMarkdown } from '../../utils/text';
import { KaraokeText } from '../study/KaraokeText';
import { StudyCardText } from '../study/StudyCardText';
import { MarkdownRenderer } from './MarkdownRenderer';
import { InlineText, VisualCardFields } from './VisualCardFields';

export function TextCardFields({ cardData, update, dictation, textStyles }) {
  const { type, data } = cardData.content_v2.card;
  const field = promptField[type];
  const value = data[field];
  const theory = type === 'theory';
  return <VisualCardFields cardData={cardData} update={update} dictation={dictation}
    exercise={<StudyCardText style={textStyles.frontText}>
      <InlineText block id="card-editor-front" value={value} label={tr(theory ? 'Теоретический текст' : 'Вопрос')}
        display={theory ? <MarkdownRenderer>{value}</MarkdownRenderer> : <KaraokeText text={stripMarkdown(value)} />}
        onChange={text => update(card => ({ ...card, data: { ...card.data, [field]: text } }))} />
    </StudyCardText>}
  />;
}

import React from 'react';
import { ExerciseInfoBlocks } from '../study/ExerciseInfoBlocks.jsx';
import { KaraokeText } from '../study/KaraokeText.jsx';
import { cleanBracketSyntax } from '../../utils/clozeParser.js';
import { stripMarkdown } from '../../utils/text.js';
import '../study/StudyCard.css';

/** Ordinary front content shared by study and the author's live preview. */
export function CardFrontContent({ content, textStyle, activeWordIndex = -1, id }) {
  let wordOffset = 0;
  let firstExercise = true;
  return content.blocks.map((block, index) => {
    if (block.type !== 'exercise') return <ExerciseInfoBlocks key={index} blocks={[block]} />;
    const text = cleanBracketSyntax(stripMarkdown(block.content));
    const active = activeWordIndex - wordOffset;
    wordOffset += text.match(/\S+/g)?.length || 0;
    const elementId = firstExercise ? id : undefined;
    firstExercise = false;
    return <div key={index} id={elementId} className="text-front"
      style={{ whiteSpace: 'pre-wrap', ...textStyle }}>
      <KaraokeText text={text} activeWordIndex={active} style={textStyle} />
    </div>;
  });
}

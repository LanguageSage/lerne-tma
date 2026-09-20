import React from 'react';
import { tr } from '../../i18n/locale';

export const ExerciseInfoBlocks = React.memo(({ content }) => {
  const blocks = content?.blocks || [];
  if (blocks.length === 0) return null;

  const exampleCount = blocks.filter(block => block.type === 'example' && block.content).length;

  return (
    <section className="exercise-info-blocks" aria-label={tr('Информация к заданию')}>
      {blocks.map((block, index) => {
        if (!block.content) return null;

        if (block.type === 'options') {
          return (
            <div key={`${block.type}-${index}`} className="exercise-info-block exercise-info-options">
              <div className="exercise-info-label">{tr('Варианты ответа')}</div>
              <div className="exercise-option-chips" role="list" aria-label={tr('Варианты ответа')}>
                {(block.options || []).map((option, optionIndex) => (
                  <span key={`${option}-${optionIndex}`} className="exercise-option-chip" role="listitem">
                    {option}
                  </span>
                ))}
              </div>
            </div>
          );
        }

        const exampleIndex = block.type === 'example'
          ? blocks.slice(0, index + 1).filter(item => item.type === 'example' && item.content).length
          : 0;
        const label = block.type === 'context'
          ? tr('Исходный текст')
          : block.type === 'example'
            ? (exampleCount > 1 ? `${tr('Пример')} ${exampleIndex}` : tr('Пример'))
            : null;

        return (
          <div key={`${block.type}-${index}`} className={`exercise-info-block exercise-info-${block.type}`}>
            {label && <div className="exercise-info-label">{label}</div>}
            <div className="exercise-info-text">{block.content}</div>
          </div>
        );
      })}
    </section>
  );
});

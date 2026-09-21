import React from 'react';
import { tr } from '../../i18n/locale';

export const ExerciseInfoBlocks = React.memo(({ content, blocks: propBlocks }) => {
  const blocks = propBlocks || content?.blocks || [];
  if (blocks.length === 0) return null;

  return (
    <section className="exercise-info-blocks" aria-label={tr('Информация к заданию')}>
      {blocks.map((block, index) => {
        if (!block.content) return null;

        if (block.type === 'options') {
          return (
            <div key={`${block.type}-${index}`} className="exercise-info-block exercise-info-options">
              <div
                className="exercise-option-chips"
                role="list"
                aria-label={tr('Варианты ответа')}
                style={{ gap: 'var(--design-options-chip-gap)' }}
              >
                {(block.options || []).map((option, optionIndex) => (
                  <span
                    key={`${option}-${optionIndex}`}
                    className="exercise-option-chip"
                    role="listitem"
                    style={{
                      fontFamily: 'var(--design-options-chip-font)',
                      fontSize: 'var(--design-options-chip-size)',
                      color: 'var(--design-options-chip-color)',
                      background: 'var(--design-options-chip-bg)',
                      borderColor: 'var(--design-options-chip-border)',
                      borderRadius: 'var(--design-options-chip-radius)',
                      padding: 'var(--design-options-chip-pad)',
                    }}
                  >
                    {option}
                  </span>
                ))}
              </div>
            </div>
          );
        }

        const blockStyle = block.type === 'task'
          ? {
              fontFamily: 'var(--design-task-font)',
              fontSize: 'var(--design-task-font-size)',
              fontWeight: 'var(--design-task-weight)',
              fontStyle: 'var(--design-task-style)',
              color: 'var(--design-task-color)',
              background: 'var(--design-task-bg)',
              borderColor: 'var(--design-task-border)',
              borderRadius: 'var(--design-task-radius)',
              padding: 'var(--design-task-padding)'
            }
          : (block.type === 'source' || block.type === 'context')
          ? {
              fontFamily: 'var(--design-source-font)',
              fontSize: 'var(--design-source-font-size)',
              fontWeight: 'var(--design-source-weight)',
              fontStyle: 'var(--design-source-style)',
              color: 'var(--design-source-color)',
              background: 'var(--design-source-bg)',
              borderColor: 'var(--design-source-border)',
              borderRadius: 'var(--design-source-radius)',
              padding: 'var(--design-source-padding)'
            }
          : block.type === 'example'
          ? {
              fontFamily: 'var(--design-example-font)',
              fontSize: 'var(--design-example-font-size)',
              fontWeight: 'var(--design-example-weight)',
              fontStyle: 'var(--design-example-style)',
              color: 'var(--design-example-color)',
              background: 'var(--design-example-bg)',
              borderColor: 'var(--design-example-border)',
              borderRadius: 'var(--design-example-radius)',
              padding: 'var(--design-example-padding)'
            }
          : {};

        return (
          <div
            key={`${block.type}-${index}`}
            className={`exercise-info-block exercise-info-${block.type}`}
            style={blockStyle}
          >
            <div className="exercise-info-text">{block.content}</div>
          </div>
        );
      })}
    </section>
  );
});

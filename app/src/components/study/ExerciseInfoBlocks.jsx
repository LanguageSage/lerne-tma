import React from 'react';
import { tr } from '../../i18n/locale';
import { MarkdownRenderer } from '../common/MarkdownRenderer';

export const ExerciseInfoBlocks = React.memo(({ content, blocks: propBlocks, markdown = false, renderText }) => {
  const blocks = propBlocks || content?.blocks || [];
  if (blocks.length === 0) return null;

  return (
    <section className="exercise-info-blocks" aria-label={tr('Информация к заданию')}>
      {blocks.map((block, index) => {
        if (block.type !== 'options' && !block.content && !renderText) return null;

        if (block.type === 'options') {
          return (
            <div key={`${block.type}-${index}`} className="exercise-info-block exercise-info-options">
              {block.label && (
                <div
                  className="exercise-options-label"
                  style={{
                    fontFamily: 'var(--design-options-label-font)',
                    fontSize: 'var(--design-options-label-size)',
                    color: 'var(--design-options-label-color)',
                    fontWeight: 'var(--design-options-label-w)',
                    marginBottom: '4px',
                  }}
                >
                  {block.label}
                </div>
              )}
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

        const role = block.type === 'context' ? 'source' : block.type;
        const prefix = `--design-${role}`;
        const blockStyle = ['task', 'source', 'example', 'hint'].includes(role) ? {
          fontFamily: `var(${prefix}-font)`,
          fontSize: `var(${prefix}-font-size)`,
          fontWeight: `var(${prefix}-weight)`,
          fontStyle: `var(${prefix}-style)`,
          color: `var(${prefix}-color)`,
          background: `var(${prefix}-bg)`,
          borderColor: `var(${prefix}-border)`,
          borderRadius: `var(${prefix}-radius)`,
          padding: `var(${prefix}-padding)`,
        } : undefined;

        const display = markdown ? <MarkdownRenderer>{block.content}</MarkdownRenderer> : block.content;
        return (
          <div
            key={`${block.type}-${index}`}
            className={`exercise-info-block exercise-info-${block.type}`}
            style={blockStyle}
          >
            <div className="exercise-info-text">{renderText ? renderText(block.content, display) : display}</div>
          </div>
        );
      })}
    </section>
  );
});

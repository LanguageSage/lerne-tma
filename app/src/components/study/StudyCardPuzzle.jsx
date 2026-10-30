import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Sparkles, RotateCcw, Eye, Check, X } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import { stripMarkdown } from '../../utils/text';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { triggerHaptic } from '../../utils/platform';
import { playSuccessSound, playErrorSound } from '../../utils/audioSynth';
import { getDesignStylesFromV2 } from '../../utils/cardStyles';
import { designConfigToCssVariables } from '../../design/designTokens.js';
import { getInteractiveExerciseContent, parseExerciseContent } from '../../utils/exerciseContentParser.js';
import { evaluatePuzzleOrder, puzzleBoundaryId } from '../../utils/puzzleEvaluation.js';
import { createPuzzleLists, getPuzzleInsertion, movePuzzleToken, puzzleWordDndId } from '../../utils/puzzleDrag.js';
import { useExerciseEvaluation } from '../../hooks/useExerciseEvaluation.js';

const puzzleCollisionDetection = args => {
  const point = args.pointerCoordinates || {
    x: args.collisionRect.left + args.collisionRect.width / 2,
    y: args.collisionRect.top + args.collisionRect.height / 2
  };
  for (const container of args.droppableContainers) {
    const node = container.node.current;
    if (!node) continue;
    const zone = node.getBoundingClientRect();
    if (point.x < zone.left || point.x > zone.right || point.y < zone.top || point.y > zone.bottom) continue;
    const rects = Array.from(node.querySelectorAll('[data-puzzle-token]'))
      .filter(element => Number(element.dataset.puzzleToken) !== args.active.data.current.tokenId)
      .map(element => element.getBoundingClientRect());
    const insertion = getPuzzleInsertion(rects, point, zone);
    return [{ id: container.id, data: {
      droppableContainer: container, value: 1,
      insertion: { ...insertion, destination: container.id, x: insertion.x - zone.left, y: insertion.y - zone.top }
    } }];
  }
  return [];
};

const PuzzleWord = ({ word, selected, disabled, onClick, style, boundary }) => {
  const reduceMotion = useReducedMotion();
  const { setNodeRef, isDragging, attributes, listeners } = useDraggable({ id: puzzleWordDndId(word.id), data: { tokenId: word.id }, disabled });

  return (
    <motion.span
      ref={setNodeRef}
      data-puzzle-token={word.id}
      className={`puzzle-token-with-boundary${isDragging ? ' is-dragging' : ''}`}
      layout={!reduceMotion}
      transition={{ layout: { duration: 0.16 } }}
    >
      {boundary}
      <button
        type="button"
        disabled={disabled}
        data-id={word.id}
        className={selected ? 'puzzle-slot-chip' : 'btn-puzzle-chip'}
        style={style}
        {...attributes}
        {...listeners}
        onClick={onClick}
        aria-label={word.text}
      >{word.text}</button>
    </motion.span>
  );
};

const PuzzleDropZone = ({ id, className, children, style, preview, disabled }) => {
  const { setNodeRef } = useDroppable({ id, disabled });
  const insertion = preview?.destination === id ? preview : null;
  return <div ref={setNodeRef} data-puzzle-zone={id} className={`${className}${insertion ? ' is-drop-target' : ''}`} style={style}>
    {children}
    {insertion && <span className="puzzle-drop-indicator" aria-hidden="true"
      style={{ left: insertion.x, top: insertion.y, height: insertion.height }} />}
  </div>;
};

export const StudyCardPuzzle = React.memo(({
  card,
  isFlipped,
  onTrainerAnswer,
  renderAudioPlayer,
  designConfig,
  savedState,
  onSaveState
}) => {
  useInterfaceLocale();
  const reduceMotion = useReducedMotion();
  const [activeDragId, setActiveDragId] = useState(null);
  const [dropPreview, setDropPreview] = useState(null);
  const [showTranslation, setShowTranslation] = useState(savedState?.showTranslation || false);
  const evaluation = useExerciseEvaluation(savedState?.evaluationState);
  const { completed, result } = evaluation.state;

  const v2Styles = useMemo(() => getDesignStylesFromV2(designConfig), [designConfig]);
  const backCardStyle = v2Styles.backText;
  const designVars = useMemo(() => designConfig ? designConfigToCssVariables(designConfig) : {}, [designConfig]);

  const puzzleData = useMemo(() => {
    if (!card) return null;
    const front = card.front || card.front_text || '';
    const exerciseText = getInteractiveExerciseContent(front, 'puzzle') || parseExerciseContent(front).exercise;
    const rawFront = exerciseText.replace(/^@puzzle\s*/i, '').trim();
    const originalWords = stripMarkdown(rawFront)
      .split(/\s+/)
      .map(w => w.trim())
      .filter(Boolean);

    const cardSeed = (card?.id || 1);
    const prng = (seed) => {
      const x = Math.sin(seed + 1) * 10000;
      return x - Math.floor(x);
    };
    const shuffledWords = originalWords
      .map((w, index) => ({ id: index, text: w, r: prng(cardSeed + index) }))
      .sort((a, b) => a.r - b.r)
      .map(({ id, text }) => ({ id, text }));

    return {
      originalWords,
      targetOrder: originalWords.map((_, index) => index),
      shuffledWords
    };
  }, [card]);

  const [lists, setLists] = useState(() => createPuzzleLists(puzzleData?.shuffledWords || [], savedState));
  const wordById = useMemo(() => new Map(puzzleData?.shuffledWords.map(word => [word.id, word]) || []), [puzzleData]);
  const selectedPuzzles = useMemo(() => lists.answer.map(id => wordById.get(id)).filter(Boolean), [lists.answer, wordById]);
  const availableIds = lists.pool;
  const allWordsPlaced = Boolean(puzzleData && selectedPuzzles.length === puzzleData.originalWords.length);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 140, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  );

  // Only committed moves are saved. A cancelled drag never changes the answer.
  useEffect(() => {
    onSaveState?.({ selectedPuzzles, poolOrder: lists.pool, showTranslation, evaluationState: evaluation.state });
  }, [selectedPuzzles, lists.pool, showTranslation, evaluation.state, onSaveState]);

  const handlePuzzleChipClick = (wordObj, e) => {
    e.stopPropagation();
    if (isFlipped || completed || activeDragId !== null) return;
    evaluation.clearCurrentFeedback();
    setLists(current => movePuzzleToken(current, wordObj.id, 'answer', current.answer.length));
    triggerHaptic('light');
  };

  const handleRemovePuzzleWord = (wordObj, e) => {
    e.stopPropagation();
    if (isFlipped || completed || activeDragId !== null) return;
    evaluation.clearCurrentFeedback();
    setLists(current => movePuzzleToken(current, wordObj.id, 'pool', current.pool.length));
    triggerHaptic('light');
  };

  const handleCheck = () => {
    if (!allWordsPlaced || isFlipped || completed || activeDragId !== null) return;
    const submission = evaluation.check(evaluatePuzzleOrder(puzzleData.targetOrder, selectedPuzzles.map(word => word.id)));
    if (!submission) return;
    if (submission.evidence) {
      playSuccessSound();
      triggerHaptic('success');
      onTrainerAnswer?.(card.id, submission.evidence);
    } else {
      playErrorSound();
      triggerHaptic('error');
    }
  };

  const handleReset = () => {
    if (isFlipped || completed || activeDragId !== null) return;
    setLists(createPuzzleLists(puzzleData.shuffledWords));
    evaluation.clearCurrentFeedback();
    triggerHaptic('light');
  };

  const handleDragStart = event => {
    setActiveDragId(event.active.data.current.tokenId);
  };

  const handleDragMove = event => {
    setDropPreview(event.collisions?.[0]?.data?.insertion || null);
  };

  const handleDragCancel = () => {
    setActiveDragId(null);
    setDropPreview(null);
  };
  const handleDragEnd = event => {
    const insertion = event.collisions?.[0]?.data?.insertion;
    if (insertion && !isFlipped && !completed) {
      setLists(current => movePuzzleToken(current, event.active.data.current.tokenId, insertion.destination, insertion.index));
      evaluation.clearCurrentFeedback();
      triggerHaptic('light');
    }
    handleDragCancel();
  };

  const wordStyle = { ...v2Styles.frontText, color: undefined };


  if (!puzzleData) return null;

  return (
    <div className={`interactive-mode-container puzzle-exercise${completed ? ' is-correct' : result ? ' is-wrong' : ''}`} onClick={e => e.stopPropagation()}>
      {/* Header Instruction */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        color: '#c084fc',
        fontSize: '0.86rem',
        fontWeight: 700,
        marginBottom: '8px'
      }}>
        <Sparkles size={15} />
        <span>{tr("🧩 Соберите предложение по-немецки:")}</span>
      </div>

      {/* Header Actions (Audio) */}
      {renderAudioPlayer && (
        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
          {renderAudioPlayer()}
        </div>
      )}

      {/* Target Translation Prompt */}
      {card.back && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', minWidth: 0, marginBottom: '16px' }}>
          {!showTranslation ? (
            <button
              onClick={() => setShowTranslation(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '12px',
                color: '#cbd5e1',
                fontSize: '0.8rem',
                cursor: 'pointer'
              }}
            >
              <Eye size={14} />
              <span>{tr("Показать перевод")}</span>
            </button>
          ) : (
            <div 
              className="text-back"
              style={{
                ...backCardStyle,
                textAlign: backCardStyle.textAlign,
                width: '100%',
                opacity: 0.95
              }}
            >
              <MarkdownRenderer>{card.back}</MarkdownRenderer>
            </div>
          )}
        </div>
      )}

      <DndContext
        sensors={sensors}
        accessibility={{
          screenReaderInstructions: { draggable: tr('Для перемещения нажмите пробел, используйте стрелки и снова пробел. Escape отменяет перемещение.') },
          announcements: {
            onDragStart: ({ active }) => tr('Перемещение слова «{{word}}».', { word: wordById.get(active.data.current.tokenId)?.text }),
            onDragOver: ({ over }) => over ? tr(over.id === 'answer' ? 'Собранная фраза' : 'Исходные слова') : undefined,
            onDragEnd: ({ over }) => tr(over ? 'Слово перемещено.' : 'Перемещение отменено.'),
            onDragCancel: () => tr('Перемещение отменено.')
          }
        }}
        collisionDetection={puzzleCollisionDetection}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
      {/* Target Slots Container */}
      <PuzzleDropZone
        id="answer"
        preview={dropPreview}
        disabled={isFlipped || completed}
        className="puzzle-target-slots"
      >
        {selectedPuzzles.length === 0 ? (
          <span className="puzzle-placeholder">{tr("Нажимайте слова ниже, чтобы собрать фразу")}</span>
        ) : (
          <>
            {selectedPuzzles.map((w, idx) => {
              const boundary = idx > 0 ? evaluation.part(puzzleBoundaryId(selectedPuzzles[idx - 1].id, w.id)) : null;
              return (
                <PuzzleWord
                  key={w.id}
                  word={w}
                  selected
                  disabled={isFlipped || completed}
                  onClick={e => {
                    e.stopPropagation();
                    handleRemovePuzzleWord(w, e);
                  }}
                  boundary={idx > 0 && <span
                    className={`puzzle-boundary ${boundary ? `is-${boundary.status}` : ''}`}
                    data-part-id={boundary?.id}
                    role={boundary ? 'img' : undefined}
                    aria-hidden={boundary ? undefined : true}
                    aria-label={boundary ? tr(boundary.status === 'incorrect' ? 'Проверь порядок рядом с этим местом.' : 'Верное соседство слов.') : undefined}
                  >{boundary && (boundary.status === 'correct' ? <Check size={14} /> : <X size={14} />)}</span>}
                  style={wordStyle}
                />
              );
            })}
          </>
        )}
      </PuzzleDropZone>

      {result && !completed && <p className="puzzle-feedback-hint" role="status">
        {tr('Проверь порядок возле отмеченных мест.')}
      </p>}

      {/* Shuffled Pool Chips */}
      <PuzzleDropZone id="pool" preview={dropPreview} disabled={isFlipped || completed} className="puzzle-pool-chips">
        {availableIds.map(id => {
          const w = wordById.get(id);
          if (!w) return null;
          return <PuzzleWord
              key={w.id}
              word={w}
              disabled={completed || isFlipped}
              onClick={e => handlePuzzleChipClick(w, e)}
              style={wordStyle}
            />;
        })}
      </PuzzleDropZone>
      {createPortal(<DragOverlay zIndex={100000} dropAnimation={reduceMotion ? null : { duration: 140, easing: 'ease-out' }}>
        {activeDragId !== null && wordById.has(activeDragId) ? <span className="puzzle-drag-overlay" style={{ ...designVars, ...wordStyle }}>{wordById.get(activeDragId).text}</span> : null}
      </DragOverlay>, document.body)}

      <div className="puzzle-actions">
        <button type="button" className="btn puzzle-check-action"
          disabled={!allWordsPlaced || completed || isFlipped || activeDragId !== null}
          onClick={handleCheck}>
          {tr("Проверить ответы")}
        </button>
        {selectedPuzzles.length > 0 && !completed && (
          <button type="button" className="puzzle-reset-action" onClick={handleReset}
            disabled={isFlipped || activeDragId !== null} title={tr("Сбросить")}>
            <RotateCcw size={18} />
          </button>
        )}
      </div>

      </DndContext>
    </div>
  );
});

import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Sparkles, RotateCcw, Eye, Check, X } from 'lucide-react';
import { stripMarkdown } from '../../utils/text';
import { getTextShadow } from '../../utils/style';
import { triggerHaptic } from '../../utils/platform';
import { playSuccessSound, playErrorSound } from '../../utils/audioSynth';
import { getBackCardStyle } from '../../utils/cardStyles';
import { parseExerciseContent } from '../../utils/exerciseContentParser.js';
import { evaluatePuzzleOrder, puzzleBoundaryId } from '../../utils/puzzleEvaluation.js';
import { useExerciseEvaluation } from '../../hooks/useExerciseEvaluation.js';

export const StudyCardPuzzle = React.memo(({
  card,
  isFlipped,
  onTrainerAnswer,
  renderAudioPlayer,
  styles = {},
  savedState,
  onSaveState
}) => {
  useInterfaceLocale();
  const reduceMotion = useReducedMotion();
  const [selectedPuzzles, setSelectedPuzzles] = useState(savedState?.selectedPuzzles || []);
  const [activeDragId, setActiveDragId] = useState(null);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [dragStartPos, setDragStartPos] = useState(null);
  const [dragCurrentPos, setDragCurrentPos] = useState(null);
  const [showTranslation, setShowTranslation] = useState(savedState?.showTranslation || false);
  const evaluation = useExerciseEvaluation(savedState?.evaluationState);
  const { completed, result } = evaluation.state;

  const cachedRectsRef = useRef([]);

  const backCardStyle = useMemo(() => getBackCardStyle(styles), [styles]);

  const {
    cardFont,
    cardTextColor,
    cardFontSize = 1,
    cardFontWeight,
    cardFontStyle,
    cardTextShadow
  } = styles;

  // Sync state to parent for flip preservation
  useEffect(() => {
    onSaveState?.({
      selectedPuzzles,
      showTranslation,
      evaluationState: evaluation.state
    });
  }, [selectedPuzzles, showTranslation, evaluation.state, onSaveState]);

  const puzzleData = useMemo(() => {
    if (!card) return null;
    const exerciseText = parseExerciseContent(card.front || card.front_text || '').exercise;
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

  const allWordsPlaced = Boolean(puzzleData && selectedPuzzles.length === puzzleData.originalWords.length);

  const handlePuzzleChipClick = (wordObj, e) => {
    e.stopPropagation();
    if (isFlipped || completed || selectedPuzzles.some(word => word.id === wordObj.id)) return;
    evaluation.clearCurrentFeedback();
    const updated = [...selectedPuzzles, wordObj];
    setSelectedPuzzles(updated);
    triggerHaptic('light');
  };

  const handleRemovePuzzleWord = (wordObj, index, e) => {
    e.stopPropagation();
    if (isFlipped || completed) return;
    evaluation.clearCurrentFeedback();
    const updated = selectedPuzzles.filter((_, i) => i !== index);
    setSelectedPuzzles(updated);
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
    if (isFlipped || completed) return;
    setSelectedPuzzles([]);
    evaluation.clearCurrentFeedback();
    triggerHaptic('light');
  };


  if (!puzzleData) return null;

  return (
    <div className="interactive-mode-container" onClick={e => e.stopPropagation()}>
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '16px' }}>
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
                textAlign: 'center',
                width: '100%',
                opacity: 0.95
              }}
            >
              {card.back}
            </div>
          )}
        </div>
      )}

      {/* Target Slots Container */}
      <div 
        className="puzzle-target-slots glass"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          width: '100%',
          minHeight: '58px',
          padding: '12px',
          borderRadius: '16px',
          background: completed
            ? 'rgba(34, 197, 94, 0.12)'
            : 'rgba(0, 0, 0, 0.2)',
          border: completed
            ? '1.5px solid #22c55e'
            : '1px solid rgba(255, 255, 255, 0.06)',
          marginBottom: '16px',
          transition: 'all 0.2s ease-in-out'
        }}
      >
        {selectedPuzzles.length === 0 ? (
          <span className="puzzle-placeholder">{tr("Нажимайте слова ниже, чтобы собрать фразу")}</span>
        ) : (
          <>
            {selectedPuzzles.map((w, idx) => {
              const boundary = idx > 0 ? evaluation.part(puzzleBoundaryId(selectedPuzzles[idx - 1].id, w.id)) : null;
              const showIndicator = hoverIndex === idx && activeDragId !== null && activeDragId !== w.id;
              return (
                <React.Fragment key={w.id}>
                  {showIndicator && (
                    <motion.div 
                      layoutId="drop-indicator"
                      className="puzzle-drop-indicator"
                    />
                  )}
                  <span className="puzzle-token-with-boundary">
                    {idx > 0 && <span
                      className={`puzzle-boundary ${boundary ? `is-${boundary.status}` : ''}`}
                      data-part-id={boundary?.id}
                      role={boundary ? 'img' : undefined}
                      aria-hidden={boundary ? undefined : true}
                      aria-label={boundary ? tr(boundary.status === 'incorrect'
                        ? 'Проверь порядок рядом с этим местом.' : 'Верное соседство слов.') : undefined}
                    >
                      {boundary && (boundary.status === 'correct' ? <Check size={14} /> : <X size={14} />)}
                    </span>}
                    <motion.button
                      type="button"
                      disabled={isFlipped || completed}
                      data-id={w.id}
                      layout={!reduceMotion}
                      drag={!isFlipped && !completed}
                      dragSnapToOrigin={true}
                      dragElastic={0}
                      dragMomentum={false}
                      onDragStart={(event, info) => {
                        evaluation.clearCurrentFeedback();
                        setActiveDragId(w.id);
                        const chips = event.target.closest('.puzzle-target-slots').querySelectorAll('.puzzle-slot-chip');
                        cachedRectsRef.current = Array.from(chips).map((el, i) => ({
                          index: i,
                          id: el.getAttribute('data-id'),
                          rect: el.getBoundingClientRect()
                        }));

                        const currentChip = Array.from(chips).find(el => el.getAttribute('data-id') === String(w.id));
                        const cardEl = document.getElementById('tut-study-card');
                        if (currentChip && cardEl) {
                          const rect = currentChip.getBoundingClientRect();
                          const cardRect = cardEl.getBoundingClientRect();
                          setDragStartPos({
                            x: rect.left + rect.width / 2 - cardRect.left,
                            y: rect.top + rect.height / 2 - cardRect.top
                          });
                          setDragCurrentPos({
                            x: info.point.x - cardRect.left,
                            y: info.point.y - cardRect.top
                          });
                        }
                      }}
                      onDrag={(event, info) => {
                        const px = info.point.x;
                        const py = info.point.y;

                        const cardEl = document.getElementById('tut-study-card');
                        if (cardEl) {
                          const cardRect = cardEl.getBoundingClientRect();
                          setDragCurrentPos({
                            x: px - cardRect.left,
                            y: py - cardRect.top
                          });
                        }

                        let closestIdx = null;
                        let minDistance = Infinity;
                        let isRightOfCenter = false;

                        cachedRectsRef.current.forEach(({ index, id, rect }) => {
                          if (id === String(w.id)) return;

                          const cx = rect.left + rect.width / 2;
                          const cy = rect.top + rect.height / 2;

                          const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
                          if (dist < minDistance) {
                            minDistance = dist;
                            closestIdx = index;
                            isRightOfCenter = px > cx;
                          }
                        });

                        if (minDistance < 120 && closestIdx !== null) {
                          setHoverIndex(isRightOfCenter ? closestIdx + 1 : closestIdx);
                        } else {
                          setHoverIndex(null);
                        }
                      }}
                      onDragEnd={() => {
                        if (hoverIndex !== null && hoverIndex !== idx) {
                          evaluation.clearCurrentFeedback();
                          const updated = Array.from(selectedPuzzles);
                          const [removed] = updated.splice(idx, 1);
                          const insertIdx = idx < hoverIndex ? hoverIndex - 1 : hoverIndex;
                          updated.splice(insertIdx, 0, removed);
                          setSelectedPuzzles(updated);
                        }
                        setActiveDragId(null);
                        setHoverIndex(null);
                        setDragStartPos(null);
                        setDragCurrentPos(null);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemovePuzzleWord(w, idx, e);
                      }}
                      className={`puzzle-slot-chip ${activeDragId === w.id ? 'dragging' : ''} ${hoverIndex === idx && activeDragId !== w.id ? 'drag-hover' : ''}`}
                      data-index={idx}
                      style={{
                        fontFamily: cardFont,
                        color: cardTextColor,
                        fontSize: `${cardFontSize}rem`,
                        fontWeight: cardFontWeight,
                        fontStyle: cardFontStyle,
                        textShadow: getTextShadow(cardTextShadow, cardTextColor),
                        display: 'inline-flex',
                        alignItems: 'center',
                        cursor: completed ? 'default' : 'grab',
                        userSelect: 'none',
                        touchAction: 'none'
                      }}
                    >
                      {w.text}
                    </motion.button>
                  </span>
                </React.Fragment>
              );
            })}
            {hoverIndex === selectedPuzzles.length && activeDragId !== null && (
              <motion.div 
                layoutId="drop-indicator"
                className="puzzle-drop-indicator"
              />
            )}
          </>
        )}
      </div>

      {result && !completed && <p className="puzzle-feedback-hint" role="status">
        {tr('Проверь порядок возле отмеченных мест.')}
      </p>}

      {/* Shuffled Pool Chips */}
      <div className="puzzle-pool-chips">
        {puzzleData.shuffledWords.map((w) => {
          const isSelected = selectedPuzzles.some(p => p.id === w.id);
          return (
            <button
              key={w.id}
              type="button"
              data-id={w.id}
              className="btn-puzzle-chip"
              disabled={isSelected || completed || isFlipped}
              onClick={(e) => handlePuzzleChipClick(w, e)}
              style={{
                fontFamily: cardFont,
                color: cardTextColor,
                fontSize: `${cardFontSize}rem`,
                fontWeight: cardFontWeight,
                fontStyle: cardFontStyle,
                textShadow: getTextShadow(cardTextShadow, cardTextColor)
              }}
            >
              {w.text}
            </button>
          );
        })}
      </div>

      {/* Check and Reset Action Buttons */}
      <div style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        maxWidth: '340px',
        margin: '12px auto 4px auto'
      }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!allWordsPlaced || completed || isFlipped || activeDragId !== null}
          onClick={handleCheck}
          style={{
            flex: 1,
            padding: '13px 20px',
            fontWeight: 700,
            borderRadius: '16px',
            fontSize: '1rem',
            cursor: allWordsPlaced ? 'pointer' : 'not-allowed',
            background: allWordsPlaced
              ? (completed
                  ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                  : 'linear-gradient(135deg, #a855f7, #7c3aed)')
              : 'rgba(25, 20, 42, 0.85)',
            color: allWordsPlaced ? '#ffffff' : '#94a3b8',
            boxShadow: allWordsPlaced ? '0 4px 18px rgba(168, 85, 247, 0.45)' : 'none',
            border: allWordsPlaced ? 'none' : '1px solid rgba(168, 85, 247, 0.3)',
            transition: 'all 0.2s ease-in-out'
          }}
        >
          {tr("Проверить ответы")}
        </button>

        {selectedPuzzles.length > 0 && !completed && (
          <button
            type="button"
            onClick={handleReset}
            disabled={isFlipped || activeDragId !== null}
            title={tr("Сбросить")}
            style={{
              padding: '12px 14px',
              borderRadius: '16px',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#ffffff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <RotateCcw size={18} />
          </button>
        )}
      </div>

      {/* Drag Arrow SVG Overlay */}
      {dragStartPos && dragCurrentPos && (
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 9999
          }}
        >
          <defs>
            <filter id="arrow-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#c084fc" />
            </marker>
          </defs>
          <line
            x1={dragStartPos.x}
            y1={dragStartPos.y}
            x2={dragCurrentPos.x}
            y2={dragCurrentPos.y}
            stroke="#c084fc"
            strokeWidth="4"
            strokeDasharray="6 6"
            filter="url(#arrow-glow)"
            markerEnd="url(#arrow)"
          />
        </svg>
      )}
    </div>
  );
});

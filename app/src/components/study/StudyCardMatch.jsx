import { tr } from '../../i18n/locale.js';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale.js';
import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Link2 } from 'lucide-react';
import { getCardStyle, getContextStyle } from '../../utils/cardStyles.js';
import { evaluateMatchPair, matchPartId } from '../../utils/matchEvaluation.js';
import { useExerciseEvaluation } from '../../hooks/useExerciseEvaluation.js';
import { playSuccessSound, playErrorSound } from '../../utils/audioSynth.js';
import { triggerHaptic } from '../../utils/platform.js';

const PAIR_COLORS = [
  { border: '#38bdf8', bg: 'rgba(56, 189, 248, 0.18)', text: '#7dd3fc', tag: 'A' },
  { border: '#a855f7', bg: 'rgba(168, 85, 247, 0.18)', text: '#c084fc', tag: 'B' },
  { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.18)', text: '#fcd34d', tag: 'C' },
  { border: '#ec4899', bg: 'rgba(236, 72, 153, 0.18)', text: '#f472b6', tag: 'D' },
  { border: '#14b8a6', bg: 'rgba(20, 184, 166, 0.18)', text: '#5eead4', tag: 'E' },
  { border: '#6366f1', bg: 'rgba(99, 102, 241, 0.18)', text: '#a5b4fc', tag: 'F' }
];

export const StudyCardMatch = React.memo(({
  card,
  matchData,
  onTrainerAnswer,
  onNextCard,
  renderAudioPlayer,
  styles = {},
  isPureTrainerMode = false,
  savedState,
  onSaveState
}) => {
  useInterfaceLocale();

  const [selectedLeft, setSelectedLeft] = useState(savedState?.selectedLeft ?? null); // pairId
  const [selectedRight, setSelectedRight] = useState(savedState?.selectedRight ?? null); // originalPairId
  const [userMatches, setUserMatches] = useState(savedState?.userMatches || {}); // { [leftPairId]: rightOriginalPairId }
  const [wrongRightId, setWrongRightId] = useState(savedState?.wrongRightId ?? null);
  const evaluation = useExerciseEvaluation(savedState?.evaluationState);
  const isChecked = evaluation.state.completed;
  const cardStyle = useMemo(() => getCardStyle(styles), [styles]);
  const contextStyle = useMemo(() => getContextStyle(styles), [styles]);
  const pairs = useMemo(() => matchData?.pairs || [], [matchData?.pairs]);
  const [shuffledRight] = useState(() => {
    if (savedState?.shuffledRight?.length) return savedState.shuffledRight;
    const cardSeed = Number(card?.id) || 1;
    return pairs.map((pair, index) => {
      const x = Math.sin(cardSeed + index * 7 + 1) * 10000;
      return { originalPairId: pair.id, id: pair.id, text: pair.right, order: x - Math.floor(x) };
    }).sort((a, b) => a.order - b.order);
  });

  useEffect(() => {
    onSaveState?.({ selectedLeft, selectedRight, userMatches, shuffledRight, wrongRightId, evaluationState: evaluation.state });
  }, [selectedLeft, selectedRight, userMatches, shuffledRight, wrongRightId, evaluation.state, onSaveState]);

  if (!card || !matchData || pairs.length < 2) return null;
  const connectedCount = Object.keys(userMatches).length;

  const handlePair = (leftId, rightId) => {
    if (evaluation.isLocked(matchPartId(leftId))) return;
    const attempt = evaluateMatchPair(pairs, userMatches, leftId, rightId);
    if (!attempt) return;
    const submission = evaluation.check(attempt.result, attempt);
    if (!submission) return;
    setSelectedLeft(null);
    setSelectedRight(null);
    if (attempt.interactionCorrect) {
      setUserMatches(previous => ({ ...previous, [leftId]: rightId }));
      setWrongRightId(null);
      triggerHaptic('success');
      if (submission.evidence) {
        playSuccessSound();
        onTrainerAnswer?.(card.id, submission.evidence);
      }
    } else {
      setWrongRightId(rightId);
      playErrorSound();
      triggerHaptic('error');
    }
  };

  const handleLeftClick = leftId => {
    if (evaluation.isLocked(matchPartId(leftId))) return;
    triggerHaptic('light');
    if (selectedRight !== null) handlePair(leftId, selectedRight);
    else setSelectedLeft(previous => previous === leftId ? null : leftId);
  };

  const handleRightClick = rightId => {
    if (isChecked || Object.values(userMatches).includes(rightId)) return;
    triggerHaptic('light');
    if (selectedLeft !== null) handlePair(selectedLeft, rightId);
    else setSelectedRight(previous => previous === rightId ? null : rightId);
  };

  // Mapping from leftId -> index for colors
  const getPairColor = (leftId) => {
    return PAIR_COLORS[leftId % PAIR_COLORS.length];
  };

  return (
    <div
      className="interactive-mode-container"
      onClick={e => e.stopPropagation()}
      style={{
        cursor: 'default',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }}
    >
      {/* Exercise Title / Prompt */}
      <div style={{ marginBottom: '14px', textAlign: 'center', width: '100%' }}>
        <div style={{
          fontSize: '0.9rem',
          fontWeight: 700,
          color: '#c084fc',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          marginBottom: '4px'
        }}>
          <Link2 size={16} />
          <span>{tr("Сопоставьте части предложений:")}</span>
        </div>
        {matchData.prompt && (
          <div style={{ fontSize: '0.85rem', color: '#cbd5e1', ...cardStyle, opacity: 0.9 }}>
            {matchData.prompt}
          </div>
        )}
      </div>

      {renderAudioPlayer && (
        <div style={{ width: '100%', marginBottom: '12px' }}>
          {renderAudioPlayer()}
        </div>
      )}

      {/* Two Columns Grid for Pairs */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '10px',
        width: '100%',
        marginBottom: '16px'
      }}>
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {pairs.map((p) => {
            const isSelected = selectedLeft === p.id;
            const matchedRightId = userMatches[p.id];
            const isMatched = matchedRightId !== undefined;
            const pairColor = isMatched ? getPairColor(p.id) : null;
            const isCorrect = isMatched;
            const feedback = evaluation.part(matchPartId(p.id));
            const isWrong = feedback?.status === 'incorrect';

            let border = '1.5px solid rgba(255, 255, 255, 0.12)';
            let bg = 'rgba(255, 255, 255, 0.05)';
            let textColor = '#f1f5f9';

            if (isCorrect || isWrong) {
              if (isCorrect) {
                border = '2px solid #22c55e';
                bg = 'rgba(34, 197, 94, 0.22)';
                textColor = '#4ade80';
              } else if (isWrong) {
                border = '2px solid #ef4444';
                bg = 'rgba(239, 68, 68, 0.22)';
                textColor = '#f87171';
              }
            } else if (isSelected) {
              border = '2px solid #a855f7';
              bg = 'rgba(168, 85, 247, 0.35)';
              textColor = '#ffffff';
            }

            return (
              <motion.button
                key={`left-${p.id}`}
                type="button"
                whileTap={!isChecked && !isMatched ? { scale: 0.97 } : undefined}
                disabled={isChecked || isMatched}
                onClick={() => handleLeftClick(p.id)}
                aria-pressed={isSelected}
                aria-invalid={isWrong}
                aria-describedby={feedback?.hint ? `match-hint-${p.id}` : undefined}
                data-part-id={matchPartId(p.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  minHeight: '52px',
                  padding: '8px 10px',
                  borderRadius: '12px',
                  border,
                  background: bg,
                  color: textColor,
                  fontSize: '0.86rem',
                  fontWeight: 600,
                  textAlign: 'left',
                  cursor: isChecked || isMatched ? 'default' : 'pointer',
                  position: 'relative',
                  transition: 'all 0.15s ease',
                  ...cardStyle
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                  {isMatched && (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: pairColor.border,
                      color: '#000',
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      flexShrink: 0
                    }}>
                      {p.id + 1}
                    </span>
                  )}
                  <span style={{ flex: 1, wordBreak: 'break-word' }}>{p.left}</span>
                </div>
                {feedback?.hint && <span id={`match-hint-${p.id}`} className="exercise-part-hint" role="status">{tr(feedback.hint)}</span>}
              </motion.button>
            );
          })}
        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {shuffledRight.map((r, i) => {
            const isSelected = selectedRight === r.originalPairId;
            // Find which left item matched this right item
            const matchedLeftKey = Object.keys(userMatches).find(k => userMatches[k] === r.originalPairId);
            const isMatched = matchedLeftKey !== undefined;
            const leftIdNum = isMatched ? parseInt(matchedLeftKey, 10) : null;
            const pairColor = isMatched ? getPairColor(leftIdNum) : null;
            const isCorrect = isMatched;
            const isWrong = wrongRightId === r.originalPairId;

            let border = '1.5px solid rgba(255, 255, 255, 0.12)';
            let bg = 'rgba(255, 255, 255, 0.05)';
            let textColor = '#f1f5f9';

            if (isCorrect || isWrong) {
              if (isCorrect) {
                border = '2px solid #22c55e';
                bg = 'rgba(34, 197, 94, 0.22)';
                textColor = '#4ade80';
              } else if (isWrong) {
                border = '2px solid #ef4444';
                bg = 'rgba(239, 68, 68, 0.22)';
                textColor = '#f87171';
              }
            } else if (isSelected) {
              border = '2px solid #a855f7';
              bg = 'rgba(168, 85, 247, 0.35)';
              textColor = '#ffffff';
            }

            return (
              <motion.button
                key={`right-${r.originalPairId}-${i}`}
                type="button"
                whileTap={!isChecked && !isMatched ? { scale: 0.97 } : undefined}
                disabled={isChecked || isMatched}
                onClick={() => handleRightClick(r.originalPairId)}
                aria-pressed={isSelected}
                aria-invalid={isWrong}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  minHeight: '52px',
                  padding: '8px 10px',
                  borderRadius: '12px',
                  border,
                  background: bg,
                  color: textColor,
                  fontSize: '0.86rem',
                  fontWeight: 600,
                  textAlign: 'left',
                  cursor: isChecked || isMatched ? 'default' : 'pointer',
                  position: 'relative',
                  transition: 'all 0.15s ease',
                  ...contextStyle
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                  {isMatched && (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: pairColor.border,
                      color: '#000',
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      flexShrink: 0
                    }}>
                      {leftIdNum + 1}
                    </span>
                  )}
                  <span style={{ flex: 1, wordBreak: 'break-word' }}>{r.text}</span>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="match-progress" role="status">
        {tr('Соедините пары ({{p0}}/{{p1}})', { p0: connectedCount, p1: pairs.length })}
      </div>
      {isChecked && isPureTrainerMode && (
        <button type="button" className="btn btn-primary" onClick={onNextCard}>
          {tr('Дальше →')}
        </button>
      )}
    </div>
  );
});

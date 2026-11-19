import { tr } from '../../i18n/locale.js';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale.js';
import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Link2 } from 'lucide-react';
import { getDesignStylesFromV2 } from '../../utils/cardStyles.js';
import { evaluateMatchPair, matchPartId } from '../../utils/matchEvaluation.js';
import { useExerciseEvaluation } from '../../hooks/useExerciseEvaluation.js';
import { playSuccessSound, playErrorSound } from '../../utils/audioSynth.js';
import { triggerHaptic } from '../../utils/platform.js';
import './StudyCardMatch.css';

const PAIR_COLORS = ['#38bdf8', '#a855f7', '#f59e0b', '#ec4899', '#14b8a6', '#6366f1'];

export function MatchTile({ as: Element = 'div', side, state, textStyle, pairNumber, hint, children, ...props }) {
  const { color, ...typography } = textStyle;
  return <Element {...props} className={`match-item match-item-${side}`} data-design-state={state}
    style={{ ...typography, '--match-item-normal-color': side === 'right' ? color : undefined }}>
    <span className="match-tile-content">
      {pairNumber != null && <span className="match-pair-number"
        style={{ background: PAIR_COLORS[pairNumber % PAIR_COLORS.length] }}>{pairNumber + 1}</span>}
      <span className="match-tile-text">{children}</span>
    </span>
    {hint}
  </Element>;
}

export const StudyCardMatch = React.memo(({
  card,
  matchData,
  onTrainerAnswer,
  onNextCard,
  renderAudioPlayer,
  designConfig,
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
  const v2Styles = useMemo(() => getDesignStylesFromV2(designConfig), [designConfig]);
  const cardStyle = v2Styles.frontText;
  const contextStyle = v2Styles.matchRightText;
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
    const attempt = evaluateMatchPair(pairs, userMatches, leftId, rightId, { exact: matchData.native });
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

  return (
    <div
      className="interactive-mode-container match-container"
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
        <div className="match-heading" style={{ marginBottom: '4px' }}>
          <Link2 size={16} />
          <span>{tr("Сопоставьте части предложений:")}</span>
        </div>
        {matchData.prompt && (
          <div className="match-prompt" style={{ fontSize: '0.85rem', color: '#cbd5e1', ...cardStyle }}>
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
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
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
            const feedback = evaluation.part(matchPartId(p.id));
            const isWrong = feedback?.status === 'incorrect';

            return (
              <MatchTile as={motion.button} side="left" textStyle={cardStyle}
                state={isMatched ? 'correct' : isWrong ? 'wrong' : isSelected ? 'selected' : isChecked ? 'disabled' : 'normal'}
                key={`left-${p.id}`} type="button" pairNumber={isMatched ? p.id : undefined}
                whileTap={!isChecked && !isMatched ? { scale: 0.97 } : undefined}
                disabled={isChecked || isMatched}
                onClick={() => handleLeftClick(p.id)}
                aria-pressed={isSelected}
                aria-invalid={isWrong}
                aria-describedby={feedback?.hint ? `match-hint-${p.id}` : undefined}
                data-part-id={matchPartId(p.id)}
                hint={feedback?.hint && <span id={`match-hint-${p.id}`} className="exercise-part-hint" role="status">{tr(feedback.hint)}</span>}
              >
                {p.left}
              </MatchTile>
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
            const isWrong = wrongRightId === r.originalPairId;

            return (
              <MatchTile as={motion.button} side="right" textStyle={contextStyle}
                state={isMatched ? 'correct' : isWrong ? 'wrong' : isSelected ? 'selected' : isChecked ? 'disabled' : 'normal'}
                key={`right-${r.originalPairId}-${i}`} type="button" pairNumber={leftIdNum}
                whileTap={!isChecked && !isMatched ? { scale: 0.97 } : undefined}
                disabled={isChecked || isMatched}
                onClick={() => handleRightClick(r.originalPairId)}
                aria-pressed={isSelected}
                aria-invalid={isWrong}
              >
                {r.text}
              </MatchTile>
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

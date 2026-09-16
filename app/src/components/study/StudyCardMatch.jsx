import { tr } from '../../i18n/locale.js';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale.js';
import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Eye, RotateCcw, Link2 } from 'lucide-react';
import { getCardStyle, getContextStyle } from '../../utils/cardStyles.js';
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
  onFlip,
  onTrainerAnswer,
  onNextCard,
  renderAudioPlayer,
  styles = {},
  isPureTrainerMode = false
}) => {
  useInterfaceLocale();

  const [selectedLeft, setSelectedLeft] = useState(null); // pairId
  const [selectedRight, setSelectedRight] = useState(null); // originalPairId
  const [userMatches, setUserMatches] = useState({}); // { [leftPairId]: rightOriginalPairId }
  const [isChecked, setIsChecked] = useState(false);
  const [isFirstTry, setIsFirstTry] = useState(true);

  const cardStyle = useMemo(() => getCardStyle(styles), [styles]);
  const contextStyle = useMemo(() => getContextStyle(styles), [styles]);

  const pairs = useMemo(() => matchData?.pairs || [], [matchData?.pairs]);
  const [shuffledRight, setShuffledRight] = useState([]);

  // Reset and shuffle right options on card change
  useEffect(() => {
    queueMicrotask(() => {
      setSelectedLeft(null);
      setSelectedRight(null);
      setUserMatches({});
      setIsChecked(false);
      setIsFirstTry(true);

      if (pairs.length > 0) {
        const rightList = pairs.map(p => ({
          originalPairId: p.id,
          text: p.right
        }));
        setShuffledRight([...rightList].sort(() => Math.random() - 0.5));
      } else {
        setShuffledRight([]);
      }
    });
  }, [card?.id, pairs]);

  if (!card || !matchData || pairs.length < 2) return null;

  const totalPairs = pairs.length;
  const connectedCount = Object.keys(userMatches).length;
  const allConnected = connectedCount === totalPairs;

  // Handle clicking left item
  const handleLeftClick = (leftId) => {
    if (isChecked) return;
    triggerHaptic('light');

    // If this left item already has a match, unmatch it
    if (userMatches[leftId] !== undefined) {
      const nextMatches = { ...userMatches };
      delete nextMatches[leftId];
      setUserMatches(nextMatches);
      setSelectedLeft(null);
      return;
    }

    // If right item is already selected, connect them
    if (selectedRight !== null) {
      setUserMatches(prev => ({ ...prev, [leftId]: selectedRight }));
      setSelectedRight(null);
      setSelectedLeft(null);
      return;
    }

    // Otherwise toggle selection
    setSelectedLeft(prev => (prev === leftId ? null : leftId));
  };

  // Handle clicking right item
  const handleRightClick = (rightOriginalId) => {
    if (isChecked) return;
    triggerHaptic('light');

    // If this right item is already matched to some left item, unmatch it
    const existingLeftKey = Object.keys(userMatches).find(k => userMatches[k] === rightOriginalId);
    if (existingLeftKey !== undefined) {
      const nextMatches = { ...userMatches };
      delete nextMatches[existingLeftKey];
      setUserMatches(nextMatches);
      setSelectedRight(null);
      return;
    }

    // If left item is already selected, connect them
    if (selectedLeft !== null) {
      setUserMatches(prev => ({ ...prev, [selectedLeft]: rightOriginalId }));
      setSelectedLeft(null);
      setSelectedRight(null);
      return;
    }

    // Otherwise toggle selection
    setSelectedRight(prev => (prev === rightOriginalId ? null : rightOriginalId));
  };

  const handleReset = () => {
    if (isChecked) return;
    setUserMatches({});
    setSelectedLeft(null);
    setSelectedRight(null);
    triggerHaptic('medium');
  };

  const handleCheck = () => {
    if (!allConnected) return;
    setIsChecked(true);

    const allCorrect = pairs.every(p => userMatches[p.id] === p.id);

    if (allCorrect) {
      playSuccessSound();
      triggerHaptic('success');
      onTrainerAnswer?.(card.id, isFirstTry);
    } else {
      playErrorSound();
      setIsFirstTry(false);
      triggerHaptic('error');
      onTrainerAnswer?.(card.id, false);
    }

    if (!isPureTrainerMode && onFlip) {
      setTimeout(() => {
        onFlip(true);
      }, 700);
    }
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
            const isCorrect = isChecked && isMatched && matchedRightId === p.id;
            const isWrong = isChecked && isMatched && matchedRightId !== p.id;

            let border = '1.5px solid rgba(255, 255, 255, 0.12)';
            let bg = 'rgba(255, 255, 255, 0.05)';
            let textColor = '#f1f5f9';

            if (isChecked) {
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
            } else if (isMatched) {
              border = `2px solid ${pairColor.border}`;
              bg = pairColor.bg;
              textColor = '#ffffff';
            }

            return (
              <motion.button
                key={`left-${p.id}`}
                type="button"
                whileTap={!isChecked ? { scale: 0.97 } : undefined}
                disabled={isChecked}
                onClick={() => handleLeftClick(p.id)}
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
                  cursor: isChecked ? 'default' : 'pointer',
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
                      background: isChecked ? (isCorrect ? '#22c55e' : '#ef4444') : pairColor.border,
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
            const isCorrect = isChecked && isMatched && leftIdNum === r.originalPairId;
            const isWrong = isChecked && isMatched && leftIdNum !== r.originalPairId;

            let border = '1.5px solid rgba(255, 255, 255, 0.12)';
            let bg = 'rgba(255, 255, 255, 0.05)';
            let textColor = '#f1f5f9';

            if (isChecked) {
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
            } else if (isMatched) {
              border = `2px solid ${pairColor.border}`;
              bg = pairColor.bg;
              textColor = '#ffffff';
            }

            return (
              <motion.button
                key={`right-${r.originalPairId}-${i}`}
                type="button"
                whileTap={!isChecked ? { scale: 0.97 } : undefined}
                disabled={isChecked}
                onClick={() => handleRightClick(r.originalPairId)}
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
                  cursor: isChecked ? 'default' : 'pointer',
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
                      background: isChecked ? (isCorrect ? '#22c55e' : '#ef4444') : pairColor.border,
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

      {/* When checked with errors, show correct matches list */}
      {isChecked && pairs.some(p => userMatches[p.id] !== p.id) && (
        <div style={{
          width: '100%',
          padding: '10px 14px',
          borderRadius: '12px',
          background: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          marginBottom: '14px',
          fontSize: '0.8rem',
          color: '#fca5a5'
        }}>
          <div style={{ fontWeight: 700, marginBottom: '6px' }}>{tr("Правильные соответствия:")}</div>
          {pairs.map(p => (
            <div key={`corr-${p.id}`} style={{ margin: '3px 0' }}>
              <span style={{ color: '#fff', fontWeight: 600 }}>{p.left}</span>
              {' '}→{' '}
              <span style={{ color: '#4ade80' }}>{p.right}</span>
            </div>
          ))}
        </div>
      )}

      {/* Action Footer */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
        {!isChecked ? (
          <div style={{ display: 'flex', gap: '8px', width: '100%', maxWidth: '340px' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{
                flex: 1,
                padding: '12px 18px',
                fontWeight: 700,
                borderRadius: '16px',
                fontSize: '0.96rem',
                cursor: allConnected ? 'pointer' : 'not-allowed',
                background: allConnected
                  ? 'linear-gradient(135deg, #a855f7, #7c3aed)'
                  : 'rgba(25, 20, 42, 0.85)',
                color: allConnected ? '#ffffff' : '#94a3b8',
                border: allConnected ? 'none' : '1px solid rgba(168, 85, 247, 0.3)',
                transition: 'all 0.2s ease'
              }}
              disabled={!allConnected}
              onClick={handleCheck}
            >
              {allConnected ? tr("Проверить ответы") : tr("Соедините пары ({{p0}}/{{p1}})", { p0: connectedCount, p1: totalPairs })}
            </button>
            {connectedCount > 0 && (
              <button
                type="button"
                onClick={handleReset}
                title={tr("Сбросить")}
                style={{
                  padding: '12px',
                  borderRadius: '16px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#fff',
                  cursor: 'pointer'
                }}
              >
                <RotateCcw size={18} />
              </button>
            )}
          </div>
        ) : isPureTrainerMode ? (
          <button
            className="btn btn-primary"
            style={{
              width: '100%',
              maxWidth: '320px',
              padding: '13px 24px',
              fontWeight: 700,
              borderRadius: '16px',
              fontSize: '1.02rem',
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer'
            }}
            onClick={onNextCard}
          >
            {tr("Дальше →")}
          </button>
        ) : null}

        <button
          type="button"
          style={{
            cursor: 'pointer',
            background: 'rgba(20, 15, 38, 0.85)',
            backdropFilter: 'blur(14px)',
            padding: '9px 16px',
            borderRadius: '14px',
            border: '1.5px solid rgba(168, 85, 247, 0.5)',
            color: '#ffffff',
            fontSize: '0.88rem',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '2px'
          }}
          onClick={() => onFlip?.(true)}
        >
          <Eye size={15} style={{ color: '#c084fc' }} />
          <span>{tr("Показать ответ")}</span>
        </button>
      </div>
    </div>
  );
});

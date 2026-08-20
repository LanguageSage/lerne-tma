import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Eye } from 'lucide-react';
import { stripMarkdown } from '../../utils/text';
import { getTextShadow } from '../../utils/style';
import { triggerHaptic } from '../../utils/platform';

export const StudyCardPuzzle = React.memo(({
  card,
  isFlipped,
  onFlip,
  loading,
  playAudio,
  styles = {}
}) => {
  const [selectedPuzzles, setSelectedPuzzles] = useState([]);
  const [activeDragId, setActiveDragId] = useState(null);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [dragStartPos, setDragStartPos] = useState(null);
  const [dragCurrentPos, setDragCurrentPos] = useState(null);

  const cachedRectsRef = useRef([]);

  const {
    cardFont,
    cardTextColor,
    cardFontSize = 1,
    cardFontWeight,
    cardFontStyle,
    cardTextShadow
  } = styles;

  // Reset state when card changes
  useEffect(() => {
    queueMicrotask(() => {
      setSelectedPuzzles([]);
      setActiveDragId(null);
      setHoverIndex(null);
      setDragStartPos(null);
      setDragCurrentPos(null);
    });
  }, [card?.id]);

  const puzzleData = useMemo(() => {
    if (!card) return null;
    const originalWords = stripMarkdown(card.front)
      .split(/\s+/)
      .map(w => w.trim())
      .filter(Boolean);

    const cleanWords = originalWords.map(w => w.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»]/g, "").toLowerCase());

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
      cleanWords,
      shuffledWords
    };
  }, [card]);

  const handlePuzzleChipClick = (wordObj, e) => {
    e.stopPropagation();
    if (isFlipped) return;

    const updated = [...selectedPuzzles, wordObj];
    setSelectedPuzzles(updated);
    triggerHaptic('light');
  };

  const handleRemovePuzzleWord = (wordObj, index, e) => {
    e.stopPropagation();
    if (isFlipped) return;

    const updated = selectedPuzzles.filter((_, i) => i !== index);
    setSelectedPuzzles(updated);
    triggerHaptic('light');
  };

  // Check correctness when all words are placed
  useEffect(() => {
    if (loading || !puzzleData || selectedPuzzles.length === 0 || isFlipped) return;

    if (selectedPuzzles.length === puzzleData.originalWords.length) {
      const userText = selectedPuzzles.map(w => w.text.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»]/g, "").toLowerCase()).join(' ');
      const targetText = puzzleData.cleanWords.join(' ');

      if (userText === targetText) {
        triggerHaptic('success');
        const timer = setTimeout(() => {
          onFlip(true);
        }, 800);
        return () => clearTimeout(timer);
      } else {
        triggerHaptic('error');
      }
    }
  }, [selectedPuzzles, puzzleData, isFlipped, card.audio_url, playAudio, onFlip, loading]);


  if (!puzzleData) return null;

  return (
    <div className="interactive-mode-container" onClick={e => e.stopPropagation()}>
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
          background: 'rgba(0, 0, 0, 0.2)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          marginBottom: '24px'
        }}
      >
        {selectedPuzzles.length === 0 ? (
          <span className="puzzle-placeholder">Нажимайте слова ниже, чтобы собрать фразу</span>
        ) : (
          <>
            {selectedPuzzles.map((w, idx) => {
              const showIndicator = hoverIndex === idx && activeDragId !== null && activeDragId !== w.id;
              return (
                <React.Fragment key={w.id}>
                  {showIndicator && (
                    <motion.div 
                      layoutId="drop-indicator"
                      className="puzzle-drop-indicator"
                    />
                  )}
                  <motion.span 
                    data-id={w.id}
                    layout
                    drag={!isFlipped}
                    dragSnapToOrigin={true}
                    dragElastic={0}
                    dragMomentum={false}
                    onDragStart={(event, info) => {
                      setActiveDragId(w.id);
                      const chips = document.querySelectorAll('.puzzle-slot-chip');
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
                        if (id === w.id) return;
                        
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
                      cursor: 'grab',
                      userSelect: 'none',
                      touchAction: 'none'
                    }}
                  >
                    {w.text}
                  </motion.span>
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

      {/* Shuffled Pool Chips */}
      <div className="puzzle-pool-chips">
        {puzzleData.shuffledWords.map((w) => {
          const isSelected = selectedPuzzles.some(p => p.id === w.id);
          return (
            <button
              key={w.id}
              className="btn-puzzle-chip"
              disabled={isSelected}
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

      {/* Reveal Answer Button */}
      <button 
        className="btn-interactive-reveal"
        onClick={(e) => {
          e.stopPropagation();
          onFlip(true);
        }}
      >
        <Eye size={18} />
        <span>Показать ответ</span>
      </button>

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

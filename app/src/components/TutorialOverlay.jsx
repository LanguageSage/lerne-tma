import React, { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle, X } from 'lucide-react';
import './TutorialOverlay.css';

export const TutorialOverlay = ({ isOpen, steps, onFinish, onSkip, isFlipped }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [coords, setCoords] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2, r: 0 });

  const step = steps?.[currentStep];
  const isLocked = step?.requireFlipped && !isFlipped;

  const handleNext = useCallback(() => {
    if (isLocked) return;
    if (currentStep < (steps?.length || 0) - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      onFinish();
    }
  }, [currentStep, steps, isLocked, onFinish]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  useEffect(() => {
    if (isOpen) {
      console.log("TutorialOverlay OPENED with steps:", steps);
      setCurrentStep(0);
    }
  }, [isOpen, steps]);

  // Auto-advance when flipped
  useEffect(() => {
    if (isOpen && isFlipped && steps?.[currentStep]?.skipIfFlipped) {
      handleNext();
    }
  }, [isFlipped, currentStep, isOpen, steps, handleNext]);

  useLayoutEffect(() => {
    if (!isOpen || !steps || steps.length === 0 || !steps[currentStep]) {
      return;
    }

    const updateCoords = () => {
      const targetStep = steps[currentStep];
      
      if (targetStep.isWelcome) {
        setCoords({ x: window.innerWidth / 2, y: window.innerHeight / 2, r: 0, isWelcome: true });
        return;
      }

      const element = document.getElementById(targetStep.targetId);

      if (element) {
        // Use instant scroll to avoid coordinate race conditions during smooth animation
        element.scrollIntoView({ behavior: 'auto', block: 'center' });
        
        // Short delay to let the browser update the layout
        setTimeout(() => {
          const rect = element.getBoundingClientRect();
          const padding = targetStep.padding !== undefined ? targetStep.padding : 20; // Default increased from 10 to 20
          
          let r = Math.max(rect.width, rect.height) / 2 + padding;
          // Cap radius to avoid it being too large on big elements
          r = Math.min(r, Math.min(window.innerWidth, window.innerHeight) * 0.3);
          if (r < 30) r = 40;
          
          setCoords({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            r: r,
            isWelcome: false
          });
        }, 50);
      } else {
        setCoords({ x: window.innerWidth / 2, y: window.innerHeight / 2, r: 0, isWelcome: false });
      }
    };

    const timer = setTimeout(updateCoords, 100);
    window.addEventListener('resize', updateCoords);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateCoords);
    };
  }, [isOpen, currentStep, steps, isFlipped]);

  if (!isOpen || !steps || steps.length === 0 || !steps[currentStep]) {
    return null;
  }

  // Smart Tooltip positioning
  const margin = 16;
  const tooltipHeight = 240; 
  
  let finalTop = undefined;
  let finalBottom = undefined;
  let finalY = 0;
  
  if (coords.isWelcome) {
    finalTop = '50%';
    finalY = '-50%';
  } else {
    const spaceBelow = window.innerHeight - (coords.y + coords.r);
    const spaceAbove = coords.y - coords.r;

    if (spaceBelow > tooltipHeight + margin * 2) {
      // Position below the element
      finalTop = Math.max(margin + 60, coords.y + coords.r + margin);
      // Ensure it doesn't exceed window height
      if (finalTop + tooltipHeight > window.innerHeight) {
        finalTop = window.innerHeight - tooltipHeight - margin;
      }
    } else if (spaceAbove > tooltipHeight + margin * 2) {
      // Position above the element
      finalBottom = Math.max(margin, window.innerHeight - (coords.y - coords.r) + margin);
      if (finalBottom + tooltipHeight > window.innerHeight) {
        finalBottom = window.innerHeight - tooltipHeight - margin;
      }
    } else {
      // Fallback: position in middle of available vertical space
      if (coords.y > window.innerHeight / 2) {
        finalTop = margin + 70;
      } else {
        finalBottom = margin + 40;
      }
    }
  }

  const finalLeft = Math.max(160, Math.min(window.innerWidth - 160, coords.x));

  return (
    <div className="tutorial-overlay">
      <motion.div 
        className="tutorial-spotlight"
        initial={false}
        animate={{ 
          background: coords.isWelcome 
            ? 'rgba(0, 0, 0, 0.85)' 
            : `radial-gradient(circle at ${coords.x}px ${coords.y}px, transparent ${Math.min(coords.r, window.innerHeight * 0.4)}px, rgba(0, 0, 0, 0.8) ${Math.min(coords.r, window.innerHeight * 0.4) + 2}px)` 
        }}
        transition={{ type: 'spring', damping: 30, stiffness: 200 }}
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          className={`tutorial-tooltip ${coords.isWelcome ? 'welcome' : ''}`}
          initial={{ opacity: 0, scale: 0.9, x: '-50%', y: finalY }}
          animate={{ 
            opacity: 1, 
            top: finalTop,
            bottom: finalBottom,
            left: finalLeft,
            scale: 1,
            y: finalY
          }}
          exit={{ opacity: 0, scale: 0.9 }}
          style={{ 
            position: 'absolute'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <h3 style={{ margin: 0, fontSize: coords.isWelcome ? '1.3rem' : '1.1rem' }}>{step.title}</h3>
            <button className="tutorial-skip" style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', opacity: 0.6 }} onClick={onSkip}><X size={18} /></button>
          </div>
          <p style={{ whiteSpace: 'pre-line' }}>{step.content}</p>
          
          {isLocked && (
            <div style={{ color: '#fbbf24', fontSize: '0.85rem', marginTop: '8px', fontWeight: 'bold' }}>
              ☝️ Сначала нажми на карточку, чтобы увидеть ответ!
            </div>
          )}

          <div className="tutorial-footer">
            <div className="tutorial-step-dots">
              {steps.map((_, i) => (
                <div key={i} className={`tutorial-dot ${i === currentStep ? 'active' : ''}`} />
              ))}
            </div>
            
            <div style={{ display: 'flex', gap: '8px' }}>
              {currentStep > 0 && (
                <button className="tutorial-btn" onClick={handlePrev}>Назад</button>
              )}
              <button 
                className={`tutorial-btn ${!isLocked ? 'primary' : ''}`} 
                onClick={handleNext}
                style={{ opacity: isLocked ? 0.5 : 1, cursor: isLocked ? 'not-allowed' : 'pointer' }}
              >
                {currentStep === steps.length - 1 ? 'Понятно' : 'Далее'}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export const HelpButton = ({ onClick, title = "Помощь" }) => (
  <button id="tut-help-button" className="help-btn-circle" onClick={(e) => { e.stopPropagation(); onClick(); }} title={title}>
    <HelpCircle size={20} />
  </button>
);

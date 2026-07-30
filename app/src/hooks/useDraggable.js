import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * useDraggable — enables smooth drag-to-move functionality for elements.
 * Supports mouse & touch events with bound constraints.
 */
export const useDraggable = (initialPos = { x: 0, y: 0 }) => {
  const [position, setPosition] = useState(initialPos);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const elementPosStartRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e) => {
    // Ignore interactive elements like buttons, inputs, selects
    if (e.target.closest('button, input, select, a, .audio-player-speed-dropdown, .audio-player-voice-dropdown')) {
      return;
    }
    
    isDraggingRef.current = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    dragStartRef.current = { x: clientX, y: clientY };
    elementPosStartRef.current = { ...position };

    document.body.style.userSelect = 'none';
  }, [position]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingRef.current) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const deltaX = clientX - dragStartRef.current.x;
      const deltaY = clientY - dragStartRef.current.y;

      setPosition({
        x: elementPosStartRef.current.x + deltaX,
        y: elementPosStartRef.current.y + deltaY,
      });
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleMouseMove, { passive: true });
    window.addEventListener('touchend', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, []);

  const resetPosition = useCallback(() => {
    setPosition({ x: 0, y: 0 });
  }, []);

  return {
    position,
    setPosition,
    resetPosition,
    dragProps: {
      onMouseDown: handleMouseDown,
      onTouchStart: handleMouseDown,
      style: {
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        cursor: 'grab',
        touchAction: 'none'
      }
    }
  };
};

import { useLayoutEffect, useRef } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

const verticalOnly = [({ transform }) => ({ ...transform, x: 0 })];
const noBuiltInScroll = { enabled: false, layoutShiftCompensation: false };

function startEdgeScroll(event) {
  if (!(event instanceof PointerEvent)) return;
  const container = event.target.closest('#app-container');
  if (!container) return;

  const { top } = container.getBoundingClientRect();
  const bottom = top + container.clientHeight;
  const edge = Math.min(64, container.clientHeight * 0.12);
  let pointerY = event.clientY;
  let frame = 0;
  let previousTime = 0;

  const scroll = (time) => {
    frame = 0;
    const proximity = pointerY < top + edge ? (pointerY - top - edge) / edge
      : pointerY > bottom - edge ? (pointerY - bottom + edge) / edge : 0;
    if (!proximity) return;

    const elapsed = previousTime ? Math.min(time - previousTime, 32) : 1000 / 60;
    previousTime = time;
    const pixels = Math.max(1, Math.round(Math.min(1, Math.abs(proximity)) * 0.72 * elapsed));
    const before = container.scrollTop;
    container.scrollTop += Math.sign(proximity) * pixels;
    if (container.scrollTop !== before) frame = requestAnimationFrame(scroll);
  };

  const move = (pointer) => {
    if (pointer.pointerId !== event.pointerId) return;
    pointerY = pointer.clientY;
    if (!frame) {
      previousTime = 0;
      frame = requestAnimationFrame(scroll);
    }
  };

  container.ownerDocument.addEventListener('pointermove', move, { passive: true, capture: true });
  return () => {
    container.ownerDocument.removeEventListener('pointermove', move, true);
    cancelAnimationFrame(frame);
  };
}

export function ListDndContext({ children, onDragStart, onDragEnd, onDragCancel }) {
  const cleanup = useRef(null);
  const mounted = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, scrollBehavior: 'auto' })
  );

  // dnd-kit's auto-scroll interval can outlive a context that unmounts mid-drag.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cleanup.current?.();
      cleanup.current = null;
    };
  }, []);

  const stopScroll = () => {
    cleanup.current?.();
    cleanup.current = null;
  };

  return (
    <DndContext
      sensors={sensors}
      autoScroll={noBuiltInScroll}
      modifiers={verticalOnly}
      collisionDetection={closestCenter}
      onDragStart={event => {
        if (!mounted.current) return;
        cleanup.current = startEdgeScroll(event.activatorEvent);
        onDragStart?.(event);
      }}
      onDragEnd={event => {
        stopScroll();
        if (mounted.current) onDragEnd?.(event);
      }}
      onDragCancel={event => {
        stopScroll();
        if (mounted.current) onDragCancel?.(event);
      }}
    >
      {children}
    </DndContext>
  );
}

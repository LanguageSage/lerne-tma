import { useEffect, useLayoutEffect, useRef } from 'react';

const interactive = 'button, a, input, textarea, select, label, [contenteditable]:not([contenteditable="false"]), [draggable="true"], [role="button"], [role="textbox"], [role="listbox"], [role="slider"], [data-study-gesture-ignore], .interactive-mode-container, .study-card-footer, .card-image-wrapper';
const content = '.text-front, .text-back, .text-front-mini, .text-context, .karaoke-text, p, span, h1, h2, h3, h4, pre, code, table, img, svg, audio, video';
const overlays = '[aria-modal="true"], dialog[open], .modal-overlay, .settings-overlay, .image-picker-overlay, .camera-overlay, .tutorial-overlay, .gap-dropdown-backdrop';
const hasSelection = () => Boolean(window.getSelection()?.toString());
const isBlocked = target => target instanceof Element && Boolean(target.closest(interactive));

// Only deliberate strokes from unused card space are commands. Text and exercise
// surfaces retain native selection, scrolling, focus and drag/drop behavior.
export function useStudyCardControls({ surfaceRef, reviewKey, enabled, isFlipped, onFlip, onPrevious, onNext }) {
  const latest = useRef(null);
  useLayoutEffect(() => {
    latest.current = { enabled, isFlipped, onFlip, onPrevious, onNext };
  }, [enabled, isFlipped, onFlip, onPrevious, onNext]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !enabled) return;
    const command = action => {
      const current = latest.current;
      if (!current.enabled || hasSelection() || document.querySelector(overlays)) return;
      if (action === 'toggle') current.onFlip(!current.isFlipped);
      if (action === 'front') current.onFlip(false);
      if (action === 'back') current.onFlip(true);
      if (action === 'previous') current.onPrevious?.();
      if (action === 'next') current.onNext?.();
    };
    let gesture = null;
    const cancel = () => { gesture = null; };
    const available = () => !hasSelection() && !document.querySelector(overlays);
    const start = (target, x, y, kind, time) => {
      cancel();
      if (!available() || !(target instanceof Element) || !surface.contains(target)
        || isBlocked(target) || target.closest(content)
        || [...target.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) return;
      // Nested scroll areas always belong to native scrolling, even at an edge.
      for (let node = target; node && node !== surface; node = node.parentElement) {
        const style = getComputedStyle(node);
        if ((/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight)
          || (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth)) return;
      }
      // Device event time excludes delays in delivering events to a busy UI thread.
      gesture = { x, y, kind, started: time, axis: null };
    };
    const move = (x, y, time) => {
      if (!gesture) return;
      if (!available() || time - gesture.started > 700 || time < gesture.started) return cancel();
      const dx = Math.abs(x - gesture.x);
      const dy = Math.abs(y - gesture.y);
      if (!gesture.axis && Math.max(dx, dy) >= 10) {
        if (dx > dy * 1.5) gesture.axis = 'x';
        else if (dy > dx * 1.5) gesture.axis = 'y';
        else cancel();
      }
    };
    const end = (x, y, time) => {
      move(x, y, time);
      const stroke = gesture;
      cancel();
      if (!stroke || !stroke.axis || time - stroke.started < 60) return;
      const dx = x - stroke.x;
      const dy = y - stroke.y;
      if (stroke.axis === 'x' && Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 1.5) command(dx < 0 ? 'next' : 'previous');
      if (stroke.axis === 'y' && Math.abs(dy) >= 64 && Math.abs(dy) > Math.abs(dx) * 1.5) command(dy < 0 ? 'back' : 'front');
    };
    const mouseDown = event => {
      if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return cancel();
      start(event.target, event.clientX, event.clientY, 'mouse', event.timeStamp);
      // Text origins are excluded above. A background drag should not start a
      // browser selection as it crosses the contents of the card.
      if (gesture) {
        event.preventDefault();
        // Preserve the normal focus release of clicking unused card space.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
    };
    const mouseMove = event => {
      if (gesture?.kind !== 'mouse') return;
      if (event.buttons !== 1) return cancel();
      move(event.clientX, event.clientY, event.timeStamp);
    };
    const mouseUp = event => {
      if (event.button !== 0) return cancel();
      if (gesture?.kind === 'mouse') end(event.clientX, event.clientY, event.timeStamp);
    };
    const touchStart = event => {
      if (event.touches.length !== 1) return cancel();
      const touch = event.touches[0];
      start(event.target, touch.clientX, touch.clientY, touch.identifier, event.timeStamp);
    };
    const touchMove = event => {
      if (!gesture || gesture.kind === 'mouse') return;
      if (event.touches.length !== 1 || event.touches[0].identifier !== gesture.kind) return cancel();
      move(event.touches[0].clientX, event.touches[0].clientY, event.timeStamp);
      // Decide before the browser claims a native pan. This listener is deliberately
      // non-passive, but only consumes a stroke that began on unused card space.
      if (gesture?.axis) {
        if (!event.cancelable) return cancel();
        event.preventDefault();
      }
    };
    const touchEnd = event => {
      if (!gesture || event.touches.length) return cancel();
      const touch = [...event.changedTouches].find(item => item.identifier === gesture.kind);
      if (touch) end(touch.clientX, touch.clientY, event.timeStamp);
      else cancel();
    };
    const keyDown = event => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || isBlocked(event.target) || isBlocked(document.activeElement) || !available()) return;
      const action = { ' ': 'toggle', ArrowLeft: 'previous', ArrowRight: 'next' }[event.key];
      if (!action) return;
      event.preventDefault();
      cancel();
      command(action);
    };
    const listeners = [
      [surface, 'mousedown', mouseDown], [window, 'mousemove', mouseMove], [window, 'mouseup', mouseUp],
      [surface, 'touchstart', touchStart, { passive: true }],
      [window, 'touchstart', event => { if (event.touches.length > 1) cancel(); }, { passive: true }],
      [window, 'touchmove', touchMove, { passive: false }], [window, 'touchend', touchEnd],
      [window, 'touchcancel', cancel], [window, 'blur', cancel], [document, 'visibilitychange', cancel],
      [window, 'scroll', cancel, true], [window, 'wheel', cancel, { passive: true }],
      [document, 'selectionchange', () => { if (hasSelection()) cancel(); }],
      [surface, 'dragstart', cancel], [surface, 'contextmenu', cancel], [window, 'keydown', keyDown],
    ];
    listeners.forEach(([node, type, listener, options]) => node.addEventListener(type, listener, options));
    return () => listeners.forEach(([node, type, listener, options]) => node.removeEventListener(type, listener, options));
  }, [surfaceRef, reviewKey, enabled]);
}

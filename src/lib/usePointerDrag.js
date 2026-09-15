'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
/**
 * Pointer-capture drag (spec §7c): 4 px threshold, Escape cancels, touch-capable
 * (the draggable element MUST set `touch-action: none`, or the browser fires
 * pointercancel after a few px), no library. Usage:
 *   const drag = usePointerDrag({ onMove: ({ dx, dy }) => …, onEnd: ({ dx, dy, cancelled }) => … });
 *   <div onPointerDown={drag.start('move')} {...drag.handlers} style={{ touchAction: 'none' }} />
 * Callbacks are read through a ref so a parent re-render mid-drag never cancels
 * the drag and Escape always reaches the latest onEnd. Unmount mid-drag cancels.
 */
export function usePointerDrag({ onStart, onMove, onEnd, threshold = 4 } = {}) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);
  const cbs = useRef({ onStart, onMove, onEnd, threshold });
  useEffect(() => { cbs.current = { onStart, onMove, onEnd, threshold }; });

  const finish = useCallback((cancelled) => {
    const s = ref.current; if (!s) return;
    ref.current = null;
    try { s.target.releasePointerCapture(s.pointerId); } catch { /* already released */ }
    window.removeEventListener('keydown', s.onKey);
    setDragging(false);
    if (s.active) cbs.current.onEnd?.({ mode: s.mode, dx: s.dx, dy: s.dy, cancelled });
  }, []);

  const start = useCallback((mode) => (e) => {
    if (e.button != null && e.button !== 0) return;
    if (ref.current) finish(true); // a second pointer never orphans the first drag
    const target = e.currentTarget;
    const s = { mode, pointerId: e.pointerId, target, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, active: false, onKey: null };
    s.onKey = (ke) => { if (ke.key === 'Escape') finish(true); };
    ref.current = s;
    try { target.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    window.addEventListener('keydown', s.onKey);
  }, [finish]);

  const onPointerMove = useCallback((e) => {
    const s = ref.current; if (!s || e.pointerId !== s.pointerId) return;
    const cb = cbs.current;
    s.dx = e.clientX - s.x0; s.dy = e.clientY - s.y0;
    if (!s.active) {
      if (Math.abs(s.dx) < cb.threshold && Math.abs(s.dy) < cb.threshold) return;
      s.active = true; setDragging(true); cb.onStart?.({ mode: s.mode });
    }
    cb.onMove?.({ mode: s.mode, dx: s.dx, dy: s.dy });
  }, []);

  const onPointerUp = useCallback(() => finish(false), [finish]);
  const onPointerCancel = useCallback(() => finish(true), [finish]);
  useEffect(() => () => finish(true), [finish]); // unmount mid-drag cancels

  // Spread `handlers` on the element that received onPointerDown.
  return { start, dragging, handlers: { onPointerMove, onPointerUp, onPointerCancel } };
}

'use client';
import { useCallback, useRef, useState } from 'react';
/**
 * Pointer-capture drag (spec §7c): 4 px threshold, Escape cancels, touch-capable,
 * no library. Usage:
 *   const drag = usePointerDrag({ onMove: ({ dx, dy }) => …, onEnd: ({ dx, dy, cancelled }) => … });
 *   <div onPointerDown={drag.start('move')} />   // the string is passed back as `mode`
 */
export function usePointerDrag({ onStart, onMove, onEnd, threshold = 4 } = {}) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);

  const finish = useCallback((cancelled) => {
    const s = ref.current; if (!s) return;
    ref.current = null;
    try { s.target.releasePointerCapture(s.pointerId); } catch { /* already released */ }
    window.removeEventListener('keydown', s.onKey);
    setDragging(false);
    if (s.active) onEnd?.({ mode: s.mode, dx: s.dx, dy: s.dy, cancelled });
  }, [onEnd]);

  const start = useCallback((mode) => (e) => {
    if (e.button != null && e.button !== 0) return;
    const target = e.currentTarget;
    const s = { mode, pointerId: e.pointerId, target, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, active: false, onKey: null };
    s.onKey = (ke) => { if (ke.key === 'Escape') finish(true); };
    ref.current = s;
    try { target.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    window.addEventListener('keydown', s.onKey);
  }, [finish]);

  const onPointerMove = useCallback((e) => {
    const s = ref.current; if (!s || e.pointerId !== s.pointerId) return;
    s.dx = e.clientX - s.x0; s.dy = e.clientY - s.y0;
    if (!s.active) {
      if (Math.abs(s.dx) < threshold && Math.abs(s.dy) < threshold) return;
      s.active = true; setDragging(true); onStart?.({ mode: s.mode });
    }
    onMove?.({ mode: s.mode, dx: s.dx, dy: s.dy });
  }, [onMove, onStart, threshold]);

  const onPointerUp = useCallback(() => finish(false), [finish]);
  const onPointerCancel = useCallback(() => finish(true), [finish]);

  // Spread `handlers` on the element that received onPointerDown.
  return { start, dragging, handlers: { onPointerMove, onPointerUp, onPointerCancel } };
}

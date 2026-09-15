import { test, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePointerDrag } from './usePointerDrag';

const el = () => ({ setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
const ev = (x, y, o = {}) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, currentTarget: o.target, ...o });
const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

function setup(opts = {}) {
  const onStart = vi.fn(), onMove = vi.fn(), onEnd = vi.fn(), target = el();
  const hook = renderHook((p) => usePointerDrag({ onStart, onMove, onEnd, ...p }), { initialProps: opts });
  const down = (x = 100, y = 100, o = {}) => act(() => hook.result.current.start(o.mode || 'move')(ev(x, y, { target, ...o })));
  const move = (x, y, o = {}) => act(() => hook.result.current.handlers.onPointerMove(ev(x, y, { target, ...o })));
  const up = () => act(() => hook.result.current.handlers.onPointerUp(ev(0, 0, { target })));
  const cancel = () => act(() => hook.result.current.handlers.onPointerCancel(ev(0, 0, { target })));
  return { ...hook, onStart, onMove, onEnd, target, down, move, up, cancel };
}

test('2 px move ignored; 6 px starts+moves; pointerup ends cancelled=false', () => {
  const t = setup();
  t.down(100, 100);
  expect(t.target.setPointerCapture).toHaveBeenCalledWith(1);
  t.move(102, 100);
  expect(t.onStart).not.toHaveBeenCalled(); expect(t.onMove).not.toHaveBeenCalled(); expect(t.result.current.dragging).toBe(false);
  t.move(106, 100);
  expect(t.onStart).toHaveBeenCalledWith({ mode: 'move' });
  expect(t.onMove).toHaveBeenLastCalledWith({ mode: 'move', dx: 6, dy: 0 });
  expect(t.result.current.dragging).toBe(true);
  t.up();
  expect(t.onEnd).toHaveBeenCalledWith({ mode: 'move', dx: 6, dy: 0, cancelled: false });
  expect(t.result.current.dragging).toBe(false);
  expect(t.target.releasePointerCapture).toHaveBeenCalledWith(1);
});

test('click without movement: no onStart/onEnd, dragging stays false', () => {
  const t = setup();
  t.down(); t.up();
  expect(t.onStart).not.toHaveBeenCalled(); expect(t.onEnd).not.toHaveBeenCalled(); expect(t.result.current.dragging).toBe(false);
});

test('Escape mid-drag cancels; later pointerup and Escape are no-ops', () => {
  const t = setup();
  t.down(100, 100); t.move(110, 100);
  act(() => { escape(); });
  expect(t.onEnd).toHaveBeenCalledTimes(1);
  expect(t.onEnd).toHaveBeenCalledWith({ mode: 'move', dx: 10, dy: 0, cancelled: true });
  expect(t.result.current.dragging).toBe(false);
  t.up(); act(() => { escape(); });
  expect(t.onEnd).toHaveBeenCalledTimes(1);
});

test('button 2 ignored; undefined button + touch allowed; mode passes through', () => {
  const t = setup();
  t.down(0, 0, { button: 2 }); t.move(50, 50);
  expect(t.onStart).not.toHaveBeenCalled();
  t.down(0, 0, { button: undefined, pointerType: 'touch', mode: 'resize' }); t.move(50, 50);
  expect(t.onStart).toHaveBeenCalledWith({ mode: 'resize' });
  t.up();
  expect(t.onEnd).toHaveBeenCalledWith({ mode: 'resize', dx: 50, dy: 50, cancelled: false });
});

test('pointercancel -> cancelled=true; foreign pointerId ignored; custom threshold honoured', () => {
  const t = setup({ threshold: 10 });
  t.down(0, 0);
  t.move(50, 50, { pointerId: 2 }); expect(t.onStart).not.toHaveBeenCalled();
  t.move(9, 9); expect(t.onStart).not.toHaveBeenCalled();
  t.move(10, 0); expect(t.onStart).toHaveBeenCalledTimes(1);
  t.cancel();
  expect(t.onEnd).toHaveBeenCalledWith({ mode: 'move', dx: 10, dy: 0, cancelled: true });
});

test('unmount mid-drag ends the drag and removes the window listener', () => {
  const t = setup();
  t.down(0, 0); t.move(20, 0);
  t.unmount();
  expect(t.onEnd).toHaveBeenCalledWith({ mode: 'move', dx: 20, dy: 0, cancelled: true });
  act(() => { escape(); });
  expect(t.onEnd).toHaveBeenCalledTimes(1);
  expect(t.target.releasePointerCapture).toHaveBeenCalledTimes(1);
});

test('parent re-render with a new onEnd mid-drag: drag survives, Escape uses the LATEST onEnd', () => {
  const target = el(); const first = vi.fn(); const second = vi.fn();
  const hook = renderHook(({ onEnd }) => usePointerDrag({ onEnd }), { initialProps: { onEnd: first } });
  act(() => hook.result.current.start('move')(ev(0, 0, { target })));
  act(() => hook.result.current.handlers.onPointerMove(ev(10, 0, { target })));
  hook.rerender({ onEnd: second });
  expect(first).not.toHaveBeenCalled(); expect(hook.result.current.dragging).toBe(true);
  act(() => { escape(); });
  expect(second).toHaveBeenCalledTimes(1); expect(first).not.toHaveBeenCalled();
});

test('second pointerdown mid-drag cancels the first instead of orphaning it', () => {
  const t = setup();
  t.down(0, 0); t.move(20, 0);
  t.down(0, 0, { pointerId: 7 });
  expect(t.onEnd).toHaveBeenCalledTimes(1);
  expect(t.target.releasePointerCapture).toHaveBeenCalledTimes(1);
});

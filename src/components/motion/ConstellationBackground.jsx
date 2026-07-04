// src/components/motion/ConstellationBackground.jsx
'use client';
import { useEffect, useRef } from 'react';
import { useIsDark } from '@/lib/useIsDark';

// Ported from the R&J motion-system ember-constellation effect: drifting
// particles linked by filament lines that gather toward the cursor. Recolored
// to PRIM violet/indigo, theme-aware (glow in dark, flat lines in light),
// transparent canvas (draws only particles over PRIM's real bg), behind all
// content (-z-10). Perf-hardened: particle cap + pause when tab hidden +
// reduced-motion / small-screen / coarse-pointer gate.
//
// STACKING REQUIREMENT: the nearest positioned ancestor MUST create a
// stacking context (add Tailwind `isolate`), otherwise this -z-10 layer
// joins the ROOT stacking context and the ancestor's own opaque background
// paints OVER it — the effect renders zero visible pixels. With `isolate`
// on the parent, the canvas paints above the parent's background but below
// all of its content, which is the intent.
//
// intensity: 'prominent' (login) | 'medium' (app-wide).
const PRESETS = {
  prominent: { density: 9000,  maxPts: 140, link: 130, dotAlpha: 0.90, lineAlpha: 0.55, opacity: 1.0 },
  medium:    { density: 12000, maxPts: 90,  link: 115, dotAlpha: 0.70, lineAlpha: 0.40, opacity: 0.6 },
};

export default function ConstellationBackground({ intensity = 'medium' }) {
  const canvasRef = useRef(null);
  const isDark = useIsDark();

  useEffect(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia;
    const reduce = mq && mq('(prefers-reduced-motion: reduce)').matches;
    const fine   = mq && mq('(pointer: fine)').matches;
    if (reduce || !fine || window.innerWidth < 900) return; // static bg shows

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cfg = PRESETS[intensity] || PRESETS.medium;
    const pal = isDark
      ? { line: '99,102,241',  dot: '139,92,246', hot: '167,139,250', glow: true }
      : { line: '99,102,241',  dot: '99,102,241', hot: '79,70,229',   glow: false };

    let W = 0, H = 0, pts = [], raf = 0, alive = true;
    const mouse = { x: -1e4, y: -1e4 };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = r.width || window.innerWidth; H = r.height || window.innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(cfg.maxPts, Math.max(14, Math.round((W * H) / cfg.density)));
      pts = [];
      for (let i = 0; i < n; i++) pts.push({ x: Math.random()*W, y: Math.random()*H, vx: (Math.random()-.5)*.35, vy: (Math.random()-.5)*.35 });
    };
    const frame = () => {
      ctx.clearRect(0, 0, W, H); // transparent — NO background fill
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]; p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
        const md = Math.hypot(p.x - mouse.x, p.y - mouse.y);
        if (md < 130) { p.vx += (mouse.x - p.x) / md * 0.02; p.vy += (mouse.y - p.y) / md * 0.02; }
        p.vx = Math.max(-.8, Math.min(.8, p.vx)); p.vy = Math.max(-.8, Math.min(.8, p.vy));
      }
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < cfg.link) {
          const al = (1 - d / cfg.link) * cfg.lineAlpha;
          ctx.strokeStyle = `rgba(${pal.line},${al.toFixed(3)})`;
          ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i], near = Math.hypot(q.x - mouse.x, q.y - mouse.y) < 120;
        ctx.beginPath(); ctx.arc(q.x, q.y, near ? 2.8 : 1.7, 0, 7);
        if (pal.glow) { ctx.shadowColor = `rgb(${near ? pal.hot : pal.dot})`; ctx.shadowBlur = near ? 12 : 6; }
        ctx.fillStyle = `rgba(${near ? pal.hot : pal.dot},${near ? 0.95 : cfg.dotAlpha})`; ctx.fill();
      }
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(frame);
    };
    const onMove = (e) => { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; };
    const onLeave = () => { mouse.x = -1e4; mouse.y = -1e4; };
    const onVis = () => {
      if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
      else if (!raf && alive) { raf = requestAnimationFrame(frame); }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('resize', resize);
    document.addEventListener('mouseleave', onLeave);
    document.addEventListener('visibilitychange', onVis);
    resize(); frame();

    return () => {
      alive = false; cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('resize', resize);
      document.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [intensity, isDark]);

  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden pointer-events-none"
         style={{ opacity: (PRESETS[intensity] || PRESETS.medium).opacity }}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}

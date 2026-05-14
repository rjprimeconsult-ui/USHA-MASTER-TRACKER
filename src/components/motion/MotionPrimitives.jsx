'use client';
/**
 * Reusable motion primitives — Framer Motion wrappers tuned for "luxurious"
 * SaaS feel. Springs over linear easings, subtle scale + opacity, no chaos.
 *
 *  - <FadeIn>           — fade + slight rise on mount
 *  - <Stagger>          — children fade in one after another
 *  - <TiltCard>         — 3D mouse-tracking tilt with smooth spring
 *  - <CountUp>           — animated number ticker for KPI changes
 *  - <Pie3D>            — Excel-style extruded pie/donut with depth wall
 *  - fireConfetti()      — celebration burst (canvas-confetti)
 */
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useIsDark } from '@/lib/useIsDark';

// Darken a hex color by N (0-255) for the side-wall layer of the 3D pie.
function darken(hex, amt = 40) {
  if (!hex || typeof hex !== 'string') return '#666';
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const num = parseInt(full, 16);
  let r = Math.max(0, ((num >> 16) & 0xff) - amt);
  let g = Math.max(0, ((num >> 8)  & 0xff) - amt);
  let b = Math.max(0,  (num        & 0xff) - amt);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// ---------- FadeIn ----------
export function FadeIn({ children, delay = 0, y = 8, duration = 0.45, className = '', ...rest }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

// ---------- Stagger ----------
const STAGGER_PARENT = {
  hidden: { opacity: 1 },
  show: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};
const STAGGER_CHILD = {
  hidden: { opacity: 0, y: 10 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

export function Stagger({ children, className = '' }) {
  return (
    <motion.div variants={STAGGER_PARENT} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  );
}
export function StaggerItem({ children, className = '' }) {
  return (
    <motion.div variants={STAGGER_CHILD} className={className}>
      {children}
    </motion.div>
  );
}

// ---------- TiltCard (3D mouse-tracking) ----------
export function TiltCard({ children, className = '', maxTilt = 6, scale = 1.02, ...rest }) {
  const ref = useRef(null);
  const x = useMotionValue(0); // -0.5 .. 0.5
  const y = useMotionValue(0);

  const rotateX = useSpring(useTransform(y, v => -v * maxTilt), { stiffness: 200, damping: 18 });
  const rotateY = useSpring(useTransform(x, v =>  v * maxTilt), { stiffness: 200, damping: 18 });

  const onMove = (e) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    x.set((e.clientX - rect.left) / rect.width  - 0.5);
    y.set((e.clientY - rect.top)  / rect.height - 0.5);
  };
  const onLeave = () => { x.set(0); y.set(0); };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      whileHover={{ scale }}
      style={{ rotateX, rotateY, transformStyle: 'preserve-3d', transformPerspective: 800 }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

// ---------- CountUp ----------
// Animates from previous value to current value when `value` changes.
// `format` lets you keep currency / decimal formatting.
export function CountUp({ value = 0, format = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }), duration = 0.9, className = '' }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const start = prev.current;
    const end = Number(value) || 0;
    const startTs = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - startTs) / (duration * 1000));
      // ease-out-expo
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const v = start + (end - start) * eased;
      setDisplay(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    prev.current = end;
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={className}>{format(display)}</span>;
}

// ---------- Chart3DCard ----------
// Wraps recharts/chart bodies in a tilted, lit-up card with depth.
// Tilt is small (3°) so the chart's tooltip mouse-tracking stays accurate.
export function Chart3DCard({ children, className = '', titleZ = 12, fadeIn = true }) {
  const card = (
    <TiltCard
      className={`relative bg-white rounded-xl border border-slate-200 p-4 shine-on-hover glow-ring overflow-hidden cursor-default ${className}`}
      maxTilt={3}
      scale={1}
    >
      {/* Subtle radial gradient to give the card depth */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{
          background: 'radial-gradient(ellipse at top right, rgba(99,102,241,0.06), transparent 60%), radial-gradient(ellipse at bottom left, rgba(139,92,246,0.05), transparent 60%)',
        }}
      />
      <div className="relative" style={{ transform: `translateZ(${titleZ}px)` }}>
        {children}
      </div>
    </TiltCard>
  );
  return fadeIn ? <FadeIn>{card}</FadeIn> : card;
}

// ---------- Pie3D ----------
// Excel-style extruded pie/donut. Two stacked pies (a darker offset back layer
// for the side wall + the bright top layer) inside a perspective-rotated frame.
// Tooltip + animations come from recharts as usual.
//
// Props:
//   data, dataKey, nameKey   — passed straight through to <Pie>
//   innerRadius, outerRadius — donut hole + outer (px or % string)
//   height                   — px height of the container
//   tilt                     — degrees of rotateX (default 50)
//   depth                    — px the back layer is offset down (default 14)
//   animationDuration        — ms for the top pie growth animation
//   tooltipFormatter         — passed to <Tooltip formatter={...}>
//   labelKey                 — set to the same key as dataKey to render center labels
export function Pie3D({
  data = [],
  dataKey = 'value',
  nameKey = 'name',
  innerRadius = 0,
  outerRadius = 70,
  height = 240,
  tilt = 45,
  depth = 12,
  animationDuration = 900,
  tooltipFormatter,
  className = '',
  showLabels = false,           // render value labels at end of leader lines
  labelFormat,                  // optional formatter (item) => string
  fontSize = 13,                // 1-2px bigger than default
  insideThreshold = 2,          // 0..1 — set < 1 to put very large slices inside instead of outside
  labelOffset = 22,             // px outside the outer radius for the label
}) {
  const isDark = useIsDark();
  // All values rendered at the end of a leader line (matching the user's "1 → Pending" example).
  // Inside-slice labels can still be enabled by lowering insideThreshold.
  const renderLabel = (props) => {
    const { cx, cy, midAngle, innerRadius: iR, outerRadius: oR, value, name, percent } = props;
    const RADIAN = Math.PI / 180;
    const text = labelFormat ? labelFormat({ value, name, percent }) : String(value);

    if (percent >= insideThreshold) {
      const r = iR + (oR - iR) * 0.6;
      const x = cx + r * Math.cos(-midAngle * RADIAN);
      const y = cy + r * Math.sin(-midAngle * RADIAN);
      return (
        <text
          x={x} y={y}
          fill="#ffffff"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize + 1}
          fontWeight={700}
          style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.4)', strokeWidth: 3, strokeLinejoin: 'round' }}
        >
          {text}
        </text>
      );
    }
    const r = oR + labelOffset;
    const x = cx + r * Math.cos(-midAngle * RADIAN);
    const y = cy + r * Math.sin(-midAngle * RADIAN);
    return (
      <text
        x={x} y={y}
        fill={isDark ? '#E2E8F0' : '#0f172a'}
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize={fontSize}
        fontWeight={700}
      >
        {text}
      </text>
    );
  };

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        height,
        perspective: '1200px',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `rotateX(${tilt}deg)`,
          transformStyle: 'preserve-3d',
        }}
      >
        {/* Back layer: single darkened pie offset down — the "side wall" */}
        <div style={{ position: 'absolute', inset: 0, transform: `translateY(${depth}px)` }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey={dataKey}
                nameKey={nameKey}
                cx="50%"
                cy="50%"
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                isAnimationActive={false}
                stroke="none"
              >
                {data.map((d, i) => (
                  <Cell key={i} fill={darken(d.color, 65)} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Top layer: bright crisp pie, sharp drop shadow only on this layer */}
        <div style={{ position: 'absolute', inset: 0, filter: 'drop-shadow(0 5px 3px rgba(15, 23, 42, 0.22))' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey={dataKey}
                nameKey={nameKey}
                cx="50%"
                cy="50%"
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                animationDuration={animationDuration}
                stroke="#ffffff"
                strokeWidth={2}
                label={showLabels ? renderLabel : undefined}
                labelLine={showLabels ? { stroke: '#64748b', strokeWidth: 1.25 } : false}
              >
                {data.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Pie>
              <Tooltip formatter={tooltipFormatter} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ---------- OrbBackdrop ----------
// Floating gradient orbs that drift behind page content for a subtle Stripe/Linear feel.
// Sits below all content via -z-10. Pointer events disabled so it never blocks clicks.
export function OrbBackdrop() {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <div
        className="orb"
        style={{
          width: '520px', height: '520px',
          top: '-120px', left: '-120px',
          background: 'radial-gradient(circle, rgba(99,102,241,0.55), transparent 70%)',
          animationDelay: '0s',
        }}
      />
      <div
        className="orb"
        style={{
          width: '600px', height: '600px',
          bottom: '-180px', right: '-160px',
          background: 'radial-gradient(circle, rgba(139,92,246,0.45), transparent 70%)',
          animationDelay: '-6s',
        }}
      />
      <div
        className="orb"
        style={{
          width: '420px', height: '420px',
          top: '38%', left: '52%',
          background: 'radial-gradient(circle, rgba(16,185,129,0.32), transparent 70%)',
          animationDelay: '-11s',
          opacity: 0.55,
        }}
      />
      <div
        className="orb"
        style={{
          width: '360px', height: '360px',
          top: '60%', left: '5%',
          background: 'radial-gradient(circle, rgba(244,114,182,0.30), transparent 70%)',
          animationDelay: '-3s',
          opacity: 0.5,
        }}
      />
    </div>
  );
}

// ---------- GlassModal ----------
// Wraps modal content in a frosted-glass container with backdrop blur of the page behind.
// Used by all modal dialogs for consistent "luxe" feel.
export function GlassModal({ open, onClose, children, maxWidth = 'max-w-2xl', className = '' }) {
  if (!open) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className={`${maxWidth} w-full bg-white/85 backdrop-blur-2xl border border-white/60 shadow-2xl shadow-indigo-500/10 rounded-2xl ${className}`}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

// ---------- MoneyCell ----------
// Inline-editable currency cell. Displays formatted "$1,000.00" when idle so
// users see they're looking at money. Switches to a raw string while editing
// so the user can freely type "17." (decimal point) without it being stripped
// out by Number() conversion mid-keystroke. Calls onChange with the parsed
// number on blur (and live during typing for keystroke-by-keystroke updates).
export function MoneyCell({ value, onChange, className = '', width = 'w-28', placeholder = '$0.00', disabled = false }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const num = Number(value || 0);

  // What's displayed: while focused, the raw draft string (preserves "17." mid-typing).
  // While idle, the formatted currency display.
  const display = focused
    ? draft
    : '$' + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleFocus = (e) => {
    // Initialize draft from the current numeric value (or empty if 0)
    setDraft(num === 0 ? '' : String(num));
    setFocused(true);
    // select after state flush
    requestAnimationFrame(() => { try { e.target.select(); } catch {} });
  };

  const handleChange = (e) => {
    // Allow only digits, decimal point, and leading minus
    const cleaned = e.target.value.replace(/[^0-9.\-]/g, '');
    // Disallow more than one decimal point
    const firstDot = cleaned.indexOf('.');
    const sanitized = firstDot === -1
      ? cleaned
      : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    setDraft(sanitized);
    // Push the parsed number live so dependent UI updates as you type
    const parsed = sanitized === '' || sanitized === '.' || sanitized === '-' ? 0 : Number(sanitized);
    onChange(Number.isFinite(parsed) ? parsed : 0);
  };

  const handleBlur = () => {
    setFocused(false);
    // Final commit: re-parse and push (covers edge cases like "17." → 17)
    const parsed = draft === '' || draft === '.' || draft === '-' ? 0 : Number(draft);
    onChange(Number.isFinite(parsed) ? parsed : 0);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      placeholder={placeholder}
      onFocus={disabled ? undefined : handleFocus}
      onBlur={disabled ? undefined : handleBlur}
      onChange={disabled ? undefined : handleChange}
      readOnly={disabled}
      className={`${width} text-right border border-slate-200 ${disabled ? 'text-slate-400 cursor-not-allowed bg-slate-50' : 'hover:border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'} rounded px-2 py-1 text-sm font-semibold bg-white outline-none transition ${className}`}
    />
  );
}

// ---------- Confetti ----------
let confettiFn = null;
export async function fireConfetti(opts = {}) {
  if (typeof window === 'undefined') return;
  if (!confettiFn) {
    const mod = await import('canvas-confetti');
    confettiFn = mod.default;
  }
  confettiFn({
    particleCount: 90,
    spread: 70,
    startVelocity: 35,
    origin: { y: 0.7 },
    colors: ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'],
    ...opts,
  });
}

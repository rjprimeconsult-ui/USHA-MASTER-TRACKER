'use client';
/**
 * PRIM Landing Page — public marketing surface.
 *
 * Reached at /landing. Phase 1: hero + stats strip + feature card-stack
 * scroll + how-it-works + pricing teaser + FAQ + footer. CSS mockups
 * (no real screenshots) for the dashboard imagery — they look pixel-
 * perfect and scale to any device.
 *
 * Once we're happy with the design, Phase 3 replaces the existing
 * home page route so primtracker.com IS this landing page for
 * unauthenticated visitors.
 */
import { useRef, useState } from 'react';
import { motion, useScroll, useTransform, useInView } from 'framer-motion';
import {
  Sparkles, BarChart3, Mail, Calculator, Users, Upload, Brain,
  Check, ChevronDown, ArrowRight, Zap, Lock, Star, DollarSign,
  LineChart, FileText, Phone, Calendar, TrendingUp, Award, Play,
  Volume2, VolumeX,
} from 'lucide-react';
import { PrimMark } from '@/components/PrimLogo';

// ----------------------------------------------------------------
// Brand tokens — matched to PRIM's app accent palette so the
// marketing site and product feel like the same brand.
// ----------------------------------------------------------------
// Single committed accent. Flip ACCENT_KEY to preview the alternative.
const ACCENTS = {
  indigo: { base: '#6366F1', deep: '#4F46E5', soft: '#A5B4FC', glow: '99,102,241' },
  cyan:   { base: '#06B6D4', deep: '#0891B2', soft: '#67E8F9', glow: '6,182,212' },
};
const ACCENT_KEY = 'indigo'; // ← swap to 'cyan' to preview the other accent
const A = ACCENTS[ACCENT_KEY];

const BRAND = {
  bg: '#070B17',
  surface: '#0F1730',
  surfaceRaise: '#1A2447',
  border: `rgba(${A.glow},0.18)`,
  borderStrong: `rgba(${A.glow},0.35)`,
  textPrimary: '#F1F5F9',
  textMuted: '#94A3B8',
  textDim: '#64748B',
  accent: A.base,
  accent2: A.deep,     // was violet — now a deeper shade of the single accent
  accent3: A.base,     // was pink — collapsed to the single accent (no rainbow)
  accentSoft: A.soft,  // light tint for chips/labels (was hardcoded #A5B4FC)
  glow: A.glow,        // "r,g,b" string for rgba() glows/shadows/washes
  emerald: '#10B981',
};

// ============================================================
// HERO
// ============================================================
function Hero() {
  return (
    <section className="relative overflow-hidden" style={{ background: BRAND.bg }}>
      {/* Decoration: one restrained glow + a subtle grid (Cool-Tech, no rainbow orbs) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-25%] left-1/2 -translate-x-1/2 w-[70vw] h-[45vw] rounded-full"
          style={{ background: `radial-gradient(ellipse at center, rgba(${BRAND.glow},0.18) 0%, transparent 65%)`, filter: 'blur(80px)' }} />
        <div className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(rgba(${BRAND.glow},0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(${BRAND.glow},0.06) 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, #000 30%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, #000 30%, transparent 75%)',
          }} />
      </div>

      {/* Top nav */}
      <nav className="relative max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white"
            style={{ background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent2})` }}>
            <PrimMark size={18} />
          </div>
          <div className="text-white font-bold text-lg tracking-tight">PRIM</div>
        </div>
        <div className="hidden md:flex items-center gap-7 text-sm font-medium" style={{ color: BRAND.textMuted }}>
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#how" className="hover:text-white transition-colors">How it works</a>
          <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
          <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
        </div>
        <div className="flex items-center gap-3">
          <a href="/" className="text-sm font-medium" style={{ color: BRAND.textMuted }}>Sign in</a>
          <a href="/pricing"
            className="bg-white text-slate-900 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-slate-100 transition">
            Start free trial
          </a>
        </div>
      </nav>

      {/* Hero content */}
      <div className="relative max-w-7xl mx-auto px-6 pt-20 pb-32 grid lg:grid-cols-12 gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="lg:col-span-7"
        >
          {/* Eyebrow chip */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider mb-7"
            style={{
              background: `rgba(${BRAND.glow},0.12)`,
              color: BRAND.accentSoft,
              border: `1px solid ${BRAND.borderStrong}`,
            }}>
            <Sparkles size={11} />
            Built by USHA agents, for USHA agents
          </div>

          <h1 className="text-white font-bold tracking-tight leading-[0.95]"
            style={{ fontSize: 'clamp(2.5rem, 6vw, 4.75rem)', letterSpacing: '-0.03em' }}>
            Full control of your<br />
            <span className="relative inline-block">
              <span className="relative z-10" style={{
                background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent2})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                insurance business.
              </span>
            </span>
          </h1>

          <p className="mt-7 text-lg leading-relaxed max-w-xl" style={{ color: BRAND.textMuted }}>
            Built for USHA agents tired of spreadsheets. PRIM tracks every lead, every commission, every dollar — automatically. Smart Import reads your statement in 30 seconds. Your CPA dashboard tells you the truth your spreadsheet never could.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a href="/pricing"
              className="inline-flex items-center gap-2 text-white font-semibold px-6 py-3.5 rounded-xl shadow-2xl transition-transform hover:scale-[1.02]"
              style={{
                background: `linear-gradient(135deg, ${BRAND.accent} 0%, ${BRAND.accent2} 100%)`,
                boxShadow: `0 12px 32px -8px rgba(${BRAND.glow},0.55)`,
              }}>
              Start your 7-day trial <ArrowRight size={16} />
            </a>
            <a href="#features"
              className="inline-flex items-center gap-2 font-semibold px-6 py-3.5 rounded-xl border transition-colors"
              style={{
                color: BRAND.textPrimary,
                borderColor: BRAND.borderStrong,
                background: 'rgba(255,255,255,0.02)',
              }}>
              See how it works
            </a>
          </div>

          {/* Inline reassurance */}
          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs" style={{ color: BRAND.textDim }}>
            <span className="inline-flex items-center gap-1.5">
              <Lock size={11} /> Bank-grade security
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Zap size={11} /> Set up in under 5 minutes
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Star size={11} /> Cancel anytime
            </span>
          </div>
        </motion.div>

        {/* Hero visual — floating dashboard mockup */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="lg:col-span-5 relative"
        >
          <HeroDashboardMockup />
        </motion.div>
      </div>
    </section>
  );
}

// ============================================================
// CSS dashboard mockup — looks like the real CPA Dashboard
// ============================================================
function HeroDashboardMockup() {
  const kpis = [
    { label: 'Revenue', value: '$48,290', up: '+18%', accent: '#10B981' },
    { label: 'CPA',     value: '$127',   up: '-12%', accent: '#06B6D4' },
    { label: 'Won',     value: '34',     up: '+6',   accent: BRAND.accent },
  ];
  return (
    <div className="relative">
      {/* Glow ring */}
      <div className="absolute -inset-4 rounded-3xl opacity-50 blur-2xl"
        style={{ background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent2})` }} />
      {/* Card */}
      <div className="relative rounded-2xl border overflow-hidden"
        style={{ background: BRAND.surface, borderColor: BRAND.border, boxShadow: '0 30px 80px -20px rgba(0,0,0,0.6)' }}>
        {/* Window chrome */}
        <div className="flex items-center gap-1.5 px-4 py-3 border-b" style={{ borderColor: BRAND.border }}>
          <div className="w-2.5 h-2.5 rounded-full bg-rose-400/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/60" />
          <div className="ml-3 text-[11px] font-mono" style={{ color: BRAND.textDim }}>
            primtracker.com / cpa-dashboard
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <div className="text-white font-bold text-lg">CPA Dashboard</div>
              <div className="text-xs" style={{ color: BRAND.textDim }}>Week of May 12 · 3 leads closed</div>
            </div>
            <div className="text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded"
              style={{ background: 'rgba(16,185,129,0.15)', color: '#34D399' }}>
              ▲ Trending
            </div>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-lg p-3 border"
                style={{ background: BRAND.surfaceRaise, borderColor: BRAND.border }}>
                <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: BRAND.textDim }}>{k.label}</div>
                <div className="text-white font-bold text-lg mt-1">{k.value}</div>
                <div className="text-[10px] font-semibold mt-0.5" style={{ color: k.accent }}>{k.up}</div>
              </div>
            ))}
          </div>

          {/* Sparkline */}
          <div className="rounded-lg p-3 border" style={{ background: BRAND.surfaceRaise, borderColor: BRAND.border }}>
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: BRAND.textDim }}>Revenue · last 12 weeks</div>
              <div className="text-[10px] font-semibold" style={{ color: '#34D399' }}>+34% MoM</div>
            </div>
            <svg viewBox="0 0 240 60" className="w-full h-14">
              <defs>
                <linearGradient id="hero-spark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BRAND.accent} stopOpacity="0.4" />
                  <stop offset="100%" stopColor={BRAND.accent} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0,45 L20,40 L40,42 L60,30 L80,28 L100,22 L120,25 L140,15 L160,18 L180,8 L200,12 L220,5 L240,3 L240,60 L0,60 Z"
                fill="url(#hero-spark)" />
              <path d="M0,45 L20,40 L40,42 L60,30 L80,28 L100,22 L120,25 L140,15 L160,18 L180,8 L200,12 L220,5 L240,3"
                fill="none" stroke={BRAND.accent} strokeWidth="2" />
            </svg>
          </div>

          {/* Mini activity — generic deal types, no customer data */}
          <div className="mt-3 space-y-2">
            {[
              ['Premier Advantage · Issued', '$1,250', 'Issued', '#10B981'],
              ['Secure Advantage · Pending', '$890', 'Pending', '#F59E0B'],
              ['Health Access · Issued', '$1,485', 'Issued', '#10B981'],
            ].map(([label, val, stage, c]) => (
              <div key={label} className="flex items-center justify-between text-xs px-3 py-2 rounded-md border"
                style={{ background: BRAND.surfaceRaise, borderColor: BRAND.border }}>
                <span className="text-white font-medium">{label}</span>
                <span className="flex items-center gap-3">
                  <span className="font-mono" style={{ color: BRAND.textMuted }}>{val}</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: `${c}22`, color: c }}>{stage}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// STATS STRIP — animated rolling numbers on scroll
// ============================================================
function StatsStrip() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const stats = [
    { label: 'Agents on PRIM',     value: 20,        suffix: '+',    format: (v) => v },
    { label: 'Tracked in commissions', value: 240000, suffix: '+', format: (v) => `$${(v / 1000).toFixed(0)}K` },
    { label: 'Statement parse time',   value: 30,     suffix: 's',  format: (v) => v },
    { label: 'Hours saved per week',   value: 8,      suffix: 'hrs', format: (v) => v },
  ];
  return (
    <section ref={ref} className="relative py-20" style={{ background: BRAND.bg, borderTop: `1px solid ${BRAND.border}`, borderBottom: `1px solid ${BRAND.border}` }}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="text-[11px] uppercase tracking-[0.2em] font-bold mb-2" style={{ color: BRAND.accentSoft }}>Trusted by producers</div>
          <h2 className="text-white text-3xl md:text-4xl font-bold tracking-tight">
            Agents are already getting paid faster.
          </h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="text-center"
            >
              <div className="font-bold tracking-tight"
                style={{
                  fontSize: 'clamp(2rem, 4vw, 3rem)',
                  background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent2})`,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>
                <AnimatedNumber target={s.value} format={s.format} suffix={s.suffix} inView={inView} />
              </div>
              <div className="mt-2 text-sm font-medium" style={{ color: BRAND.textMuted }}>{s.label}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AnimatedNumber({ target, format, suffix, inView }) {
  const [val, setVal] = useState(0);
  const started = useRef(false);
  if (inView && !started.current) {
    started.current = true;
    const duration = 1400;
    const start = performance.now();
    const animate = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.floor(target * eased));
      if (t < 1) requestAnimationFrame(animate);
      else setVal(target);
    };
    requestAnimationFrame(animate);
  }
  return <>{format(val)}{suffix}</>;
}

// ============================================================
// FEATURE CARD STACK — sticky scroll, cards layer up
// ============================================================
function FeatureStack() {
  const container = useRef(null);
  const { scrollYProgress } = useScroll({
    target: container,
    offset: ['start start', 'end end'],
  });

  const features = [
    {
      icon: Upload,
      tag: 'Smart Import (AI)',
      title: 'Drop your statement. Watch it parse.',
      body: 'PRIM uses Claude Vision to read USHA statements in 30 seconds. Every advance, residual, chargeback — auto-categorized. No more retyping rows from a PDF.',
      Mock: MockSmartImport,
      gradient: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent2})`,
    },
    {
      icon: BarChart3,
      tag: 'CPA Dashboard',
      title: 'Your real cost per acquisition.',
      body: 'Not estimated. Not generic. Your true CPA, by source, by month, by tier. See where your money actually goes — and where it should go more of.',
      Mock: MockCpaDashboard,
      gradient: `linear-gradient(135deg, #06B6D4, #10B981)`,
    },
    {
      icon: Calculator,
      tag: 'Commission Calculator',
      title: 'Every tier, every product, every state.',
      body: 'Plug in a deal — PRIM tells you exactly what you earn at WA, CA, FTA, FSL. Plus advance, association, add-ons, splits. The calculator USHA never built.',
      Mock: MockCalculator,
      gradient: `linear-gradient(135deg, #F59E0B, #EF4444)`,
    },
    {
      icon: Users,
      tag: 'Prospects Mini-CRM',
      title: 'Kanban that knows your pipeline.',
      body: 'Drag deals through stages. Source-coded cards. Built-in appointment reminders. No more spreadsheets, no more sticky notes, no more "who was I supposed to call?"',
      Mock: MockProspects,
      gradient: `linear-gradient(135deg, ${BRAND.accent3}, #F43F5E)`,
    },
    {
      icon: Mail,
      tag: 'Post-Sale Email Automation',
      title: 'Welcome customers in your brand.',
      body: 'When a deal closes, PRIM fires a polished post-sale email from your domain — with the policy details, your contact info, and the right Dear Doctor Letter attached. Set it once. Never forget again.',
      Mock: MockEmail,
      gradient: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent2})`,
    },
    {
      icon: Award,
      tag: 'Built by an agent',
      title: 'Not by a software founder pretending.',
      body: 'PRIM is built by an active USHA agent who got tired of spreadsheets and decided to fix it. Every feature exists because a real producer needed it. Not a single dashboard built "to look nice in a demo."',
      Mock: MockFounder,
      gradient: `linear-gradient(135deg, #10B981, #06B6D4)`,
    },
  ];

  return (
    <section id="features" ref={container} className="relative" style={{ background: BRAND.bg }}>
      {/* Sticky header */}
      <div className="relative max-w-7xl mx-auto px-6 pt-24 pb-8 text-center">
        <div className="text-[11px] uppercase tracking-[0.2em] font-bold mb-3" style={{ color: BRAND.accentSoft }}>What you get</div>
        <h2 className="text-white font-bold tracking-tight"
          style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', letterSpacing: '-0.02em' }}>
          Six tools your spreadsheet<br /> was never going to give you.
        </h2>
        <p className="mt-5 max-w-2xl mx-auto text-lg" style={{ color: BRAND.textMuted }}>
          Each one was built because an agent needed it on a Monday at 6am. Scroll through.
        </p>
      </div>

      {/* Stacked cards — tight scroll. Each card layers in over 20vh
          of scroll plus a 10vh trailing beat for the last card. Total
          for 6 cards = 110vh (was 220vh, 315vh, 420vh in prior
          iterations). Section now flows directly into "How it works"
          with no dead-air void between them. */}
      <div className="relative" style={{ paddingBottom: `${(features.length - 1) * 20 + 10}vh` }}>
        {features.map((f, i) => {
          const range = [i / features.length, (i + 1) / features.length];
          return (
            <FeatureCard
              key={f.title}
              i={i}
              total={features.length}
              feature={f}
              progress={scrollYProgress}
              range={range}
            />
          );
        })}
      </div>
    </section>
  );
}

function FeatureCard({ i, total, feature, progress, range }) {
  const scale = useTransform(progress, [range[0], 1], [1, 1 - (total - i - 1) * 0.04]);
  const opacity = useTransform(progress, [range[1] - 0.05, range[1]], [1, 0.35]);
  const { icon: Icon, tag, title, body, Mock, gradient } = feature;

  return (
    <div className="sticky top-24 px-6 mb-8" style={{ paddingTop: `${i * 24}px` }}>
      <motion.div
        style={{ scale, opacity }}
        className="max-w-6xl mx-auto rounded-3xl overflow-hidden border"
      >
        <div className="grid lg:grid-cols-2 gap-0"
          style={{ background: BRAND.surface, borderColor: BRAND.border }}>
          {/* Left: copy */}
          <div className="p-10 lg:p-14 flex flex-col justify-center">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white"
                style={{ background: gradient, boxShadow: `0 12px 24px -8px ${gradient.match(/#[0-9A-F]{6}/i)?.[0] || BRAND.accent}55` }}>
                <Icon size={20} />
              </div>
              <div className="text-[11px] uppercase tracking-[0.18em] font-bold" style={{ color: BRAND.accentSoft }}>{tag}</div>
            </div>
            <h3 className="text-white font-bold tracking-tight" style={{ fontSize: 'clamp(1.65rem, 3.2vw, 2.5rem)', letterSpacing: '-0.02em' }}>{title}</h3>
            <p className="mt-5 text-lg leading-relaxed" style={{ color: BRAND.textMuted }}>{body}</p>
          </div>
          {/* Right: visual */}
          <div className="p-10 lg:p-14 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.20)', borderLeft: `1px solid ${BRAND.border}` }}>
            <Mock />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ============================================================
// Feature mockups — small stylized "screenshots" rendered in CSS
// ============================================================

function MockSmartImport() {
  return (
    <div className="w-full rounded-xl border p-4 text-xs"
      style={{ background: BRAND.surfaceRaise, borderColor: BRAND.border }}>
      <div className="flex items-center gap-2 mb-3">
        <FileText size={14} style={{ color: BRAND.accent }} />
        <span className="text-white font-semibold">USHA-Account-Summary-2026-04.pdf</span>
        <span className="ml-auto text-[10px] px-2 py-0.5 rounded font-bold"
          style={{ background: 'rgba(16,185,129,0.18)', color: '#34D399' }}>Parsed in 27s</span>
      </div>
      <div className="space-y-1.5">
        {[
          ['Advance · Premier Advantage',     '$1,250.00', '#34D399'],
          ['Renewal · Health Access III',     '$28.00',    BRAND.accentSoft],
          ['Chargeback · Secure Advantage',   '-$485.00',  '#FB7185'],
          ['Override · Premier Choice',       '$320.00',   BRAND.accentSoft],
          ['Renewal · Premier Advantage',     '$28.00',    BRAND.accentSoft],
        ].map(([row, amt, color]) => (
          <div key={row} className="flex items-center justify-between px-3 py-1.5 rounded-md"
            style={{ background: 'rgba(0,0,0,0.25)' }}>
            <span style={{ color: BRAND.textPrimary }}>{row}</span>
            <span className="font-mono font-semibold" style={{ color }}>{amt}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[10px]" style={{ color: BRAND.textDim }}>
        <Brain size={11} />
        Claude Vision · 47 rows extracted · 0 manual edits needed
      </div>
    </div>
  );
}

function MockCpaDashboard() {
  return (
    <div className="w-full rounded-xl border p-4 text-xs"
      style={{ background: BRAND.surfaceRaise, borderColor: BRAND.border }}>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[['Revenue', '$48,290', '#34D399'], ['CPA', '$127', '#06B6D4'], ['Net', '$31,840', BRAND.accentSoft]].map(([l, v, c]) => (
          <div key={l} className="rounded-lg p-2.5" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <div className="text-[9px] uppercase tracking-wider font-bold" style={{ color: BRAND.textDim }}>{l}</div>
            <div className="font-bold mt-0.5" style={{ color: c, fontSize: 14 }}>{v}</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)' }}>
        <div className="text-[9px] uppercase tracking-wider font-bold mb-2" style={{ color: BRAND.textDim }}>This week vs last</div>
        <div className="flex items-end gap-1.5 h-16">
          {[40, 55, 35, 60, 45, 72, 90].map((h, i) => (
            <div key={i} className="flex-1 rounded-t"
              style={{ height: `${h}%`, background: `linear-gradient(180deg, ${BRAND.accent}, ${BRAND.accent}55)` }} />
          ))}
        </div>
        <div className="flex justify-between text-[9px] mt-1" style={{ color: BRAND.textDim }}>
          <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
        </div>
      </div>
    </div>
  );
}

function MockCalculator() {
  const tiers = [
    ['WA', '$680',  '#94A3B8'],
    ['CA', '$1,020', BRAND.accentSoft],
    ['FTA', '$1,360', '#C4B5FD'],
    ['FSL', '$1,700', '#34D399'],
  ];
  return (
    <div className="w-full rounded-xl border p-4 text-xs"
      style={{ background: BRAND.surfaceRaise, borderColor: BRAND.border }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-white font-semibold">Premier Advantage · $289/mo</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded"
          style={{ background: `rgba(${BRAND.glow},0.18)`, color: BRAND.accentSoft }}>7.5 mo advance</span>
      </div>
      <div className="space-y-1.5">
        {tiers.map(([tier, val, c]) => (
          <div key={tier} className="flex items-center justify-between px-3 py-2 rounded-md"
            style={{ background: 'rgba(0,0,0,0.25)', borderLeft: `3px solid ${c}` }}>
            <span className="font-bold" style={{ color: BRAND.textPrimary }}>{tier}</span>
            <span className="text-[10px]" style={{ color: BRAND.textMuted }}>Writing → Field Sales Leader</span>
            <span className="font-mono font-semibold" style={{ color: c }}>{val}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 text-[10px] flex items-center gap-1.5" style={{ color: BRAND.textDim }}>
        <TrendingUp size={11} />
        Switch to FSL → +$1,020 per Premier Advantage close
      </div>
    </div>
  );
}

function MockProspects() {
  const cols = [
    { name: 'WEBBY SET', count: 4, color: '#06B6D4' },
    { name: 'CONFIRMED', count: 6, color: '#F59E0B' },
    { name: 'APPT SET', count: 3, color: '#10B981' },
  ];
  // Rotating sources show PRIM's color-coded lead-source diversity —
  // each card gets a different source pill so the kanban looks real
  // (multiple lead sources flowing through one pipeline) instead of
  // a single-source demo.
  const sources = [
    { label: 'AGED LEAD',       color: '#3B82F6' },  // blue
    { label: 'BOUGHT LEAD',     color: '#F59E0B' },  // amber
    { label: 'ELITE EXCLUSIVE', color: '#10B981' },  // emerald
    { label: 'PREMIUM SHARED',  color: BRAND.accent },  // single accent (was violet)
  ];
  return (
    <div className="w-full rounded-xl border p-4 text-xs"
      style={{ background: BRAND.surfaceRaise, borderColor: BRAND.border }}>
      <div className="grid grid-cols-3 gap-2">
        {cols.map((c, colIdx) => (
          <div key={c.name} className="rounded-lg p-2"
            style={{ background: 'rgba(0,0,0,0.3)' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
              <span className="text-[9px] uppercase tracking-wider font-bold" style={{ color: BRAND.textPrimary }}>{c.name}</span>
              <span className="ml-auto text-[10px]" style={{ color: BRAND.textDim }}>{c.count}</span>
            </div>
            <div className="space-y-1.5">
              {Array.from({ length: 3 }).map((_, i) => {
                // Pick a source per card — offset by column so each
                // column starts from a different source, avoiding
                // a horizontal "matching colors" pattern.
                const src = sources[(i + colIdx) % sources.length];
                return (
                  <div key={i} className="rounded p-1.5" style={{ background: 'rgba(255,255,255,0.04)', borderLeft: `2px solid ${c.color}` }}>
                    <div className="text-[10px] text-white font-semibold truncate">
                      Sample prospect
                    </div>
                    <div className="text-[9px] mt-0.5 inline-block px-1.5 py-0.5 rounded font-bold"
                      style={{ background: `${src.color}22`, color: src.color }}>{src.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MockEmail() {
  // Shown as a TEMPLATE PREVIEW — visible {token} placeholders make it
  // obvious nothing here is real customer data. Communicates "PRIM
  // personalizes this automatically per lead" without inventing fake
  // names or policy numbers (HIPAA-safe).
  return (
    <div className="w-full rounded-xl border overflow-hidden text-xs"
      style={{ background: BRAND.surfaceRaise, borderColor: BRAND.border }}>
      <div className="p-3" style={{
        background: `linear-gradient(135deg, ${BRAND.accent} 0%, ${BRAND.accent2} 100%)`,
      }}>
        <div className="text-[9px] uppercase tracking-[0.15em] font-bold text-white/85">Your new policy</div>
        <div className="text-white font-bold mt-0.5" style={{ fontSize: 16 }}>
          <span className="font-mono text-white/90" style={{ fontSize: 12 }}>{'{agent_name}'}</span>
        </div>
        <div className="text-[10px] text-white/85">Licensed Insurance Agent</div>
      </div>
      <div className="p-3">
        <div className="text-white font-medium mb-2">
          Hi <span className="font-mono" style={{ color: BRAND.accentSoft }}>{'{customer_first_name}'}</span>,
        </div>
        <p className="leading-relaxed mb-3" style={{ color: BRAND.textMuted, fontSize: 11 }}>
          It was a pleasure helping you find a new health insurance plan. I would like to thank you for your business...
        </p>
        <div className="rounded p-2 mb-2" style={{ background: `rgba(${BRAND.glow},0.10)`, borderLeft: `3px solid ${BRAND.accent}` }}>
          <div className="text-[9px] uppercase tracking-wider font-bold mb-1" style={{ color: BRAND.textPrimary }}>Your Policy</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span style={{ color: BRAND.textDim }}>Plan</span>
            <span className="font-mono" style={{ color: BRAND.accentSoft }}>{'{main_product}'}</span>
            <span style={{ color: BRAND.textDim }}>Policy</span>
            <span className="font-mono" style={{ color: BRAND.accentSoft }}>{'{policy_number}'}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px]" style={{ color: '#34D399' }}>
          <FileText size={10} /> Dear Doctor Letter · auto-attached per product
        </div>
        <div className="mt-2 pt-2 border-t text-[9px] italic" style={{ borderColor: 'rgba(255,255,255,0.05)', color: BRAND.textDim }}>
          PRIM auto-fills these tokens at send time. Customer data never appears in any mock or marketing surface.
        </div>
      </div>
    </div>
  );
}

function MockFounder() {
  // The headshot has a light grey background — we want it to blend
  // into the dark card surface. Two tricks stacked:
  //   1. A radial gradient mask that fades the edges of the photo
  //      out to transparent so it dissolves into the card rather
  //      than ending in a hard rectangle.
  //   2. A subtle color overlay tinted with the brand accent so
  //      the photo feels like it belongs on this dark canvas
  //      (vs. looking like a pasted-in profile picture).
  return (
    <div className="w-full rounded-xl border overflow-hidden text-xs relative"
      style={{ background: BRAND.surfaceRaise, borderColor: BRAND.border, minHeight: 380 }}>
      {/* The photo — soft-faded edges so it dissolves into the card */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'url(/founder/juan.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'top center',
          // Radial mask: full opacity in the face area, fades to
          // transparent at the edges. Removes the harsh photo
          // boundary against the dark card.
          WebkitMaskImage: 'radial-gradient(ellipse 70% 80% at 50% 35%, black 35%, transparent 95%)',
          maskImage: 'radial-gradient(ellipse 70% 80% at 50% 35%, black 35%, transparent 95%)',
        }}
      />
      {/* Brand color wash — gives the photo a subtle indigo tint so the
          original light-grey backdrop reads as part of the page */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg, rgba(15,23,48,0.15) 0%, rgba(15,23,48,0.55) 60%, ${BRAND.surfaceRaise} 95%)`,
          mixBlendMode: 'normal',
        }}
      />
      {/* Caption block at the bottom */}
      <div className="absolute inset-x-0 bottom-0 p-6">
        <div className="text-[10px] uppercase tracking-[0.15em] font-bold mb-1.5" style={{ color: BRAND.accentSoft }}>
          Founder
        </div>
        <div className="text-white font-bold text-xl">Juan Trejo</div>
        <div className="text-[12px] mt-0.5" style={{ color: BRAND.textMuted }}>
          Active USHA agent
        </div>
        <div className="mt-3 text-[12px] italic leading-relaxed" style={{ color: BRAND.textMuted }}>
          &ldquo;I built PRIM because I needed it. Now you can use it too.&rdquo;
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SEE IT IN ACTION — 60s vertical promo video. Lazy-mounts on
// intersection so we don't ship a 65MB MP4 on first paint. The
// video is 9:16 (mobile-shot brand spot), rendered inside a
// phone-bezel frame on the left, with value-prop copy + CTA on
// the right. Falls back to a styled placeholder if the MP4
// hasn't been uploaded yet.
// ============================================================
function SeeItInAction() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-15% 0px' });
  const [videoMissing, setVideoMissing] = useState(false);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef(null);

  const bullets = [
    { icon: BarChart3,  text: 'Real CPA — invested, earned, ROI, true net.' },
    { icon: Users,      text: 'Every deal auto-reconciled by source + campaign.' },
    { icon: Mail,       text: 'Post-sale emails that fire themselves on close.' },
    { icon: Calculator, text: 'Model splits + tiers without touching a spreadsheet.' },
  ];

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    const next = !muted;
    v.muted = next;
    setMuted(next);
  };

  return (
    <section
      ref={ref}
      id="see-it"
      className="relative py-32"
      style={{ background: BRAND.bg }}
    >
      {/* decoration: one restrained single-accent glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-[20%] left-[-10%] w-[40vw] h-[40vw] rounded-full"
          style={{
            background: `radial-gradient(circle, rgba(${BRAND.glow},0.10) 0%, transparent 60%)`,
            filter: 'blur(80px)',
          }}
        />
      </div>

      <div className="relative max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-2 gap-12 lg:gap-20 items-center">

          {/* LEFT — vertical phone-bezel video frame */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7 }}
            className="flex justify-center md:justify-end"
          >
            <div
              className="relative rounded-[44px] overflow-hidden"
              style={{
                width: 'min(360px, 100%)',
                aspectRatio: '9 / 19.5',
                background: '#000',
                padding: '8px',
                border: `2px solid ${BRAND.borderStrong}`,
                boxShadow: `0 50px 140px -20px ${BRAND.accent}66, 0 25px 70px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.05)`,
              }}
            >
              {/* inner screen */}
              <div
                className="relative w-full h-full rounded-[36px] overflow-hidden"
                style={{ background: BRAND.bg }}
              >
                {/* notch */}
                <div
                  className="absolute top-2 left-1/2 -translate-x-1/2 w-[40%] h-6 rounded-full z-20"
                  style={{ background: '#000' }}
                />

                {inView && !videoMissing ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    muted={muted}
                    loop
                    playsInline
                    preload="metadata"
                    onError={() => setVideoMissing(true)}
                    onClick={toggleMute}
                    className="absolute inset-0 w-full h-full object-cover cursor-pointer"
                  >
                    <source src="/marketing/prim-promo-60s.mp4" type="video/mp4" />
                  </video>
                ) : null}

                {/* fallback placeholder */}
                {(!inView || videoMissing) && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div
                      className="absolute inset-0"
                      style={{
                        background: `linear-gradient(135deg, ${BRAND.surface} 0%, ${BRAND.surfaceRaise || BRAND.surface} 100%)`,
                      }}
                    />
                    <div
                      className="absolute inset-0 opacity-50"
                      style={{
                        background: `radial-gradient(circle at 50% 40%, ${BRAND.accent}33 0%, transparent 60%)`,
                      }}
                    />
                    <div className="relative flex flex-col items-center gap-4">
                      <div
                        className="w-20 h-20 rounded-full flex items-center justify-center"
                        style={{
                          background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent2})`,
                          boxShadow: `0 20px 50px ${BRAND.accent}66`,
                        }}
                      >
                        <Play size={32} fill="#fff" color="#fff" />
                      </div>
                      <div className="text-sm font-semibold" style={{ color: BRAND.textPrimary }}>
                        Product walkthrough — 60s
                      </div>
                    </div>
                  </div>
                )}

                {/* mute toggle — bottom-right corner of the phone screen */}
                {inView && !videoMissing && (
                  <button
                    onClick={toggleMute}
                    aria-label={muted ? 'Unmute video' : 'Mute video'}
                    className="absolute bottom-4 right-4 z-30 w-10 h-10 rounded-full flex items-center justify-center transition hover:scale-105"
                    style={{
                      background: 'rgba(0,0,0,0.55)',
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(255,255,255,0.15)',
                    }}
                  >
                    {muted ? <VolumeX size={16} color="#fff" /> : <Volume2 size={16} color="#fff" />}
                  </button>
                )}
              </div>
            </div>
          </motion.div>

          {/* RIGHT — heading + bullets + CTA */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.15 }}
          >
            <div
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase mb-5"
              style={{
                color: BRAND.accent,
                background: `rgba(${BRAND.glow},0.10)`,
                border: `1px solid ${BRAND.border}`,
              }}
            >
              <Play size={11} fill={BRAND.accent} /> See it in action
            </div>
            <h2
              className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4"
              style={{ color: BRAND.textPrimary, letterSpacing: '-0.02em' }}
            >
              A 60-second tour of your new control panel.
            </h2>
            <p className="text-lg mb-8" style={{ color: BRAND.textMuted }}>
              Real screens, real workflows. Watch every part of PRIM — dashboard,
              deals, books, reports — work together in one place. Tap to unmute.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
              {bullets.map((b, i) => (
                <div
                  key={i}
                  className="rounded-xl p-3 flex items-start gap-3"
                  style={{ background: BRAND.surface, border: `1px solid ${BRAND.border}` }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent2})` }}
                  >
                    <b.icon size={15} color="#fff" />
                  </div>
                  <div className="text-xs leading-relaxed pt-1" style={{ color: BRAND.textMuted }}>
                    {b.text}
                  </div>
                </div>
              ))}
            </div>

            <a
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-xl px-6 py-3 font-bold text-sm transition hover:scale-[1.02]"
              style={{
                background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent2})`,
                color: '#fff',
                boxShadow: `0 20px 50px -10px ${BRAND.accent}80`,
              }}
            >
              Start your 7-day free trial <ArrowRight size={16} />
            </a>
          </motion.div>
        </div>
      </div>
    </section>
  );
}


// ============================================================
// HOW IT WORKS
// ============================================================
function HowItWorks() {
  const steps = [
    { num: '01', icon: Upload,  title: 'Sign up + drop your last USHA statement.', body: 'AI parses every advance, residual, and chargeback in under 30 seconds. No retyping.' },
    { num: '02', icon: Brain,   title: 'Import your spreadsheet or CRM export.', body: 'Airtable, Excel, Google Sheets — PRIM’s AI auto-maps your columns to the right fields.' },
    { num: '03', icon: LineChart, title: 'Track every deal, every dollar, every week.', body: 'Your CPA dashboard updates as you log activity. Post-sale emails fire automatically when deals close.' },
  ];
  return (
    <section id="how" className="relative py-32" style={{ background: BRAND.bg }}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="text-[11px] uppercase tracking-[0.2em] font-bold mb-3" style={{ color: BRAND.accentSoft }}>How it works</div>
          <h2 className="text-white font-bold tracking-tight" style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', letterSpacing: '-0.02em' }}>
            Three steps. Under five minutes.
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {steps.map((s, i) => (
            <motion.div
              key={s.num}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.6, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-2xl border p-7"
              style={{ background: BRAND.surface, borderColor: BRAND.border }}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{ background: `rgba(${BRAND.glow},0.12)`, border: `1px solid ${BRAND.borderStrong}` }}>
                  <s.icon size={20} style={{ color: BRAND.accentSoft }} />
                </div>
                <div className="font-bold font-mono"
                  style={{
                    fontSize: 32,
                    background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent2})`,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    opacity: 0.4,
                  }}>
                  {s.num}
                </div>
              </div>
              <h3 className="text-white font-bold text-lg leading-snug mb-2">{s.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: BRAND.textMuted }}>{s.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// PRICING TEASER
// ============================================================
function PricingTeaser() {
  const tiers = [
    {
      name: 'Starter',
      price: '$49.95',
      tagline: 'Solo agents tracking their own book.',
      features: ['Smart Import (AI)', 'Vendor memory', 'Prospects mini-CRM', 'Commission Calculator', 'PRIM Assistant'],
      cta: 'Start trial',
      highlight: false,
    },
    {
      name: 'Pro',
      price: '$99',
      tagline: 'Producers who care about real numbers.',
      features: ['Everything in Starter', 'CPA Dashboard + True Net', 'Bulk AI Re-categorize', 'Statement reconciliation', 'Post-sale email automation', 'Priority support'],
      cta: 'Start trial',
      highlight: true,
    },
    {
      name: 'Team',
      price: '$200',
      tagline: 'FSLs managing downline + overrides.',
      features: ['Everything in Pro', 'Override commission tracking', 'Multi-agent admin', 'Team insights', 'Cold outreach sequences', 'White-glove onboarding'],
      cta: 'Start trial',
      highlight: false,
    },
  ];
  return (
    <section id="pricing" className="relative py-32" style={{ background: BRAND.bg }}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="text-[11px] uppercase tracking-[0.2em] font-bold mb-3" style={{ color: BRAND.accentSoft }}>Pricing</div>
          <h2 className="text-white font-bold tracking-tight" style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', letterSpacing: '-0.02em' }}>
            Pick the plan that fits.
          </h2>
          <p className="mt-4 text-lg" style={{ color: BRAND.textMuted }}>
            Every plan starts with a 7-day free trial. No long contracts.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {tiers.map((t) => (
            <div key={t.name}
              className="relative rounded-2xl border p-8 flex flex-col"
              style={{
                background: t.highlight ? `linear-gradient(180deg, rgba(${BRAND.glow},0.10), ${BRAND.surface})` : BRAND.surface,
                borderColor: t.highlight ? BRAND.borderStrong : BRAND.border,
                boxShadow: t.highlight ? `0 24px 60px -16px ${BRAND.accent}40` : 'none',
              }}>
              {t.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] uppercase tracking-wider font-bold text-white"
                  style={{ background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent2})` }}>
                  Most popular
                </div>
              )}
              <div className="text-white font-bold text-xl">{t.name}</div>
              <div className="text-sm mt-1" style={{ color: BRAND.textMuted }}>{t.tagline}</div>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-white font-bold" style={{ fontSize: 42, letterSpacing: '-0.02em' }}>{t.price}</span>
                <span className="text-sm" style={{ color: BRAND.textDim }}>/ month</span>
              </div>
              <ul className="mt-6 space-y-2.5 flex-1">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm" style={{ color: BRAND.textMuted }}>
                    <Check size={16} style={{ color: '#34D399' }} className="mt-0.5 flex-shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <a href="/pricing"
                className="mt-8 inline-flex items-center justify-center gap-2 font-semibold py-3 rounded-xl transition-transform hover:scale-[1.02]"
                style={t.highlight ? {
                  background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent2})`,
                  color: 'white',
                  boxShadow: `0 12px 24px -8px ${BRAND.accent}66`,
                } : {
                  background: 'rgba(255,255,255,0.04)',
                  color: BRAND.textPrimary,
                  border: `1px solid ${BRAND.borderStrong}`,
                }}>
                {t.cta} <ArrowRight size={14} />
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// FAQ
// ============================================================
function FAQ() {
  const items = [
    ['Is my data secure?', 'Yes. All data is stored in Supabase with row-level security — only you can access your own records. Stripe handles all payment data (we never store cards). Emails route through Resend with signed webhooks. The same security stack used by Vercel, Notion, and other modern SaaS products.'],
    ['Does PRIM connect to USHA’s portal?', 'No direct API connection — USHA doesn’t offer one. PRIM works by parsing your existing USHA documents (Account Summaries, Sales Reports, Portal screenshots) with AI. You’re always in control of what gets imported.'],
    ['Can I import from Airtable, Excel, or Google Sheets?', 'Yes. Smart Import (AI) reads any spreadsheet structure and auto-maps columns to PRIM’s fields. Export from any source as CSV or XLSX, drop it in, confirm the preview, done.'],
    ['What if I have a team / downline?', 'The Team plan supports multi-agent admin, override commission tracking, and team-wide insights. Get every agent in PRIM and you can see the whole pipeline + override flow in one place.'],
    ['How does the 7-day trial work?', 'Pick a plan, enter your card, get 7 days of full access. Cancel anytime before day 7 from Profile → Subscription and you’re not charged. No hidden auto-charges.'],
    ['I’m not technical — is PRIM easy to use?', 'PRIM is built BY an agent, FOR agents. The onboarding wizard guides you through your first import in under 5 minutes. The PRIM Assistant (built-in AI co-pilot) answers questions in plain English. No training required.'],
    ['What if PRIM doesn’t work for me?', 'Cancel anytime — month-to-month, no contracts. Your data exports cleanly back to CSV if you ever want to leave.'],
    ['Can I use my own email domain for customer emails?', 'Yes. Pro+ agents can connect their own Resend-verified domain so post-sale emails go out from their business (e.g., agent@theirCompany.com) — not from PRIM’s default.'],
  ];
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="relative py-32" style={{ background: BRAND.bg }}>
      <div className="max-w-3xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="text-[11px] uppercase tracking-[0.2em] font-bold mb-3" style={{ color: BRAND.accentSoft }}>FAQ</div>
          <h2 className="text-white font-bold tracking-tight" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', letterSpacing: '-0.02em' }}>
            Questions, answered.
          </h2>
        </div>
        <div className="space-y-2">
          {items.map(([q, a], i) => (
            <div key={q}
              className="rounded-xl border overflow-hidden transition-colors"
              style={{
                background: open === i ? BRAND.surface : 'rgba(255,255,255,0.02)',
                borderColor: open === i ? BRAND.borderStrong : BRAND.border,
              }}>
              <button
                onClick={() => setOpen(open === i ? -1 : i)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="text-white font-medium">{q}</span>
                <ChevronDown
                  size={16}
                  style={{
                    color: BRAND.textMuted,
                    transform: open === i ? 'rotate(180deg)' : 'rotate(0)',
                    transition: 'transform 200ms',
                  }}
                />
              </button>
              {open === i && (
                <div className="px-5 pb-5 -mt-1 text-sm leading-relaxed" style={{ color: BRAND.textMuted }}>{a}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// FINAL CTA + FOOTER
// ============================================================
function FinalCta() {
  return (
    <section className="relative py-32 overflow-hidden" style={{ background: BRAND.bg }}>
      {/* Glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[70vw] h-[40vw] rounded-full"
          style={{ background: `radial-gradient(circle, ${BRAND.accent}33 0%, transparent 60%)`, filter: 'blur(80px)' }} />
      </div>

      <div className="relative max-w-4xl mx-auto px-6 text-center">
        <h2 className="text-white font-bold tracking-tight" style={{ fontSize: 'clamp(2rem, 5.5vw, 4rem)', letterSpacing: '-0.03em' }}>
          Ready to stop tracking<br />
          <span style={{
            background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent2}, ${BRAND.accent3})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>in spreadsheets?</span>
        </h2>
        <p className="mt-6 max-w-xl mx-auto text-lg" style={{ color: BRAND.textMuted }}>
          7 days free. Cancel anytime. Built by an agent who got tired of guessing.
        </p>
        <div className="mt-9">
          <a href="/pricing"
            className="inline-flex items-center gap-2 text-white font-semibold px-7 py-4 rounded-xl transition-transform hover:scale-[1.02]"
            style={{
              background: `linear-gradient(135deg, ${BRAND.accent} 0%, ${BRAND.accent2} 100%)`,
              fontSize: 17,
              boxShadow: `0 16px 40px -12px ${BRAND.accent}88`,
            }}>
            Start your free trial <ArrowRight size={18} />
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="relative py-12 border-t" style={{ background: BRAND.bg, borderColor: BRAND.border }}>
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md flex items-center justify-center text-white"
            style={{ background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent2})` }}>
            <PrimMark size={14} />
          </div>
          <div className="text-white font-bold text-sm">PRIM™</div>
          <span className="text-xs" style={{ color: BRAND.textDim }}>· Performance · Revenue · Investment</span>
        </div>
        <div className="flex items-center gap-6 text-xs" style={{ color: BRAND.textMuted }}>
          <a href="/privacy" className="hover:text-white transition">Privacy</a>
          <a href="/terms" className="hover:text-white transition">Terms</a>
          <a href="mailto:juantrejo9082@gmail.com" className="hover:text-white transition">Contact</a>
        </div>
        <div className="text-xs" style={{ color: BRAND.textDim }}>
          © 2026 R&amp;J Prime Consultancy LLC. All rights reserved.
        </div>
      </div>
      <div className="mt-6 pt-6 text-center text-xs leading-relaxed" style={{ color: BRAND.textDim, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        PRIM™ is an independent tool and is not affiliated with, endorsed by, or sponsored by USHEALTH Advisors (USHA). For informational purposes only — not tax, financial, or legal advice. Figures are estimates; verify against your official statements.
      </div>
    </footer>
  );
}

// ============================================================
// PAGE
// ============================================================
export default function LandingPage() {
  return (
    <main style={{ background: BRAND.bg, color: BRAND.textPrimary, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' }}>
      <Hero />
      <StatsStrip />
      <FeatureStack />
      <SeeItInAction />
      <HowItWorks />
      <PricingTeaser />
      <FAQ />
      <FinalCta />
      <Footer />
    </main>
  );
}

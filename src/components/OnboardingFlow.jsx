'use client';

/**
 * PRIM Agent Onboarding — first-run, must-finish teach flow.
 *
 * ⚠️ FIRST-DRAFT SKELETON — ported from the design prototype, NOT yet run against
 * the PRIM repo. Treat it as a concrete starting point: wire the integration
 * points (marked `INTEGRATE:`), swap in PRIM's real logo/icons/theme setters,
 * and verify against `PRIM Onboarding.dc.html` (the visual source of truth).
 *
 * Integration (see README.md for detail):
 *   import {
 *     loadOnboardingProgress, shouldAutoLaunch, markCompleted, markSkipped, resetOnboarding,
 *   } from '@/lib/onboarding';
 *
 *   const progress = await loadOnboardingProgress();
 *   if (shouldAutoLaunch(progress)) setTimeout(() => setOpen(true), 800);
 *
 *   <OnboardingFlow open={open}
 *     onComplete={async () => { await markCompleted(); setOpen(false); }}
 *     onSkip={async () => { await markSkipped(); setOpen(false); }} />
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { PrimAppIcon } from '@/components/PrimLogo';
import { loadAgentProfile, saveAgentProfile, applyThemeToDOM, applyAccentToDOM } from '@/lib/agentProfile';
import { PLAN_DISPLAY } from '@/lib/stripe-prices';

/* ------------------------------------------------------------------ tokens */
const LIGHT = {
  base: '#FBFCFE', surface: '#FFFFFF', surface2: '#F5F7FD', border: '#E7EBF3',
  text: '#0F172A', text2: '#52607A', text3: '#94A0B8',
};
// Simulated-app shell (intentionally dark — mimics PRIM's app sitting in the light chrome)
const D = {
  bg: '#0B1120', card: '#141C32', card2: '#1A2340', input: '#0E1530',
  border: 'rgba(124,134,176,.16)', text: '#E8EDF7', t2: '#9FB0CC', t3: '#6B7894',
  green: '#34D399', red: '#F87171', amber: '#FBBF24', viol: '#A78BFA',
  sky: '#22D3EE', blue: '#60A5FA', pink: '#F472B6', gray: '#9CA3AF',
};
const ACCENTS = {
  indigo:  { from: '#6366F1', to: '#8B5CF6', solid: '#6366F1', soft: 'rgba(99,102,241,.10)', glow: 'rgba(99,102,241,.30)', glow2: 'rgba(139,92,246,.24)' },
  emerald: { from: '#10B981', to: '#06B6D4', solid: '#10B981', soft: 'rgba(16,185,129,.11)', glow: 'rgba(16,185,129,.28)', glow2: 'rgba(6,182,212,.22)' },
  rose:    { from: '#F43F5E', to: '#FB7185', solid: '#F43F5E', soft: 'rgba(244,63,94,.11)', glow: 'rgba(244,63,94,.30)', glow2: 'rgba(251,113,133,.24)' },
  amber:   { from: '#D4A017', to: '#F0B429', solid: '#C8920F', soft: 'rgba(212,160,23,.13)', glow: 'rgba(212,160,23,.30)', glow2: 'rgba(240,180,41,.24)' },
  teal:    { from: '#14B8A6', to: '#22D3EE', solid: '#14B8A6', soft: 'rgba(20,184,166,.12)', glow: 'rgba(20,184,166,.28)', glow2: 'rgba(34,211,238,.22)' },
};
const FONT = "'Plus Jakarta Sans', system-ui, sans-serif"; // map to PRIM's stack if different

const TABS = ['cpa', 'deals', 'prospects', 'portal', 'books', 'uploads'];
const TAB_LABEL = { cpa: 'CPA Dashboard', deals: 'Closed Deals', prospects: 'Prospects', portal: 'Portal Clients', books: 'Books', uploads: 'Upload' };
// Full nav order in the app shell; non-priority tabs render muted/non-interactive.
const NAV_ORDER = [
  { id: 'cpa', label: 'CPA Dashboard' }, { id: 'deals', label: 'Closed Deals' },
  { m: 'Overview' }, { m: 'Associations' }, { id: 'portal', label: 'Portal Clients' },
  { m: 'Pipeline' }, { id: 'prospects', label: 'Prospects' }, { m: 'Platforms' },
  { id: 'books', label: 'Books' }, { m: 'Reports' }, { m: 'Calculator' },
  { id: 'uploads', label: 'Upload' },
];

/* ------------------------------------------------------------------ keyframes (inject once) */
const KEYFRAMES = `
@keyframes pof-fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@keyframes pof-rowIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes pof-scanDown{0%{transform:translateY(-100%)}100%{transform:translateY(420%)}}
@keyframes pof-confetti{0%{transform:translate3d(0,-15vh,0) rotate(0);opacity:0}8%{opacity:1}90%{opacity:1}100%{transform:translate3d(var(--dx,0),115vh,0) rotate(var(--rot,720deg));opacity:0}}
@keyframes pof-pop{0%{opacity:0;transform:scale(.7)}60%{transform:scale(1.06)}100%{opacity:1;transform:scale(1)}}
@keyframes pof-glow{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:.85;transform:scale(1.1)}}
@keyframes pof-orb{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(40px,-30px,0) scale(1.08)}}
@media (prefers-reduced-motion:reduce){[data-pof] *{animation-duration:.001ms!important}}
`;

/* ------------------------------------------------------------------ tiny helpers */
// PRIM's real colored app icon (dark tile + gradient prism + refracted beams).
const Prism = ({ size = 22 }) => <PrimAppIcon size={size} />;
const Check = ({ s = 11, c = '#fff' }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4 4 10-10" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Arrow = ({ c = '#fff' }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/* ================================================================== component */
export default function OnboardingFlow({ open = true, onComplete, onSkip }) {
  const [step, setStep] = useState(0);            // 0..4
  const [name, setName] = useState('');
  const [accent, setAccent] = useState('indigo');
  const [mode, setMode] = useState('light');      // light | system | dark
  const [settingsTab, setSettingsTab] = useState('identity');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('cpa');
  const [visited, setVisited] = useState(['cpa']);
  const [importState, setImportState] = useState('idle'); // idle | reading | done
  const [showNewLead, setShowNewLead] = useState(false);
  const [confetti, setConfetti] = useState([]);

  // Seed from + persist to PRIM's real agent profile (theme / accent / display name).
  const profileRef = useRef(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await loadAgentProfile();
        if (!alive || !p) return;
        profileRef.current = p;
        if (p.displayName) setName(p.displayName);
        if (ACCENTS[p.accent]) setAccent(p.accent);
        if (['light', 'system', 'dark'].includes(p.theme)) setMode(p.theme);
      } catch { /* fall back to defaults */ }
    })();
    return () => { alive = false; };
  }, []);

  const a = ACCENTS[accent];
  const firstName = (name.trim().split(/\s+/)[0]) || 'agent';
  const displayName = name.trim() || 'Your name';
  const initials = name.trim().split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '✦';

  /* gating */
  const canContinue = useMemo(() => {
    switch (step) {
      case 0: return settingsSaved && name.trim().length > 0;
      case 1: return TABS.every(t => visited.includes(t));
      case 3: return importState === 'done';
      default: return true;
    }
  }, [step, settingsSaved, name, visited, importState]);

  const gateMsg = (() => {
    switch (step) {
      case 0: return !name.trim() ? 'Enter your display name in Identity to continue' : 'Save your settings to continue';
      case 1: return 'Open all six tabs to continue';
      case 3: return 'Run Smart Import to continue';
      default: return '';
    }
  })();

  const celebrate = useCallback(() => {
    const colors = ['#22D3EE', '#A78BFA', '#F472B6', '#6366F1', '#FBBF24', '#34D399', '#FB7185'];
    setConfetti(Array.from({ length: 120 }).map((_, i) => {
      const circle = Math.random() < 0.32;
      const sz = 6 + Math.random() * 6;
      return {
        id: i,
        style: {
          position: 'absolute', top: `${-8 - Math.random() * 22}vh`, left: `${Math.random() * 100}%`,
          width: `${circle ? sz : 4 + Math.random() * 5}px`, height: `${circle ? sz : 9 + Math.random() * 10}px`,
          background: colors[i % colors.length], borderRadius: circle ? '50%' : '1.5px', opacity: 0,
          '--dx': `${Math.round(Math.random() * 240) - 120}px`, '--rot': `${Math.round(360 + Math.random() * 960)}deg`,
          animation: `pof-confetti ${(2.8 + Math.random() * 2.6).toFixed(2)}s ${(Math.random() * 0.5).toFixed(2)}s linear forwards`,
        },
      };
    }));
  }, []);

  const next = () => {
    if (step >= 4 || !canContinue) return;
    const ns = step + 1;
    setStep(ns);
    if (ns === 4) setTimeout(celebrate, 80);
  };
  const back = () => setStep(s => Math.max(0, s - 1));

  const selectTab = (id) => { setActiveTab(id); setVisited(v => v.includes(id) ? v : [...v, id]); setShowNewLead(false); };
  const runImport = () => { setImportState('reading'); setTimeout(() => setImportState('done'), 2200); };

  // Live-preview the choice on the real app immediately; persisted on Save changes.
  const chooseMode = (m) => { setMode(m); try { applyThemeToDOM(m); } catch { /* ignore */ } };
  const chooseAccent = (key) => { setAccent(key); try { applyAccentToDOM(key); } catch { /* ignore */ } };

  const saveSettings = async () => {
    setSettingsSaved(true);
    // Merge into the existing profile (saveAgentProfile replaces the whole
    // object), then persist. Display name only overrides when non-empty.
    try {
      const base = profileRef.current || (await loadAgentProfile()) || {};
      const saved = await saveAgentProfile({
        ...base,
        theme: mode,
        accent,
        displayName: name.trim() || base.displayName || '',
      });
      profileRef.current = saved;
    } catch { /* persistence is best-effort; never block the flow */ }
  };

  const restart = () => {
    setStep(0); setImportState('idle'); setVisited(['cpa']); setActiveTab('cpa');
    setShowNewLead(false); setSettingsTab('identity'); setSettingsSaved(false);
    setConfetti([]);
  };

  const finish = async () => {
    if (onComplete) await onComplete();   // → markCompleted()
    else celebrate();
  };

  if (!open) return null;

  /* CSS vars drive accent recolor everywhere */
  const rootVars = {
    '--pof-from': a.from, '--pof-to': a.to, '--pof-accent': a.solid, '--pof-soft': a.soft,
    '--pof-glow': a.glow, '--pof-glow2': a.glow2,
  };

  return (
    <div data-pof role="dialog" aria-modal="true" aria-label="PRIM onboarding"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, overflowY: 'auto',
        background: LIGHT.base, color: LIGHT.text, fontFamily: FONT, ...rootVars,
      }}>
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      {/* ambient orbs */}
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
        <div style={{ position: 'absolute', width: '46vw', height: '46vw', left: '-10vw', top: '-12vw', borderRadius: '50%', filter: 'blur(90px)', background: `radial-gradient(circle, ${a.glow}, transparent 65%)`, animation: 'pof-orb 26s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', width: '40vw', height: '40vw', right: '-12vw', bottom: '-14vw', borderRadius: '50%', filter: 'blur(100px)', background: `radial-gradient(circle, ${a.glow2}, transparent 65%)`, animation: 'pof-orb 32s ease-in-out infinite reverse' }} />
      </div>

      {/* top bar */}
      <div style={{ position: 'relative', zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 30px', maxWidth: 1180, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, boxShadow: `0 8px 22px -8px ${a.glow}`, lineHeight: 0 }}><Prism size={38} /></div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '.04em' }}>PRIM</div>
            <div style={{ fontSize: 10.5, color: LIGHT.text3, letterSpacing: '.16em', textTransform: 'uppercase' }}>Agent Onboarding</div>
          </div>
        </div>
        {onSkip && <button onClick={onSkip} style={{ background: 'none', border: 'none', color: LIGHT.text3, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Skip for now</button>}
      </div>

      {/* progress rail */}
      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1180, margin: '0 auto', width: '100%', padding: '0 30px 8px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1, height: 6, borderRadius: 999, background: LIGHT.surface2, overflow: 'hidden', border: `1px solid ${LIGHT.border}` }}>
          <div style={{ height: '100%', borderRadius: 999, background: `linear-gradient(90deg, ${a.from}, ${a.to})`, transition: 'width .55s cubic-bezier(.22,1,.36,1)', width: `${(step / 4) * 100}%` }} />
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: LIGHT.text2, letterSpacing: '.08em', whiteSpace: 'nowrap' }}>Step {step + 1} of 5</div>
      </div>

      {/* stage */}
      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1180, margin: '0 auto', width: '100%', padding: '14px 30px 40px', minHeight: 560 }}>
        {step === 0 && <StepSettings {...{ D, name, setName, displayName, initials, settingsTab, setSettingsTab, mode, chooseMode, accent, chooseAccent, saveSettings, settingsSaved }} />}
        {step === 1 && <StepTour {...{ D, activeTab, visited, selectTab, showNewLead, setShowNewLead }} />}
        {step === 2 && <StepPlatforms D={D} />}
        {step === 3 && <StepImport {...{ D, importState, runImport }} />}
        {step === 4 && <StepUnlock {...{ firstName, confetti, finish, restart }} />}
      </div>

      {/* footer */}
      {step >= 0 && step <= 3 && (
        <div style={{ position: 'relative', zIndex: 5, maxWidth: 1180, margin: '0 auto', width: '100%', padding: '0 30px 34px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button onClick={back} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '12px 20px', borderRadius: 12, cursor: 'pointer', border: `1px solid ${LIGHT.border}`, background: LIGHT.surface, fontSize: 14, fontWeight: 600, color: LIGHT.text2, visibility: step <= 0 ? 'hidden' : 'visible' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M11 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> Back
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ height: 7, borderRadius: 999, transition: 'all .35s', width: i === step ? 26 : 7, background: i === step ? a.solid : (i < step ? a.soft : LIGHT.border), boxShadow: i === step ? `0 0 0 3px ${a.soft}` : 'none' }} />
              ))}
            </div>
            <button onClick={next} disabled={!canContinue} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 26px', borderRadius: 12, border: 'none', fontSize: 14.5, fontWeight: 700, cursor: canContinue ? 'pointer' : 'not-allowed', background: canContinue ? `linear-gradient(135deg, ${a.from}, ${a.to})` : LIGHT.surface2, color: canContinue ? '#fff' : LIGHT.text3, boxShadow: canContinue ? `0 12px 30px -12px ${a.glow}` : 'none', opacity: canContinue ? 1 : .7, transition: 'all .2s' }}>
              Continue <Arrow c={canContinue ? '#fff' : LIGHT.text3} />
            </button>
          </div>
          {!canContinue && <div style={{ textAlign: 'right', marginTop: 8, fontSize: 12, color: LIGHT.text3, fontStyle: 'italic' }}>{gateMsg}</div>}
        </div>
      )}
    </div>
  );
}

/* ============================================================ STEP 1 — settings */
function StepSettings({ D, name, setName, displayName, initials, settingsTab, setSettingsTab, mode, chooseMode, accent, chooseAccent, saveSettings, settingsSaved }) {
  // Illustrative preference state — mirrors PRIM's real Preferences panel
  // (teach-only here; the live values are saved in Settings).
  const [prefLang, setPrefLang] = useState('en');
  const [prefSource, setPrefSource] = useState('');
  const [prefDigest, setPrefDigest] = useState('weekly');
  const [prefUpdates, setPrefUpdates] = useState(true);
  const navItems = [['identity', 'Identity'], ['sub', 'Subscription'], ['email', 'Email sender'], ['notif', 'Notifications'], ['appearance', 'Appearance'], ['prefs', 'Preferences']];
  const lab = { display: 'block', fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: D.t2, marginBottom: 7 };
  const inC = { width: '100%', padding: '12px 13px', background: D.input, border: `1px solid rgba(124,134,176,.2)`, borderRadius: 9, color: D.text, fontSize: 13.5, fontFamily: FONT, boxSizing: 'border-box', outline: 'none' };

  return (
    <div style={{ animation: 'pof-fadeUp .45s ease both' }}>
      <Eyebrow>Step 1 · Your settings</Eyebrow>
      <H2>Set up your profile &amp; preferences.</H2>
      <Sub>Your Profile hub — identity, email sender, appearance, and the CRMs you pay for. Click the tabs, then <b style={{ color: 'var(--pof-accent)' }}>Save changes</b> to finish.</Sub>

      <AppWindow D={D}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', background: 'linear-gradient(120deg,#0E1B33,#163048,#101a30)', borderBottom: `1px solid ${D.border}` }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: `linear-gradient(135deg, var(--pof-from), var(--pof-to))`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 16, flex: '0 0 auto' }}>{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 17, color: '#fff', whiteSpace: 'nowrap' }}>{displayName}</span>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.04em', padding: '3px 9px', borderRadius: 999, background: 'rgba(52,211,153,.16)', color: D.green, border: '1px solid rgba(52,211,153,.4)', whiteSpace: 'nowrap' }}>✓ COMPLIMENTARY</span>
            </div>
            <div style={{ fontSize: 12, color: D.t2 }}>@ jordan.ellis@gmail.com</div>
          </div>
        </div>
        {/* body */}
        <div style={{ display: 'grid', gridTemplateColumns: '212px 1fr', minHeight: 392 }}>
          <div style={{ background: '#0B1322', borderRight: `1px solid ${D.border}`, padding: '16px 13px' }}>
            {navItems.map(([id, label]) => {
              const on = settingsTab === id;
              return <button key={id} onClick={() => setSettingsTab(id)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 9, marginBottom: 2, border: `1px solid ${on ? 'rgba(124,134,176,.2)' : 'transparent'}`, background: on ? 'rgba(124,134,176,.1)' : 'transparent', color: on ? 'var(--pof-accent)' : D.t2, fontFamily: FONT, fontSize: 13, fontWeight: on ? 700 : 600, cursor: 'pointer' }}>{label}</button>;
            })}
          </div>
          <div style={{ padding: '24px 26px', maxHeight: 392, overflow: 'auto' }}>
            {settingsTab === 'identity' && (
              <Panel>
                <H3 D={D}>Identity</H3><PDesc D={D}>How you appear inside PRIM. Display name feeds {'{agent_name}'} in your email templates.</PDesc>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div style={{ marginBottom: 16 }}><label style={lab}>Display Name</label>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jordan Ellis" style={inC} /></div>
                  <div style={{ marginBottom: 16 }}><label style={lab}>Account Email</label>
                    <div style={{ ...inC, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: D.t3 }}>jordan.ellis@gmail.com 🔒</div></div>
                </div>
                <div style={{ maxWidth: '50%' }}><label style={lab}>Phone</label><input placeholder="(305) 555-0148" style={inC} /></div>
              </Panel>
            )}
            {settingsTab === 'sub' && (
              <Panel><H3 D={D}>Subscription</H3><PDesc D={D}>PRIM plans — pick what fits as you grow. Your access is set by your agency.</PDesc>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  {['starter', 'pro', 'team'].map(key => {
                    const pl = PLAN_DISPLAY[key]; const hot = !!pl.popular;
                    return (
                      <div key={key} style={{ position: 'relative', background: D.input, border: `1.5px solid ${hot ? 'var(--pof-accent)' : 'rgba(124,134,176,.2)'}`, borderRadius: 12, padding: '16px 14px' }}>
                        {hot && <span style={{ position: 'absolute', top: -9, left: 14, fontSize: 8.5, fontWeight: 800, letterSpacing: '.05em', padding: '3px 8px', borderRadius: 999, background: 'linear-gradient(135deg, var(--pof-from), var(--pof-to))', color: '#fff' }}>MOST POPULAR</span>}
                        <div style={{ fontSize: 14, fontWeight: 800, color: D.text }}>{pl.name}</div>
                        <div style={{ fontSize: 21, fontWeight: 800, color: D.text, marginTop: 6 }}>${pl.monthly}<span style={{ fontSize: 11, fontWeight: 600, color: D.t3 }}> /mo</span></div>
                        <div style={{ fontSize: 10.5, color: D.t2, marginTop: 7, lineHeight: 1.4 }}>{pl.tagline}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: D.t3, marginTop: 12 }}>Upgrade or change anytime in Settings → Subscription.</div>
              </Panel>
            )}
            {settingsTab === 'email' && (
              <Panel><H3 D={D}>Email sender identity</H3><PDesc D={D}>How outbound post-sale emails appear to your customers. Blank = PRIM default.</PDesc>
                <div style={{ display: 'flex', gap: 10, background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 11, padding: '12px 14px', marginBottom: 20 }}>
                  <span style={{ color: D.amber }}>🛡</span><div style={{ fontSize: 11.5, color: D.amber, lineHeight: 1.5 }}><b>Domain verification required.</b> Custom From addresses only work on a Resend-verified domain.</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div><label style={lab}>From Name</label><div style={inC}>Jordan Ellis</div></div>
                  <div><label style={lab}>From Address</label><div style={inC}>jordan@jellisinsurance.com</div></div>
                </div>
              </Panel>
            )}
            {settingsTab === 'notif' && (
              <Panel><H3 D={D}>Notifications</H3><PDesc D={D}>Choose what PRIM nudges you about.</PDesc>
                <Toggle D={D} label="Outreach reminders" sub="Get pinged when a prospect follow-up is due." on />
                <Toggle D={D} label="Weekly summary email" sub="Monday recap of your CPA, deals, and pipeline." on />
                <Toggle D={D} label="Statement-match alerts" sub="Notify when an uploaded statement auto-matches a deal." />
              </Panel>
            )}
            {settingsTab === 'appearance' && (
              <Panel><H3 D={D}>Appearance</H3><PDesc D={D}>Theme + accent flow across the PRIM logo, your avatar, and the whole app.</PDesc>
                <label style={lab}>Theme</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                  {[['light', 'Light', '☀'], ['system', 'System', '▢'], ['dark', 'Dark', '☾']].map(([c, l, ic]) => {
                    const on = mode === c;
                    return <button key={c} onClick={() => chooseMode(c)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 10, borderRadius: 9, border: `1px solid ${on ? 'var(--pof-accent)' : 'rgba(124,134,176,.2)'}`, background: on ? 'var(--pof-soft)' : 'rgba(124,134,176,.05)', color: on ? 'var(--pof-accent)' : D.t2, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{ic} {l}</button>;
                  })}
                </div>
                <label style={lab}>Accent palette</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10 }}>
                  {[['indigo', 'Indigo', 'Classic PRIM — calm + focused.'], ['emerald', 'Emerald', 'Money green. Growth-oriented.'], ['rose', 'Rose', 'Warm energy. Stands out.'], ['amber', 'Amber', 'Sunset gold. Premium.'], ['teal', 'Teal', 'Cool ocean. Clean + modern.']].map(([k, nm, ds]) => {
                    const on = accent === k; const ac = ACCENTS[k];
                    return <button key={k} onClick={() => chooseAccent(k)} style={{ textAlign: 'left', padding: 12, borderRadius: 12, cursor: 'pointer', border: `1.5px solid ${on ? 'var(--pof-accent)' : 'rgba(124,134,176,.18)'}`, background: on ? 'var(--pof-soft)' : 'rgba(124,134,176,.05)' }}>
                      <div style={{ height: 46, borderRadius: 9, background: `linear-gradient(135deg, ${ac.from}, ${ac.to})`, marginBottom: 9 }} />
                      <div style={{ fontSize: 13, fontWeight: 700, color: D.text, marginBottom: 2 }}>{nm}</div>
                      <div style={{ fontSize: 10.5, color: '#8A95B5', lineHeight: 1.35 }}>{ds}</div>
                    </button>;
                  })}
                </div>
              </Panel>
            )}
            {settingsTab === 'prefs' && (
              <Panel><H3 D={D}>Preferences</H3><PDesc D={D}>Day-to-day defaults — Assistant language, your lead-form default, and email preferences. (Illustrative here; saved for real in Settings.)</PDesc>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: D.input, border: `1px solid ${D.border}`, borderRadius: 11, padding: '13px 15px', marginBottom: 10 }}>
                  <div><div style={{ fontSize: 13, fontWeight: 600, color: D.text }}>PRIM Assistant language</div><div style={{ fontSize: 11, color: D.t3, marginTop: 2 }}>Drives chatbot replies, voice, and proactive starters.</div></div>
                  <div style={{ display: 'flex', gap: 3, background: 'rgba(124,134,176,.12)', borderRadius: 8, padding: 3, flex: '0 0 auto' }}>
                    {[['en', 'English'], ['es', 'Español']].map(([k, l]) => (
                      <button key={k} onClick={() => setPrefLang(k)} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: prefLang === k ? 'var(--pof-accent)' : 'transparent', color: prefLang === k ? '#fff' : D.t2 }}>{l}</button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: D.input, border: `1px solid ${D.border}`, borderRadius: 11, padding: '13px 15px', marginBottom: 10 }}>
                  <div><div style={{ fontSize: 13, fontWeight: 600, color: D.text }}>Default lead source</div><div style={{ fontSize: 11, color: D.t3, marginTop: 2 }}>Pre-selects this when you open the lead form.</div></div>
                  <select value={prefSource} onChange={e => setPrefSource(e.target.value)} style={{ ...inC, width: 190, padding: '9px 11px', flex: '0 0 auto' }}>
                    <option value="">No default (pick each time)</option>
                    <option value="Referral">Referral</option>
                    <option value="Web Lead">Web Lead</option>
                    <option value="Benepath">Benepath</option>
                    <option value="Aged Lead">Aged Lead</option>
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: D.input, border: `1px solid ${D.border}`, borderRadius: 11, padding: '13px 15px', marginBottom: 10 }}>
                  <div><div style={{ fontSize: 13, fontWeight: 600, color: D.text }}>Weekly digest email</div><div style={{ fontSize: 11, color: D.t3, marginTop: 2 }}>Monday recap of your CPA, deals, and pipeline.</div></div>
                  <div style={{ display: 'flex', gap: 3, background: 'rgba(124,134,176,.12)', borderRadius: 8, padding: 3, flex: '0 0 auto' }}>
                    {[['weekly', 'Weekly'], ['never', 'Never']].map(([k, l]) => (
                      <button key={k} onClick={() => setPrefDigest(k)} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: prefDigest === k ? 'var(--pof-accent)' : 'transparent', color: prefDigest === k ? '#fff' : D.t2 }}>{l}</button>
                    ))}
                  </div>
                </div>
                <button onClick={() => setPrefUpdates(v => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', textAlign: 'left', background: D.input, border: `1px solid ${D.border}`, borderRadius: 11, padding: '13px 15px', cursor: 'pointer' }}>
                  <div><div style={{ fontSize: 13, fontWeight: 600, color: D.text }}>Product update emails</div><div style={{ fontSize: 11, color: D.t3, marginTop: 2 }}>Heads-up when new features ship. ~1–2 / month.</div></div>
                  <span style={{ width: 38, height: 21, borderRadius: 999, position: 'relative', flex: '0 0 auto', background: prefUpdates ? 'var(--pof-accent)' : 'rgba(124,134,176,.3)' }}><span style={{ position: 'absolute', top: 2, left: prefUpdates ? 19 : 2, width: 17, height: 17, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} /></span>
                </button>
              </Panel>
            )}
          </div>
        </div>
        {/* footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 20px', background: D.input, borderTop: `1px solid ${D.border}` }}>
          <button onClick={saveSettings} style={{ padding: '11px 22px', borderRadius: 11, border: 'none', background: `linear-gradient(135deg, var(--pof-from), var(--pof-to))`, color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', boxShadow: `0 12px 28px -12px var(--pof-glow)` }}>{settingsSaved ? '✓ Saved' : '💾 Save changes'}</button>
        </div>
      </AppWindow>
    </div>
  );
}

/* ============================================================ STEP 2 — tour */
function StepTour({ D, activeTab, visited, selectTab, showNewLead, setShowNewLead }) {
  return (
    <div style={{ animation: 'pof-fadeUp .45s ease both' }}>
      <Eyebrow>Step 2 · The grand tour</Eyebrow>
      <H2>This is the real app. Open each highlighted tab.</H2>
      <Sub>Click all six glowing tabs to continue — <b style={{ color: 'var(--pof-accent)' }}>{visited.length} of 6</b> explored. <span style={{ color: LIGHT.text3 }}>(Sample data — no real client info.)</span></Sub>

      <AppWindow D={D}>
        <AppNav D={D} activeTab={activeTab} visited={visited} onSelect={selectTab} />
        <div style={{ background: D.bg, minHeight: 430, maxHeight: 460, overflow: 'auto', padding: '22px 24px', position: 'relative' }}>
          {activeTab === 'cpa' && <TourCPA D={D} />}
          {activeTab === 'deals' && <TourDeals D={D} />}
          {activeTab === 'portal' && <TourPortal D={D} onNewLead={() => setShowNewLead(true)} />}
          {activeTab === 'prospects' && <TourProspects D={D} onNewLead={() => setShowNewLead(true)} />}
          {activeTab === 'books' && <TourBooks D={D} />}
          {activeTab === 'uploads' && <TourUploads D={D} />}
        </div>
        {showNewLead && <NewLeadModal D={D} onClose={() => setShowNewLead(false)} />}
      </AppWindow>
    </div>
  );
}

/* ============================================================ STEP 3 — platforms */
function StepPlatforms({ D }) {
  const PUR = D.viol, RED = D.red, BLU = D.blue, GRN = D.green;
  const lab = { fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: D.t3 };
  const card = { background: D.card, border: `1px solid ${D.border}`, borderRadius: 12 };
  const kpis = [['$ YTD spent', '$22,257.62', '6 months logged'], ['↗ Projected annual', '$44,515', 'Run-rate × 12 · 6 mo avg'], ['▦ June 2026 total', '$2,037.49', '−$1,559 vs prev month'], ['◷ Monthly budget', '$1,962.51', 'remaining this month']];
  const plats = [['TextDrip', PUR, '$887.49', '$207.08 / wk · 6 entries'], ['Ringy', RED, '$1,150.00', '$268.33 / wk · 13 entries'], ['VanillaSoft', BLU, '$0.00', '$0 / wk · 0 entries'], ['OnlySales', GRN, '$0.00', '$0 / wk · 0 entries']];
  const months = [62, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; const md = { 0: 62, 1: 85, 2: 80, 3: 88, 4: 66, 5: 46 };

  return (
    <div style={{ animation: 'pof-fadeUp .45s ease both' }}>
      <Eyebrow>Step 3 · Your platform costs</Eyebrow>
      <H2>See what your tools really cost.</H2>
      <Sub>The <b style={{ color: 'var(--pof-accent)' }}>Platforms</b> tab turns your CRM charges into a live spend dashboard — what drives your true cost-per-deal. <span style={{ color: LIGHT.text3 }}>(Sample data.)</span></Sub>

      <AppWindow D={D}>
        <AppNav D={D} highlightMuted="Platforms" />
        <div style={{ background: D.bg, maxHeight: 452, overflow: 'auto', padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'rgba(124,134,176,.06)', border: `1px solid ${D.border}`, borderRadius: 11, padding: '11px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: D.t2 }}><span style={{ color: 'var(--pof-accent)' }}>ⓘ</span> Platform charges are managed in <b style={{ color: D.text }}>Books</b>. This page is your visual dashboard.</div>
            <span style={{ flex: '0 0 auto', padding: '7px 13px', borderRadius: 9, background: `linear-gradient(135deg, var(--pof-from), var(--pof-to))`, color: '#fff', fontSize: 11.5, fontWeight: 700 }}>▥ Open Books</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 14 }}>
            {kpis.map(([l, big, sub]) => (
              <div key={l} style={{ ...card, padding: '14px 15px' }}>
                <div style={{ ...lab, marginBottom: 8 }}>{l}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: D.text, lineHeight: 1.05 }}>{big}</div>
                <div style={{ fontSize: 11, color: D.t3, marginTop: 4 }}>{sub}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
            {plats.map(([nm, dot, amt, sub]) => (
              <div key={nm} style={{ ...card, padding: '15px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: D.text, marginBottom: 9 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: dot }} />{nm}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: D.text, lineHeight: 1 }}>{amt}</div>
                <div style={{ fontSize: 11, color: D.t3, marginTop: 5 }}>{sub}</div>
              </div>
            ))}
          </div>
          {/* monthly bar chart */}
          <div style={{ ...card, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, fontSize: 12.5, color: D.t2 }}><span><b style={{ color: D.text }}>2026</b> · $22,257.62 total</span>
              <span style={{ display: 'flex', gap: 12, fontSize: 10.5 }}><Legend c={PUR}>TextDrip</Legend><Legend c={RED}>Ringy</Legend><Legend c={BLU}>VanillaSoft</Legend></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
              {months.map((_, i) => {
                const h = md[i]; const active = i === 5;
                return <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: '100%', maxWidth: 46, height: 120, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    {h ? <>
                      <div style={{ height: `${Math.round(h * .03)}%`, background: BLU, borderRadius: '3px 3px 0 0' }} />
                      <div style={{ height: `${Math.round(h * .52)}%`, background: RED }} />
                      <div style={{ height: `${Math.round(h * .45)}%`, background: PUR, borderRadius: '0 0 3px 3px' }} />
                    </> : <div style={{ height: 3, background: 'rgba(124,134,176,.18)', borderRadius: 2 }} />}
                  </div>
                  <div style={{ fontSize: 10, color: active ? 'var(--pof-accent)' : D.t3, fontWeight: active ? 700 : 500 }}>{String(i + 1).padStart(2, '0')}</div>
                </div>;
              })}
            </div>
          </div>
        </div>
      </AppWindow>
    </div>
  );
}

/* ============================================================ STEP 4 — import */
function StepImport({ D, importState, runImport }) {
  const rows = [
    ['Martinez, Carlos', 'Premier Plan', '$1,240', 'New Business'],
    ['Nguyen, Lía', 'Secure Health 80', '$910', 'New Business'],
    ["O'Brien, Dana", 'Accident Companion', '$142', 'Ancillary'],
    ['Patel, Rajesh', 'Income Protector', '$268', 'New Business'],
    ['Brooks (sp. Reed)', 'Life Protector', '$415', 'Auto-matched'],
  ];
  return (
    <div style={{ animation: 'pof-fadeUp .45s ease both', maxWidth: 760, margin: '0 auto' }}>
      <div style={{ textAlign: 'center' }}><Eyebrow>Step 4 · The magic moment</Eyebrow><H2>See Smart Import work.</H2>
        <Sub>The feature agents love most. Drop a statement → AI reads every line. Try it on this sample.</Sub></div>
      <div style={{ background: '#fff', border: `1px solid ${LIGHT.border}`, borderRadius: 22, boxShadow: '0 40px 80px -34px rgba(99,102,241,.45)', padding: 26 }}>
        {importState === 'idle' && (
          <button onClick={runImport} style={{ width: '100%', border: `2px dashed var(--pof-accent)`, borderRadius: 16, padding: '40px 20px', background: 'var(--pof-soft)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: `linear-gradient(135deg, var(--pof-from), var(--pof-to))`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 12px 28px -10px var(--pof-glow)` }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M12 16V5M8 9l4-4 4 4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 19h14" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></svg>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: LIGHT.text }}>Drop USHA-statement-wk42.pdf</div>
            <div style={{ fontSize: 13, color: LIGHT.text2 }}>Click to simulate dropping the sample file</div>
          </button>
        )}
        {importState === 'reading' && (
          <div style={{ textAlign: 'center', padding: '30px 10px' }}>
            <div style={{ position: 'relative', width: 120, height: 150, margin: '0 auto 20px', borderRadius: 10, background: LIGHT.surface2, border: `1px solid ${LIGHT.border}`, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, right: 0, height: 38, background: `linear-gradient(180deg,transparent,var(--pof-soft),var(--pof-accent),var(--pof-soft),transparent)`, opacity: .9, animation: 'pof-scanDown 1.3s ease-in-out infinite' }} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: LIGHT.text }}>AI is reading your statement…</div>
            <div style={{ fontSize: 13, color: LIGHT.text2 }}>Extracting deals, premiums and advances</div>
          </div>
        )}
        {importState === 'done' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ width: 30, height: 30, borderRadius: '50%', background: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check s={16} /></div><b style={{ fontSize: 15, color: LIGHT.text }}>5 deals found · $2,975 in advances</b></div>
              <div style={{ fontSize: 12, color: LIGHT.text3, letterSpacing: '.08em' }}>PREVIEW · nothing saved yet</div>
            </div>
            <div style={{ border: `1px solid ${LIGHT.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.3fr .8fr 1fr', background: LIGHT.surface2, padding: '9px 14px', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: LIGHT.text3, fontWeight: 700 }}>Client<span>Product</span><span style={{ textAlign: 'right' }}>Advance</span><span style={{ textAlign: 'right' }}>Category</span></div>
              {rows.map((r, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.3fr .8fr 1fr', padding: '11px 14px', fontSize: 13, color: LIGHT.text, borderTop: `1px solid ${LIGHT.border}`, animation: `pof-rowIn .45s ${i * .09}s ease both` }}>{r[0]}<span style={{ color: LIGHT.text2 }}>{r[1]}</span><span style={{ textAlign: 'right', fontWeight: 700 }}>{r[2]}</span><span style={{ textAlign: 'right', color: 'var(--pof-accent)', fontWeight: 600 }}>{r[3]}</span></div>
              ))}
            </div>
            <div style={{ fontSize: 12.5, color: LIGHT.text2, marginTop: 12, textAlign: 'center' }}>It even caught the deal USHA paid under a spouse's name. Confirm to file them all.</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================ STEP 5 — unlock */
function StepUnlock({ firstName, confetti, finish, restart }) {
  return (
    <div style={{ animation: 'pof-fadeUp .45s ease both', position: 'relative', textAlign: 'center', maxWidth: 620, margin: '0 auto', paddingTop: 20 }}>
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 40 }}>
        {confetti.map(c => <div key={c.id} style={c.style} />)}
      </div>
      <div style={{ position: 'relative', display: 'inline-flex', marginBottom: 24, animation: 'pof-pop .6s ease both' }}>
        <div style={{ position: 'absolute', inset: -30, borderRadius: '50%', background: `radial-gradient(circle, var(--pof-glow), transparent 65%)`, animation: 'pof-glow 4s ease-in-out infinite' }} />
        <div style={{ position: 'relative', width: 96, height: 96, borderRadius: 26, boxShadow: `0 24px 50px -16px var(--pof-glow)`, lineHeight: 0 }}><Prism size={96} /></div>
      </div>
      <h2 style={{ fontWeight: 700, fontSize: 42, letterSpacing: '-.02em', color: LIGHT.text, margin: '0 0 12px' }}>You're ready, {firstName}.</h2>
      <p style={{ fontSize: 17, lineHeight: 1.6, color: LIGHT.text2, margin: '0 auto 28px', maxWidth: 460 }}>You've set up your profile, toured every tab, and seen Smart Import in action. The app is unlocked — go close some deals.</p>
      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={finish} style={{ background: `linear-gradient(135deg, var(--pof-from), var(--pof-to))`, color: '#fff', border: 'none', padding: '16px 38px', borderRadius: 14, fontWeight: 700, fontSize: 16, cursor: 'pointer', boxShadow: `0 16px 38px -14px var(--pof-glow)`, display: 'inline-flex', alignItems: 'center', gap: 10 }}>Enter PRIM <Arrow /></button>
        <button onClick={restart} style={{ background: '#fff', color: LIGHT.text2, border: `1px solid ${LIGHT.border}`, padding: '16px 26px', borderRadius: 14, fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>Replay tour</button>
      </div>
    </div>
  );
}

/* ============================================================ shared pieces */
function AppWindow({ D, children }) {
  return <div style={{ position: 'relative', background: D.bg, border: `1px solid rgba(124,134,176,.2)`, borderRadius: 18, boxShadow: '0 40px 90px -42px rgba(8,12,26,.7)', overflow: 'hidden' }}>{children}</div>;
}
function AppNav({ D, activeTab, visited = [], onSelect, highlightMuted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 16px', background: 'linear-gradient(180deg,#171D38,#0E1428)', borderBottom: `1px solid ${D.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: '0 0 auto' }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, lineHeight: 0 }}><Prism size={30} /></div>
        <div><div style={{ fontWeight: 700, fontSize: 13, color: '#fff', lineHeight: 1 }}>PRIM</div><div style={{ fontSize: 8.5, color: '#5C688C', letterSpacing: '.04em' }}>Performance · Revenue</div></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflowX: 'auto', flex: 1, padding: '2px 0' }}>
        {NAV_ORDER.map((n, i) => {
          if (n.m) {
            const hot = highlightMuted === n.m;
            return hot
              ? <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto', whiteSpace: 'nowrap', padding: '7px 12px', borderRadius: 9, background: `linear-gradient(135deg, var(--pof-from), var(--pof-to))`, color: '#fff', fontSize: 12.5, fontWeight: 700, boxShadow: `0 8px 20px -10px var(--pof-glow)` }}>$ {n.m}</span>
              : <span key={i} style={{ flex: '0 0 auto', whiteSpace: 'nowrap', padding: '7px 9px', color: '#5C688C', fontSize: 12.5, fontWeight: 600 }}>{n.m}</span>;
          }
          const on = activeTab === n.id; const seen = visited.includes(n.id);
          return <button key={i} onClick={() => onSelect && onSelect(n.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto', whiteSpace: 'nowrap', padding: '7px 11px', borderRadius: 9, border: `1px solid ${on ? 'transparent' : 'rgba(124,134,176,.18)'}`, background: on ? `linear-gradient(135deg, var(--pof-from), var(--pof-to))` : 'rgba(124,134,176,.06)', color: on ? '#fff' : '#AEBAD4', fontSize: 12.5, fontWeight: on ? 700 : 600, cursor: onSelect ? 'pointer' : 'default', boxShadow: on ? `0 8px 20px -10px var(--pof-glow)` : 'none' }}>
            {n.label}{seen && <span style={{ width: 14, height: 14, borderRadius: '50%', background: D.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Check s={9} /></span>}
          </button>;
        })}
      </div>
    </div>
  );
}
const Eyebrow = ({ children }) => <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--pof-accent)', marginBottom: 10, textAlign: 'center' }}>{children}</div>;
const H2 = ({ children }) => <h2 style={{ fontWeight: 700, fontSize: 30, letterSpacing: '-.01em', color: LIGHT.text, margin: '0 0 8px', textAlign: 'center' }}>{children}</h2>;
const Sub = ({ children }) => <p style={{ fontSize: 14.5, color: LIGHT.text2, margin: '0 0 18px', textAlign: 'center' }}>{children}</p>;
const Panel = ({ children }) => <div style={{ animation: 'pof-fadeUp .3s ease both' }}>{children}</div>;
const H3 = ({ D, children }) => <div style={{ fontWeight: 700, fontSize: 19, color: D.text, marginBottom: 4 }}>{children}</div>;
const PDesc = ({ D, children }) => <div style={{ fontSize: 12.5, color: '#8A95B5', lineHeight: 1.5, marginBottom: 20 }}>{children}</div>;
const Legend = ({ c, children }) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />{children}</span>;
function Toggle({ D, label, sub, on }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: D.input, border: `1px solid ${D.border}`, borderRadius: 11, padding: '13px 15px', marginBottom: 10 }}>
    <div><div style={{ fontSize: 13, fontWeight: 600, color: D.text }}>{label}</div><div style={{ fontSize: 11, color: D.t3, marginTop: 2 }}>{sub}</div></div>
    <span style={{ width: 38, height: 21, borderRadius: 999, position: 'relative', background: on ? 'var(--pof-accent)' : 'rgba(124,134,176,.3)' }}><span style={{ position: 'absolute', top: 2, left: on ? 19 : 2, width: 17, height: 17, borderRadius: '50%', background: '#fff' }} /></span>
  </div>;
}

/* ---- tour panels (sample data; all client info fictional) ---- */
function TourCPA({ D }) {
  const bars = [['Issued', 39, 66.1, D.green], ['Pending', 1, 1.7, D.amber], ['Declined', 4, 6.8, D.red], ['Not taken', 9, 15.3, D.gray], ['Withdrawn', 6, 10.2, D.viol]];
  return <Panel><H3 D={D}>Underwritten Taken Rate</H3>
    <div style={{ fontSize: 11.5, color: D.t3, marginBottom: 14 }}>Issued ÷ submitted · 60%+ target · over-50 excluded</div>
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24, alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 150, height: 150, borderRadius: '50%', background: `conic-gradient(${D.green} 0 66.1%, ${D.amber} 66.1% 67.8%, ${D.red} 67.8% 74.6%, ${D.gray} 74.6% 89.9%, ${D.viol} 89.9% 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 108, height: 108, borderRadius: '50%', background: D.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}><div style={{ fontSize: 28, fontWeight: 800, color: D.green }}>66.1%</div><div style={{ fontSize: 11, color: D.t3 }}>39 of 59</div></div>
        </div>
      </div>
      <div>{bars.map(([l, n, p, c]) => (
        <div key={l} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 28px 44px', gap: 10, alignItems: 'center', marginBottom: 9 }}>
          <span style={{ fontSize: 12, color: D.t2 }}>{l}</span>
          <span style={{ height: 9, borderRadius: 6, background: 'rgba(124,134,176,.14)', position: 'relative', overflow: 'hidden' }}><span style={{ position: 'absolute', inset: '0 auto 0 0', width: `${p}%`, background: c, borderRadius: 6 }} /></span>
          <span style={{ fontSize: 12, fontWeight: 700, color: D.text, textAlign: 'right' }}>{n}</span>
          <span style={{ fontSize: 11, color: D.t3, textAlign: 'right' }}>{p}%</span>
        </div>
      ))}</div>
    </div></Panel>;
}
function TourDeals({ D }) {
  const rows = [['Devin Cole', 'Issued', 'Premier Choice, Accident', '52Y2900110', '$0', D.green], ['Aaron Pike', 'Issued', 'Secure Advantage, Exec', '52Y2900200', '$0', D.green], ['Paula Greer', 'Issued', 'Health Access III', '02N2900330', '$340', D.green], ['Jerome Banks', 'Issued', 'Secure Advantage', '52Y2900360', '$1,076', D.green], ['Mathieu Renard', 'Not taken', 'Health Access III', '52Y2900390', '$1,008', D.amber]];
  return <Panel><H3 D={D}>Closed Deals Tracker</H3>
    <div style={{ fontSize: 11.5, color: D.t3, marginBottom: 16 }}><span style={{ color: D.green }}>57 Issued</span> · <span style={{ color: D.amber }}>2 Pending</span> · <span style={{ color: D.red }}>30 Lost</span> · Only Issued deals contribute advance</div>
    <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr .8fr 1.7fr .9fr .6fr', gap: 8, padding: '10px 12px', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: D.t3 }}><span>Name</span><span>Stage</span><span>Products</span><span>Policy #</span><span style={{ textAlign: 'right' }}>Advance</span></div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.3fr .8fr 1.7fr .9fr .6fr', gap: 8, padding: '9px 12px', borderTop: `1px solid ${D.border}`, fontSize: 12, color: D.text, alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>{r[0]}</span><span><span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'rgba(52,211,153,.14)', color: r[5] }}>{r[1]}</span></span>
          <span style={{ color: D.t2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r[2]}</span><span style={{ color: D.t2 }}>{r[3]}</span><span style={{ textAlign: 'right', fontWeight: 700 }}>{r[4]}</span>
        </div>
      ))}
    </div></Panel>;
}
function TourPortal({ D, onNewLead }) {
  const rows = [['Marcus Hale', 'mhale27@gmail.com · (305) 555-0142', '27', 'Pending', D.amber, 'Premier Advantage', '$215', '$0', D.t3], ['Aaron Pike', 'apike@gmail.com · (870) 555-0190', '38', 'Issued', D.green, 'Secure Advantage', '$440', '$0', D.t3], ['Paula Greer', 'pgreer@verizon.net · (941) 555-0171', '58', 'Issued', D.green, 'Health Access III', '$439', '$340', D.green], ['Jerome Banks', 'jbanks@gmail.com · (618) 555-0524', '25', 'Issued', D.green, 'Secure Advantage', '$444', '$1,076', D.green]];
  return <Panel>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}><H3 D={D}>Portal Clients</H3>
      <button onClick={onNewLead} style={{ padding: '7px 14px', fontSize: 11.5, fontWeight: 700, color: '#fff', background: `linear-gradient(135deg, var(--pof-from), var(--pof-to))`, border: 'none', borderRadius: 9, cursor: 'pointer' }}>+ New Lead</button></div>
    <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr .4fr .7fr 1.2fr .55fr .6fr', gap: 8, padding: '10px 12px', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: D.t3 }}><span>Name</span><span>Contact</span><span>Age</span><span>Stage</span><span>Product</span><span style={{ textAlign: 'right' }}>Prem</span><span style={{ textAlign: 'right' }}>Adv</span></div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr .4fr .7fr 1.2fr .55fr .6fr', gap: 8, padding: '9px 12px', borderTop: `1px solid ${D.border}`, fontSize: 11.5, color: D.text, alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>{r[0]}</span><span style={{ color: D.t2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r[1]}</span><span style={{ color: D.t2 }}>{r[2]}</span>
          <span><span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: 'rgba(52,211,153,.13)', color: r[4] }}>{r[3]}</span></span>
          <span style={{ color: D.t2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r[5]}</span><span style={{ textAlign: 'right', fontWeight: 600 }}>{r[6]}</span><span style={{ textAlign: 'right', fontWeight: 700, color: r[8] }}>{r[7]}</span>
        </div>
      ))}
    </div>
    <div style={{ fontSize: 11, color: D.t3, marginTop: 10 }}>Your full residual book — every active member, plan, premium and renewal in one searchable place.</div>
  </Panel>;
}
function TourProspects({ D, onNewLead }) {
  const cols = [['Expressed Interest', 13, D.green, [['Gregory M.', '(202) 555-0278', 'MD · ET', '', 'AGED LEAD', D.green]]], ['Appointment Set', 8, D.blue, [['Mike P.', '(832) 555-8900', 'TX · CT', 'Jun 18, 10:00 AM', 'BENEPATH', D.amber]]], ['Webby Confirmed', 2, D.green, [['Chris G.', '(817) 555-4563', 'TX · CT', 'Jun 19, 10:00 AM', 'BENEPATH', D.amber]]], ['Missed Appt', 10, D.amber, [['Josh B.', '(214) 555-1912', 'TX · CT', 'Jun 15, 7:15 PM', 'BENEPATH', D.amber]]]];
  return <Panel>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}><div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><H3 D={D}>Prospects</H3><button onClick={onNewLead} style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: `linear-gradient(135deg, var(--pof-from), var(--pof-to))`, border: 'none', borderRadius: 8, cursor: 'pointer' }}>+ New Lead</button></div></div>
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}>
      {cols.map(([title, count, accent, cards]) => (
        <div key={title} style={{ flex: '0 0 215px', background: 'rgba(124,134,176,.05)', border: `1px solid ${D.border}`, borderRadius: 12, padding: 11 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}><div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 800, color: D.text, textTransform: 'uppercase' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />{title}</div><span style={{ fontSize: 11, fontWeight: 700, color: D.t3 }}>{count}</span></div>
          {cards.map((c, i) => (
            <div key={i} style={{ background: D.card2, border: `1px solid ${D.border}`, borderLeft: `3px solid ${accent}`, borderRadius: 10, padding: '10px 11px', marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, color: D.text, marginBottom: 3 }}>{c[0]}</div>
              <div style={{ fontSize: 11, color: D.t2 }}>{c[1]}</div>
              <div style={{ fontSize: 10.5, color: D.t3, margin: '3px 0 6px' }}>{c[2]}</div>
              {c[3] && <div style={{ fontSize: 10.5, color: D.viol, marginBottom: 6 }}>⏱ {c[3]}</div>}
              <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: `${c[5]}22`, color: c[5] }}>{c[4]}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  </Panel>;
}
function TourBooks({ D }) {
  const kpis = [['YTD Income', '$193,639', D.green], ['YTD Expenses', '$140,948', D.text], ['Net (YTD)', '$52,691', D.green], ['June 2026', '+$19,982', D.green]];
  const cats = [['Lead Investment', '$2,257.38', D.red], ['Ringy', '$1,150.00', D.red], ['TextDrip', '$887.49', D.viol], ['VanillaSoft', '$0.00', D.blue], ['Office Rent', '$4,390.00', D.red]];
  return <Panel>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>{kpis.map(([l, v, c]) => (
      <div key={l} style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 12, padding: '12px 15px', flex: 1, minWidth: 130 }}><div style={{ fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: D.t3, marginBottom: 5 }}>{l}</div><div style={{ fontSize: 18, fontWeight: 800, color: c }}>{v}</div></div>
    ))}</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(124,134,176,.06)', border: `1px solid ${D.border}`, borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
      <span style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', background: `linear-gradient(135deg, var(--pof-from), var(--pof-to))`, borderRadius: 9 }}>✦ Smart Import (AI)</span>
      <span style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, color: D.t2, whiteSpace: 'nowrap', background: 'rgba(124,134,176,.1)', borderRadius: 9 }}>⬆ Classic Import</span>
      <span style={{ fontSize: 11, color: D.t3, flex: 1 }}>Drop a CSV — AI auto-classifies every line.</span>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10 }}>{cats.map(([l, v, c]) => (
      <div key={l} style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 12, padding: '12px 13px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: D.t3, marginBottom: 6 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />{l}</div><div style={{ fontSize: 17, fontWeight: 800, color: D.text }}>{v}</div></div>
    ))}</div>
  </Panel>;
}
function TourUploads({ D }) {
  return <Panel><H3 D={D}>Upload</H3>
    <div style={{ fontSize: 11.5, color: D.t3, marginBottom: 16 }}>Drop USHA weekly advance + monthly payout statements. PRIM auto-matches every commission row to the right closed deal — even when USHA pays under a spouse's name.</div>
    <div style={{ border: `2px dashed rgba(124,134,176,.3)`, borderRadius: 14, padding: 28, textAlign: 'center', background: 'rgba(124,134,176,.05)', marginBottom: 14 }}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" style={{ marginBottom: 8 }}><path d="M12 16V5M8 9l4-4 4 4" stroke="var(--pof-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 19h14" stroke="var(--pof-accent)" strokeWidth="2" strokeLinecap="round" /></svg>
      <div style={{ fontSize: 13, color: D.t2 }}>Drag a statement here — PDF, CSV or Excel</div>
    </div>
    <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 12, padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(52,211,153,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: D.green }}>✓</span>
      <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 700, color: D.text }}>USHA-advance-wk24.pdf</div><div style={{ fontSize: 11, color: D.t3 }}>14 rows auto-matched · 2 paid under spouse name</div></div>
      <span style={{ fontSize: 11, fontWeight: 700, color: D.green }}>Matched</span>
    </div>
  </Panel>;
}

/* ---- New Lead modal (teach-only; fields are illustrative) ---- */
function NewLeadModal({ D, onClose }) {
  const inC = { width: '100%', padding: '11px 12px', background: D.input, border: `1px solid rgba(124,134,176,.22)`, borderRadius: 9, color: D.text, fontSize: 13, fontFamily: FONT, outline: 'none', boxSizing: 'border-box' };
  const lab = { display: 'block', fontSize: 11, fontWeight: 600, color: D.t2, marginBottom: 6 };
  const Field = ({ label, req, children }) => <div style={{ marginBottom: 14 }}><label style={lab}>{label} {req && <span style={{ color: D.red }}>*</span>}</label>{children}</div>;
  const Sel = ({ opts }) => <select style={inC}>{opts.map(o => <option key={o}>{o}</option>)}</select>;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(5,8,18,.72)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 22, overflow: 'auto', animation: 'pof-fadeUp .25s ease both' }}>
      <div style={{ width: 'min(660px,100%)', background: '#121A30', border: `1px solid rgba(124,134,176,.22)`, borderRadius: 16, boxShadow: '0 40px 90px -30px rgba(0,0,0,.7)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'linear-gradient(180deg,#1A2240,#141C34)', borderBottom: `1px solid rgba(124,134,176,.18)` }}>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#fff' }}>New Lead</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: D.t2, cursor: 'pointer', fontSize: 20, padding: '2px 6px' }}>×</button>
        </div>
        <div style={{ padding: '20px 22px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><Field label="Name" req><input placeholder="John Doe" style={inC} /></Field><Field label="Phone" req><input placeholder="(305) 555-1234" style={inC} /></Field></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><Field label="Email"><input placeholder="john@example.com" style={inC} /></Field><Field label="DOB(s)"><input placeholder="MM/DD/YYYY · comma-separate for family" style={inC} /></Field></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr .8fr 1fr 1fr', gap: 12 }}><Field label="State"><Sel opts={['—', 'FL', 'TX', 'GA', 'CA', 'NV']} /></Field><Field label="ZIP"><input placeholder="33179" style={inC} /></Field><Field label="Time Zone"><input placeholder="ET / CT / MT / PT" style={inC} /></Field><Field label="Indv / Family"><Sel opts={['Individual', 'Family']} /></Field></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}><Field label="Lead Source"><Sel opts={['—', 'Aged', 'Shared', 'Referral', 'Dialer', 'Benepath']} /></Field><Field label="Lead Vendor"><input placeholder="e.g. Benepath · paid" style={inC} /></Field><Field label="CRM"><Sel opts={['None', 'Ringy', 'TextDrip', 'VanillaSoft']} /></Field></div>
          <Field label="Stage"><Sel opts={['Quoted/Pending Decision', 'Expressed Interest', 'Appointment Set', 'Webby Confirmed', 'Issued']} /></Field>
          <Field label="Health Notes"><textarea rows="2" placeholder="General impressions only. NO medication names or diagnoses." style={{ ...inC, resize: 'none' }} /></Field>
          <Field label="Next Steps"><textarea rows="2" placeholder="What happens next — e.g. follow up Tuesday" style={{ ...inC, resize: 'none' }} /></Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 20px', background: D.input, borderTop: `1px solid rgba(124,134,176,.18)` }}>
          <button onClick={onClose} style={{ padding: '11px 20px', borderRadius: 11, border: `1px solid rgba(124,134,176,.25)`, background: 'transparent', color: D.t2, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={onClose} style={{ padding: '11px 22px', borderRadius: 11, border: 'none', background: `linear-gradient(135deg, var(--pof-from), var(--pof-to))`, color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>Save Lead</button>
        </div>
      </div>
    </div>
  );
}

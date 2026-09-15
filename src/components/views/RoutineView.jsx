'use client';
/**
 * Routine view (spec §7a, §7g, §7h.3, §9). Owns the three documents, the
 * `loaded` guard, the 30 s clock, every save, timezone capture, entitlement,
 * device push status, the two composes (projected / realized), the client-side
 * freeze + owed refresh, and ONE render path: Timeline (≥ 640 px) or
 * MobileRoutineList under a shared NowCard.
 *
 * Write discipline (Task 10/11 carry-forwards):
 *   - `storage.getItem` never rejects, so an empty read is indistinguishable
 *     from a failed one: ZERO writes before `loadRoutine` resolves, zero when
 *     `canAccess !== true`.
 *   - settings are saved only on explicit edits and the one-time seeding /
 *     zone capture inside the load path — never from an effect echoing state.
 *   - side effects never run inside React state updaters (StrictMode double-
 *     invokes them): every commit* helper computes the next value from a ref,
 *     sets state, and saves — outside any updater. Every save goes through
 *     the sanitizers; no prospect id or name ever lands in routine_blocks_v1.
 */
import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { Lock, X } from 'lucide-react';
import { loadRoutine, saveBlocks, saveDay, saveSettings } from '@/lib/routineStore';
import { sanitizeBlocks, liveBlocks, sanitizeDay, sanitizeSettings, seedFollowupStages, applyTemplate, instantiateTemplate, dayUid } from '@/lib/routineModel.mjs';
import { todaysAppointments, composeDay, findMakeupSlot, reconcileOwed, offerState, applyOwedDecision, owedId, apptRecordId, followupQueue, yesterdayMiss, weeklyNotDone, parseAppointmentTime } from '@/lib/routineLive.mjs';
import { isValidTimeZone, localDayKey, localMinuteOfDay, localWeekday } from '@/lib/tz.mjs';
import { nowState, blockVisualState } from '@/lib/routineClock.mjs';
import { bounds as laneBoundsOf } from '@/lib/routineLayout.mjs';
import { paletteById } from '@/lib/routinePalette.mjs';
import { TEMPLATES } from '@/lib/routineTemplates.mjs';
import { useBetaFeature } from '@/lib/useBetaFeature';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useIsDark } from '@/lib/useIsDark';
import { isPushEnabled, enablePush, pushPermission } from '@/lib/push';
import { defaultProspectSettings } from '@/lib/prospects';
import RoutineHeader from '../routine/RoutineHeader';
import NowCard from '../routine/NowCard';
import Timeline from '../routine/Timeline';
import MobileRoutineList from '../routine/MobileRoutineList';
import BlockPalette from '../routine/BlockPalette';
import BlockEditorSheet from '../routine/BlockEditorSheet';
import FollowupSheet from '../routine/FollowupSheet';
import RoutineSettingsSheet from '../routine/RoutineSettingsSheet';
import TemplatePicker from '../routine/TemplatePicker';
import WeeklyLookback from '../routine/WeeklyLookback';

const EMPTY_COMPOSE = Object.freeze({ items: [], displacedByBlock: {}, displacedByMakeup: {}, recovered: 0, unrecovered: 0, markers: [] });
const IDLE_STATE = Object.freeze({ phase: 'free', current: null, next: null, behind: null });
const NO_YESTERDAY = Object.freeze({ minutes: 0, byBlock: {}, byCategory: {}, noun: 'routine time', hidden: true });
const NO_WEEK = Object.freeze({ total: 0, days: [] });
const DELETE_UNDO_MS = 5000;
// A day key whose 7-day floor (1969-12-25) can never prune anything — the load path's
// stand-in for "no zone resolved yet", where sanitizeDay must validate but not prune.
const EPOCH_DAY = '1970-01-01';
const REPLACE_UNDO_MS = 10000;

const stampNow = () => new Date().toISOString();
const snap5 = (n) => Math.round(n / 5) * 5;
const upsertById = (arr, recs) => { const m = new Map(arr.map((r) => [r.id, r])); for (const r of recs) m.set(r.id, r); return [...m.values()]; };
const isIOS = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent || '');
const deviceZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } };
const warnSave = (what) => (e) => { console.warn(`routine: ${what} save failed`, e); };
const cssEscape = (s) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));

// A start that fits `durationMin` among `others`, nearest to `wanted` in 5-minute steps (§7c); null when none.
// `maxSlide` bounds the search: a drag is a positional gesture, so the block must land still
// overlapping the interval the agent pointed at. Without a bound the search ALWAYS succeeds (a
// placed block's own slot fits, since `others` excludes it), which both made §7c's "else revert +
// toast" dead code and let a drop onto a packed hour teleport the block an hour away — the Task 11
// carry-forward's "never relocate far away on a drag".
function nearestFit(wanted, durationMin, others, maxSlide = Infinity) {
  const start = snap5(Math.max(0, Math.min(1440 - durationMin, wanted)));
  const fits = (s) => s >= 0 && s + durationMin <= 1440 && !others.some((o) => s < o.startMin + o.durationMin && o.startMin < s + durationMin);
  const limit = Math.min(1440, maxSlide);
  for (let d = 0; d <= limit; d += 5) {
    if (fits(start + d)) return start + d;
    if (d && fits(start - d)) return start - d;
  }
  return null;
}
// The block keeps at least 5 minutes under the pointer.
const slideWindow = (durationMin) => Math.max(5, durationMin - 5);

// Non-entitled card (spec §9): the AgentSettingsPanel.jsx:343-361 treatment, zero storage writes.
function LockedCard({ reason }) {
  if (reason === 'tier_too_low' || reason === 'no_subscription') {
    return (
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-6 text-center">
        <Lock size={24} className="text-indigo-600 mx-auto mb-3" />
        <h3 className="font-bold text-slate-900 mb-1">Routine is included with every PRIM plan</h3>
        <p className="text-sm text-slate-600 mb-4">Start a plan to build your daily routine, see today&apos;s appointments on it, and get reminders at block time.</p>
        <a href="/pricing" className="inline-flex items-center bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg">See plans</a>
      </div>
    );
  }
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center text-sm text-slate-600">
      <Lock size={24} className="text-slate-400 mx-auto mb-3" />
      Routine isn&apos;t available on your account yet.
    </div>
  );
}

const Skeleton = () => <div className="premium-card p-6 animate-pulse h-40" aria-busy="true" />;

export default function RoutineView({ showToast, prospects = [], prospectSettings, onOpenProspect }) {
  const { canAccess, reason, loading: accessLoading } = useBetaFeature('routine_builder');
  const entitled = canAccess === true; // every write is gated on this — including after a mid-session lapse
  const [loaded, setLoaded] = useState(false);
  const [blocks, setBlocks] = useState([]);           // sanitized, tombstones included
  const [day, setDay] = useState([]);                 // sanitized day records (7 days)
  const [settings, setSettings] = useState(() => sanitizeSettings(null));
  const [now, setNow] = useState(() => Date.now());
  const [devicePushOn, setDevicePushOn] = useState(null);
  const [editing, setEditing] = useState(null);       // { kind: 'block'|'makeup', id, anchor }
  const [namesOpen, setNamesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false); // "Blank" leaves the routine empty but the agent asked for the canvas
  const [toast, setToast] = useState(null);           // { id, text, undo }
  const [dragPaletteId, setDragPaletteId] = useState(null);
  const [scrollReq, setScrollReq] = useState(null);   // { id, n }
  const isDesktop = useMediaQuery('(min-width: 640px)');
  const isDark = useIsDark();

  // Latest documents for the commit helpers — written ONLY by the load path and the commits
  // themselves (never during render), so a handler always reads the newest saved document.
  const blocksRef = useRef([]);
  const dayRef = useRef([]);
  const settingsRef = useRef(settings);
  const toastTimer = useRef(null);
  const scrollN = useRef(0);
  const bellBusy = useRef(false);
  // The load effect reads showToast through a ref so an inline parent callback can never restart an in-flight load.
  const showToastRef = useRef(showToast);
  useEffect(() => { showToastRef.current = showToast; });
  // Entitlement is read through a ref, because a commit helper captured by a child can fire
  // AFTER canAccess flips false — the editor's 400 ms debounce flushed on unmount, or an
  // in-flight enablePush() — and would otherwise write to a locked account (spec §9).
  // useLayoutEffect, not useEffect: layout creates run in the SAME commit that unmounts the
  // editor, BEFORE that child's passive cleanup fires its flush, so the ref is already false
  // when the captured onSave lands. A passive (useEffect) assignment runs too late — React
  // runs every destroy for a commit before any create. Pinned by case 14.
  const entitledRef = useRef(entitled);
  useLayoutEffect(() => { entitledRef.current = entitled; });

  const nowIso = new Date(now).toISOString();
  const tz = isValidTimeZone(settings.timezone) ? settings.timezone : null;
  const today = tz ? localDayKey(now, tz) : null;
  const nowMin = tz ? localMinuteOfDay(now, tz) : 0;
  // Memoized: it sits in the load effect's deps — a fresh array per render would restart loadRoutine on every pre-loaded re-render.
  const stages = useMemo(() => (prospectSettings || defaultProspectSettings()).stages || [], [prospectSettings]);

  // ---- commits (spec §7a: immediate; the editor debounces its own text fields) ----
  const commitBlocks = useCallback((next) => {
    if (!entitledRef.current) return blocksRef.current;
    const raw = typeof next === 'function' ? next(blocksRef.current) : next;
    // §4a's last resort: a block resolveOverlaps cannot place anywhere is tombstoned. Telling
    // the agent WHICH one is the rest of that rule — a block that vanishes with no notice is
    // indistinguishable from a bug. Read through the ref so commitBlocks keeps its empty deps
    // (an inline parent showToast would otherwise give every child a new callback per render).
    const s = sanitizeBlocks(raw, stampNow(), (names) => { for (const n of names) showToastRef.current?.(`No room for ${n}`); });
    blocksRef.current = s;
    setBlocks(s);
    saveBlocks(s).catch(warnSave('blocks'));
    return s;
  }, []);
  const commitDay = useCallback((updater) => {
    if (!entitledRef.current || !today) return dayRef.current;
    const s = sanitizeDay(updater(dayRef.current), today, stampNow());
    dayRef.current = s;
    setDay(s);
    saveDay(s).catch(warnSave('day'));
    return s;
  }, [today]);
  const commitSettings = useCallback((patch) => {
    if (!entitledRef.current) return settingsRef.current;
    const s = sanitizeSettings({ ...settingsRef.current, ...patch });
    settingsRef.current = s;
    setSettings(s);
    saveSettings(s).catch(warnSave('settings'));
    return s;
  }, []);

  // ---- load: zero writes before loaded; zero when not entitled ----
  useEffect(() => {
    if (accessLoading || !entitled || loaded) return undefined;
    let alive = true;
    (async () => {
      const dz = deviceZone();
      const loadAt = Date.now();
      const loadIso = new Date(loadAt).toISOString();
      const r = await loadRoutine({ nowIso: loadIso });
      if (!alive) return;
      let s = r.settings;
      let zoneChanged = false;
      if (s.timezoneMode === 'auto' && isValidTimeZone(dz) && s.timezone !== dz) { zoneChanged = !!s.timezone; s = { ...s, timezone: dz }; }
      if (!s.followupStagesSeeded) s = { ...s, followupStages: seedFollowupStages(stages), followupStagesSeeded: true };
      // The day array is pruned at `today − 7` (§4b), so its floor MUST come from the same
      // zone every later commitDay uses — the one that is only resolved on the line above.
      // Pruning against the DEVICE zone instead (a day ahead for a travelling agent, or for
      // anyone whose manual setting differs) drops the oldest still-in-window day here, and
      // the next commitDay writes that deletion to the cloud: silent, permanent loss.
      // With no zone at all there is no `today` and commitDay is a no-op, so the load
      // validates without pruning and the first commit after a zone exists prunes for real.
      // `loadAt`, not Date.now(): commitDay's `today` comes from the `now` STATE, which the
      // 30 s clock has not refreshed while this await was in flight. Taking the day key from
      // the pre-await instant keeps the two within a render of each other, so a load that
      // straddles local midnight can never prune a day the next commitDay would still keep.
      const zone = isValidTimeZone(s.timezone) ? s.timezone : null;
      const day = sanitizeDay(r.dayRaw, zone ? localDayKey(loadAt, zone) : EPOCH_DAY, loadIso);
      blocksRef.current = r.blocks; dayRef.current = day; settingsRef.current = s;
      setBlocks(r.blocks); setDay(day); setSettings(s); setLoaded(true);
      // The only settings write that is not an explicit edit: the one-time capture / seeding.
      if (s !== r.settings) saveSettings(s).catch(warnSave('settings'));
      if (zoneChanged) showToastRef.current?.(`Time zone updated to ${dz}`);
      try { const on = await isPushEnabled(); if (alive) setDevicePushOn(!!on); } catch { if (alive) setDevicePushOn(false); }
    })();
    return () => { alive = false; };
  }, [accessLoading, entitled, loaded, stages]);

  // ---- 30 s clock, paused while hidden; device push re-read on return ----
  useEffect(() => {
    if (!loaded || !entitled) return undefined;
    let id = null;
    const tick = () => setNow(Date.now());
    const arm = () => { if (id == null) id = setInterval(tick, 30000); };
    const disarm = () => { if (id != null) { clearInterval(id); id = null; } };
    const onVis = () => {
      if (document.hidden) { disarm(); return; }
      tick(); arm();
      isPushEnabled().then((on) => setDevicePushOn(!!on)).catch(() => setDevicePushOn(false));
    };
    if (!document.hidden) arm(); // a load that resolves on a backgrounded tab must not tick until it is shown
    document.addEventListener('visibilitychange', onVis);
    return () => { disarm(); document.removeEventListener('visibilitychange', onVis); };
  }, [loaded, entitled]);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // ---- compose (recomputed on the clock and on any change to blocks, day records, prospects) ----
  const live = useMemo(() => liveBlocks(blocks, nowIso), [blocks, nowIso]);
  const liveForCompose = useMemo(() => (today && settings.activeDays.includes(localWeekday(today)) ? live : []), [live, today, settings.activeDays]);
  const items = useMemo(() => (tz ? todaysAppointments({ prospectRows: prospects, blocks: live, dayRecords: day, settings, tz, now }) : []), [prospects, live, day, settings, tz, now]);
  const makeups = useMemo(() => day.filter((r) => r.kind === 'makeup' && r.day === today && !r.deletedAt), [day, today]);
  const projected = useMemo(() => (today ? composeDay({ live: liveForCompose, appointments: items, makeups, dayRecords: day, nowMin, today }) : EMPTY_COMPOSE), [liveForCompose, items, makeups, day, nowMin, today]);
  const startedItems = useMemo(() => items.filter((i) => i.instant <= now), [items, now]);
  const realized = useMemo(() => (today ? composeDay({ live: liveForCompose, appointments: startedItems, makeups, dayRecords: day, nowMin, today }) : EMPTY_COMPOSE), [liveForCompose, startedItems, makeups, day, nowMin, today]);
  const storedOwed = useMemo(() => (today ? day.find((r) => r.kind === 'owed' && r.id === owedId(today) && !r.deletedAt) || null : null), [day, today]);
  const offer = useMemo(() => offerState(storedOwed, projected), [storedOwed, projected]);
  const slot = useMemo(() => (today && offer.offerOpen ? findMakeupSlot({ live: liveForCompose, appointments: items, makeups, dayRecords: day, makeupMin: offer.makeupMin, nowMin, today }) : null), [offer, liveForCompose, items, makeups, day, nowMin, today]);
  const state = useMemo(() => (today ? nowState({ items: projected.items, dayRecords: day, nowMin, today, offerBlocked: offer.offerOpen && !!slot }) : IDLE_STATE), [projected, day, nowMin, today, offer, slot]);
  const queue = useMemo(() => (tz ? followupQueue(prospects, settings.followupStages, tz, now) : []), [prospects, settings.followupStages, tz, now]);
  const followup = useMemo(() => ({ rows: queue.slice(0, 4), count: queue.length }), [queue]);
  const yesterday = useMemo(() => (tz ? yesterdayMiss({ blocks, dayRecords: day, settings, tz, now }) : NO_YESTERDAY), [blocks, day, settings, tz, now]);
  const week = useMemo(() => (tz ? weeklyNotDone({ blocks, dayRecords: day, settings, tz, now }) : NO_WEEK), [blocks, day, settings, tz, now]);
  const laneBounds = useMemo(() => laneBoundsOf(projected.items), [projected]);

  // Density tier + visual state are per underlying block (§7c): `full` when any segment is the
  // current or next item, `compact` for other future blocks, `spent` for past ones; the visual
  // state uses the title segment's start and the last segment's end.
  const { tiers, visuals } = useMemo(() => {
    const span = new Map();
    for (const it of projected.items) {
      if (it.kind === 'appt') continue;
      const k = it.blockId ?? it.makeupId;
      const prev = span.get(k);
      span.set(k, {
        start: prev ? Math.min(prev.start, it.startMin) : it.startMin,
        end: prev ? Math.max(prev.end, it.endMin) : it.endMin,
        titleStart: it.isTitle ? it.startMin : (prev ? prev.titleStart : it.startMin),
        done: it.done,
      });
    }
    const focus = new Set([state.current, state.next].filter(Boolean).map((it) => it.blockId ?? it.makeupId).filter(Boolean));
    const t = {}, v = {};
    for (const [k, s] of span) {
      t[k] = focus.has(k) ? 'full' : s.end <= nowMin ? 'spent' : 'compact';
      v[k] = blockVisualState({ startMin: s.titleStart, endMin: s.end, done: s.done, nowMin });
    }
    return { tiers: t, visuals: v };
  }, [projected, state, nowMin]);

  // ---- client-side freeze + owed refresh (spec §7a) ----
  // Converges: the second pass finds every id in `existing` and reconcileOwed returns null when
  // nothing changed, so a compose that changed nothing writes nothing.
  useEffect(() => {
    if (!loaded || !entitled || !tz || !today) return;
    const stamp = stampNow();
    const recs = [];
    const existing = new Set(dayRef.current.filter((r) => r.kind === 'appt' && r.day === today).map((r) => r.id)); // live OR tombstoned
    for (const it of items) {
      if (it.frozen || it.instant > now) continue;
      const id = apptRecordId(today, it.prospectId, it.startMin);
      if (existing.has(id)) continue;
      // Same rule as the tick (§4b): a frozen appt is stamped at its START instant.
      recs.push({ id, kind: 'appt', day: today, prospectId: it.prospectId, startMin: it.startMin, durationMin: it.durationMin, source: it.source, heldAt: null, updatedAt: new Date(it.instant).toISOString(), deletedAt: null });
    }
    const owed = reconcileOwed(storedOwed, realized, stamp, today);
    if (owed) recs.push(owed);
    if (recs.length) commitDay((prev) => upsertById(prev, recs));
  }, [loaded, entitled, tz, today, items, realized, storedOwed, now, commitDay]);

  // ---- undo toast (delete 5 s / replace 10 s) ----
  const showUndo = (text, ms, undo) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    const id = Date.now();
    setToast({ id, text, undo });
    toastTimer.current = setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), ms);
  };
  const runUndo = () => {
    const t = toast;
    if (toastTimer.current) { clearTimeout(toastTimer.current); toastTimer.current = null; }
    setToast(null);
    t?.undo?.();
  };

  // ---- handlers (each one is a spec rule) ----
  const doneRecord = (blockId, status, stamp) => ({ id: `${today}|${blockId}`, kind: 'done', day: today, blockId, status, at: stamp, updatedAt: stamp, deletedAt: null });
  const toggleDone = (blockId) => {
    const stamp = stampNow();
    commitDay((prev) => {
      const cur = prev.find((r) => r.id === `${today}|${blockId}` && !r.deletedAt);
      return upsertById(prev, [doneRecord(blockId, cur?.status === 'done' ? 'cleared' : 'done', stamp)]);
    });
  };
  const skipToday = (blockId) => { if (!blockId) return; const stamp = stampNow(); commitDay((prev) => upsertById(prev, [doneRecord(blockId, 'skipped', stamp)])); };
  // §7g: Held stamps heldAt on the frozen record (never creates one); unchecking clears it.
  const held = (item) => {
    if (!item?.recordId) return;
    const stamp = stampNow();
    commitDay((prev) => prev.map((r) => (r.id === item.recordId ? { ...r, heldAt: r.heldAt ? null : stamp, updatedAt: stamp } : r)));
  };
  // §7f: tombstones the frozen record and, for an attached item, ONLY the attach whose block starts at this item's start.
  const removeFromToday = (item) => {
    if (!item?.recordId) return;
    const stamp = stampNow();
    commitDay((prev) => {
      const ids = new Set([item.recordId]);
      if (item.source === 'attached') {
        for (const r of prev) {
          if (r.kind === 'attach' && r.day === today && !r.deletedAt && r.prospectId === item.prospectId && live.find((b) => b.id === r.blockId)?.startMin === item.startMin) ids.add(r.id);
        }
      }
      return prev.map((r) => (ids.has(r.id) ? { ...r, deletedAt: stamp, updatedAt: stamp } : r));
    });
  };
  const detach = (item) => {
    if (!item?.attachId) return;
    const stamp = stampNow();
    commitDay((prev) => prev.map((r) => (r.id === item.attachId ? { ...r, deletedAt: stamp, updatedAt: stamp } : r)));
  };
  // §7f: an attach record (never a prospect reference on the block) + un-delete any tombstoned appt record at (prospect, block start).
  const attach = (blockId, prospectId) => {
    const b = live.find((x) => x.id === blockId);
    if (!b || !prospectId) return;
    const stamp = stampNow();
    commitDay((prev) => {
      const rec = { id: `${today}|attach|${blockId}`, kind: 'attach', day: today, blockId, prospectId, updatedAt: stamp, deletedAt: null };
      const revived = prev
        .filter((r) => r.kind === 'appt' && r.day === today && r.deletedAt && r.prospectId === prospectId && r.startMin === b.startMin)
        .map((r) => ({ ...r, deletedAt: null, updatedAt: stamp }));
      return upsertById(prev, [rec, ...revived]);
    });
  };
  const restoreBlock = (blockId, attachIds) => {
    const stamp = stampNow();
    commitBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, deletedAt: null, updatedAt: stamp } : b)));
    if (attachIds.length) commitDay((prev) => prev.map((r) => (attachIds.includes(r.id) ? { ...r, deletedAt: null, updatedAt: stamp } : r)));
  };
  // §4a: deleting a block tombstones its live attaches in the same commit; the 5 s Undo restores both.
  const deleteBlock = (blockId) => {
    if (!blockId || !blocksRef.current.some((b) => b.id === blockId && !b.deletedAt)) return;
    const stamp = stampNow();
    const attachIds = dayRef.current.filter((r) => r.kind === 'attach' && !r.deletedAt && r.blockId === blockId).map((r) => r.id);
    commitBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, deletedAt: stamp, updatedAt: stamp } : b)));
    if (attachIds.length) commitDay((prev) => prev.map((r) => (attachIds.includes(r.id) ? { ...r, deletedAt: stamp, updatedAt: stamp } : r)));
    showUndo('Block deleted', DELETE_UNDO_MS, () => restoreBlock(blockId, attachIds));
  };
  // The editor's unmount flush may deliver a patch after the block is gone — look it up by id, ignore if not live.
  const updateBlock = (blockId, patch) => {
    if (!blockId || !patch || !blocksRef.current.some((b) => b.id === blockId && !b.deletedAt)) return;
    const stamp = stampNow();
    commitBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, ...patch, updatedAt: stamp } : b)));
  };
  const updateMakeup = (id, patch) => {
    if (!id || !patch || !dayRef.current.some((r) => r.id === id && r.kind === 'makeup' && !r.deletedAt)) return;
    const stamp = stampNow();
    const allowed = {};
    for (const k of ['name', 'note', 'startMin', 'durationMin']) if (k in patch) allowed[k] = patch[k];
    if (!Object.keys(allowed).length) return;
    commitDay((prev) => prev.map((r) => (r.id === id ? { ...r, ...allowed, updatedAt: stamp } : r)));
  };
  // §7c: move → snap, clamp, slide to the NEAREST free gap that fits, else revert + toast. Never shrink, relocate far away, or delete on a drag.
  const moveBlock = (blockId, startMin) => {
    const me = live.find((b) => b.id === blockId);
    if (!me) return;
    const target = nearestFit(startMin, me.durationMin, live.filter((b) => b.id !== blockId), slideWindow(me.durationMin));
    if (target == null) { showToast?.('No room there — shrink it or move a neighbor'); return; }
    if (target !== me.startMin) updateBlock(blockId, { startMin: target });
  };
  // §7c: resize → clamp to the next item's start (and the 10–720 range), snapped to 5.
  const resizeBlock = (blockId, durationMin) => {
    const me = live.find((b) => b.id === blockId);
    if (!me) return;
    const next = live.filter((b) => b.startMin > me.startMin).sort((a, b) => a.startMin - b.startMin)[0];
    const max = Math.min(720, (next ? next.startMin : 1440) - me.startMin);
    const dur = Math.max(10, Math.min(max, snap5(durationMin)));
    if (dur !== me.durationMin) updateBlock(blockId, { durationMin: dur });
  };
  const moveMakeup = (id, startMin) => {
    const m = makeups.find((x) => x.id === id);
    if (!m) return;
    const s = Math.max(0, Math.min(1440 - m.durationMin, snap5(startMin)));
    if (s !== m.startMin) updateMakeup(id, { startMin: s });
  };
  const resizeMakeup = (id, durationMin) => {
    const m = makeups.find((x) => x.id === id);
    if (!m) return;
    const d = Math.max(10, Math.min(720, 1440 - m.startMin, snap5(durationMin)));
    if (d !== m.durationMin) updateMakeup(id, { durationMin: d });
  };
  const isMakeupId = (id) => makeups.some((m) => m.id === id);
  const moveOwner = (ownerId, startMin) => (isMakeupId(ownerId) ? moveMakeup(ownerId, startMin) : moveBlock(ownerId, startMin));
  const resizeOwner = (ownerId, durationMin) => (isMakeupId(ownerId) ? resizeMakeup(ownerId, durationMin) : resizeBlock(ownerId, durationMin));
  const nextFreeSlot = (durationMin) => {
    const sorted = [...live].sort((a, b) => a.startMin - b.startMin);
    let cursor = Math.ceil(nowMin / 5) * 5;
    for (const b of sorted) {
      if (b.startMin + b.durationMin <= cursor) continue;
      if (b.startMin - cursor >= durationMin) return cursor;
      cursor = Math.max(cursor, b.startMin + b.durationMin);
    }
    return cursor + durationMin <= 1440 ? cursor : null;
  };
  // Palette click → the next free slot at/after now; drop / "+ hh:mm" pill → nearest fit around that minute.
  const addFromPalette = (paletteId, startMin = null) => {
    const p = paletteById(paletteId);
    if (!p) return;
    const s = startMin == null ? nextFreeSlot(p.defaultMin) : nearestFit(startMin, p.defaultMin, live, slideWindow(p.defaultMin));
    // §7c: the click path fails because the DAY is full; a drop / '+ hh:mm' pill fails because the
    // pointed-at hour is, and gets the same copy every other positional gesture gets.
    if (s == null) { showToast?.(startMin == null ? 'No room today' : 'No room there — shrink it or move a neighbor'); return; }
    const b = instantiateTemplate({ paletteId, startMin: s }, { now: stampNow(), defaultMinutesBefore: settings.defaultMinutesBefore });
    commitBlocks((prev) => [...prev, b]);
    setShowCanvas(true);
    setEditing({ kind: 'block', id: b.id, anchor: null });
  };
  // §7h.3 offer lifecycle: Accept → one make-up (largest displaced block, tie → earliest start) + the decision, no toast.
  const acceptOffer = () => {
    if (!slot || !today) return;
    const stamp = stampNow();
    const startOf = (id) => live.find((x) => x.id === id)?.startMin ?? 0;
    const [bigId] = Object.entries(projected.displacedByBlock).sort((a, b) => b[1] - a[1] || startOf(a[0]) - startOf(b[0]))[0] || [null];
    const src = live.find((b) => b.id === bigId) || { category: 'custom', name: 'Routine' };
    const mk = { id: dayUid(), kind: 'makeup', day: today, startMin: slot.startMin, durationMin: offer.makeupMin, category: src.category, name: `${src.name} (make-up)`, ofBlockId: bigId, updatedAt: stamp, deletedAt: null };
    const owed = applyOwedDecision(storedOwed, 'accept', { projected, realized, makeupMin: offer.makeupMin, nowIso: stamp, day: today });
    commitDay((prev) => upsertById(prev, [mk, owed]));
  };
  const skipOffer = () => {
    if (!today) return;
    const owed = applyOwedDecision(storedOwed, 'skip', { projected, realized, makeupMin: offer.makeupMin, nowIso: stampNow(), day: today });
    commitDay((prev) => upsertById(prev, [owed]));
  };
  const removeMakeup = (id) => {
    if (!id) return;
    const stamp = stampNow();
    commitDay((prev) => prev.map((r) => (r.id === id && r.kind === 'makeup' ? { ...r, deletedAt: stamp, updatedAt: stamp } : r)));
  };
  const ackYesterday = () => { const stamp = stampNow(); commitDay((prev) => upsertById(prev, [{ id: `${today}|ack`, kind: 'ack', day: today, updatedAt: stamp, deletedAt: null }])); };
  const enableDevice = async () => {
    try { const r = await enablePush(); setDevicePushOn(!!r?.ok); } catch { setDevicePushOn(false); }
  };
  // §7a: the Bell is settings.remindersEnabled; turning it ON while the device is off calls enablePush() first —
  // the flag still saves if permission is denied (the strip explains).
  // The latch is required, not defensive: the second tap of a double-tap would read the same
  // pre-await remindersEnabled, recompute the same `next`, and run enablePush() twice — two taps
  // from OFF would end ON.
  const toggleBell = async () => {
    if (bellBusy.current) return;
    bellBusy.current = true;
    try {
      const next = !settingsRef.current.remindersEnabled;
      if (next && devicePushOn === false) await enableDevice();
      commitSettings({ remindersEnabled: next });
    } finally { bellBusy.current = false; }
  };
  const undoReplace = () => {
    const backup = settingsRef.current.lastReplacedBackup;
    if (!backup) return;
    const stamp = stampNow();
    commitBlocks(backup.map((b) => ({ ...b, updatedAt: stamp })));
    commitSettings({ lastReplacedBackup: null });
  };
  // §7e: all four applyTemplate branches; a replace keeps its backup in settings for the 10 s Undo.
  const pickTemplate = (template, replace) => {
    const { blocks: next, backup } = applyTemplate(blocksRef.current, template, { replace: !!replace, now: stampNow(), defaultMinutesBefore: settingsRef.current.defaultMinutesBefore });
    commitBlocks(next);
    setShowCanvas(true);
    if (backup) { commitSettings({ lastReplacedBackup: backup }); showUndo('Routine replaced', REPLACE_UNDO_MS, undoReplace); }
  };
  const openEditor = (item, rect) => {
    if (!item) return;
    if (item.kind === 'makeup') { if (makeups.some((m) => m.id === item.makeupId)) setEditing({ kind: 'makeup', id: item.makeupId, anchor: rect || null }); return; }
    if (item.blockId && live.some((b) => b.id === item.blockId)) setEditing({ kind: 'block', id: item.blockId, anchor: rect || null });
  };
  const deleteItem = (item) => (item?.kind === 'makeup' ? removeMakeup(item.makeupId) : deleteBlock(item?.blockId));
  const startedOf = (it) => !!it.frozen || it.instant <= now;
  const categoryOf = (id) => live.find((b) => b.id === id)?.category || makeups.find((m) => m.id === id)?.category;
  const scrollTo = (id) => {
    if (id == null) return;
    if (isDesktop) { scrollN.current += 1; setScrollReq({ id, n: scrollN.current }); return; }
    const esc = cssEscape(id);
    if (typeof document !== 'undefined') document.querySelector(`[data-item-id="${esc}"], [data-item-id^="${esc}#"]`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };
  const openProspect = (id) => { setNamesOpen(false); onOpenProspect?.(id); };
  // §7h.2 secondary line. Spec risk #15 puts this line here to explain the appointments the
  // TIMELINE hides — the ones whose stage is outside appointmentStages — so the time cannot
  // come from `items`, which is that same stage-filtered list and would leave the line
  // unreachable for exactly the population it was written for. Read the prospect's own
  // wall-clock, in the routine's zone, and only when it lands today; `items` is the fallback
  // for a row with no parseable time of its own — a frozen or attached card. Note the order:
  // a prospect can reach BOTH lists only if one stage id sits in appointmentStages AND
  // followupStages (both are agent-editable), and then an edited time shows here while the
  // timeline still shows the frozen card. The record is the newer intent, so the record wins.
  const apptTimeOf = (id) => {
    const p = prospects.find((x) => x && x.id === id);
    const parsed = tz && p ? parseAppointmentTime(p.appointmentTime, tz) : null;
    if (parsed && parsed.day === today) return parsed.minute;
    return items.find((i) => i.prospectId === id)?.startMin ?? null;
  };

  // ---- editor subject (derived from the live documents, so a deleted block closes the sheet) ----
  const editingRec = editing ? (editing.kind === 'makeup' ? makeups.find((m) => m.id === editing.id) : live.find((b) => b.id === editing.id)) || null : null;
  const attachOptions = useMemo(() => {
    if (!today || !editing || editing.kind !== 'block' || editingRec?.category !== 'appt') return [];
    const taken = new Set(day.filter((r) => r.kind === 'attach' && r.day === today && !r.deletedAt && r.prospectId != null && live.some((b) => b.id === r.blockId)).map((r) => r.prospectId));
    const apptStages = new Set(settings.appointmentStages);
    const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
    const g1 = [], g2 = [];
    for (const p of prospects) {
      if (!p || p.id == null || p.archivedAt || taken.has(p.id)) continue;
      if (apptStages.has(p.stage)) g1.push(p);
      else if (p.stage !== 'SOLD' && p.stage !== 'LOST') g2.push(p);
    }
    const opt = (group) => (p) => ({ id: p.id, name: p.name || '(no name)', group });
    return [...g1.sort(byName).map(opt('Appointments')), ...g2.sort(byName).map(opt('Other stages'))];
  }, [today, editing, editingRec, day, live, settings.appointmentStages, prospects]);

  // ---- reminder strip (spec §7b), first match ----
  const strip = settings.remindersEnabled === false ? 'off'
    : (isIOS() && typeof navigator !== 'undefined' && navigator.standalone === false) ? 'ios'
      : pushPermission() === 'denied' ? 'denied'
        : devicePushOn === false ? 'device'
          : !tz ? 'tz'
            : settings.activeDays.length === 0 ? 'days'
              : null;

  // ---- render ----
  if (accessLoading) return <Skeleton />;
  if (!entitled) return <LockedCard reason={reason} />;
  if (!loaded) return <Skeleton />;

  const empty = !showCanvas && live.length === 0 && makeups.length === 0 && items.length === 0;
  const currentStarted = state.current?.kind === 'appt' ? startedOf(state.current) : true;

  return (
    <div className="space-y-4">
      <RoutineHeader tz={tz} remindersEnabled={settings.remindersEnabled} onBell={toggleBell} onSettings={() => setSettingsOpen(true)} />

      <NowCard
        state={state} nowMin={nowMin} projected={projected} offer={offer} slot={slot} yesterday={yesterday}
        behind={state.behind} strip={strip} categoryOf={categoryOf} started={currentStarted}
        onDone={toggleDone} onHeld={held} onAccept={acceptOffer} onSkip={skipOffer} onAck={ackYesterday}
        onEnable={enableDevice} onScrollTo={scrollTo}
      />

      {replaceOpen && (
        <div className="premium-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Start over from a template</h3>
            <button type="button" onClick={() => setReplaceOpen(false)} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-700"><X size={18} /></button>
          </div>
          <TemplatePicker templates={TEMPLATES} replaceMode onPick={(t) => { setReplaceOpen(false); pickTemplate(t, true); }} />
        </div>
      )}

      {empty ? (
        <TemplatePicker templates={TEMPLATES} onPick={(t) => pickTemplate(t, false)} />
      ) : isDesktop ? (
        <>
          {/* `isolate`: a dragging block (z-20) must never paint over the sticky NowCard (z-10). */}
          <div className="isolate" data-routine-timeline>
            <Timeline
              items={projected.items} markers={projected.markers} tiers={tiers} visuals={visuals} followup={followup}
              bounds={laneBounds} nowMin={nowMin} isDark={isDark}
              onMove={moveOwner} onResize={resizeOwner}
              onAddAt={(minute, paletteId) => addFromPalette(paletteId || 'custom', minute)}
              onToggle={toggleDone} onOpen={openEditor} onDelete={deleteItem} onNames={() => setNamesOpen(true)}
              onHeld={held} onOpenProspect={openProspect} onRemoveAppt={removeFromToday} onDetach={detach}
              startedOf={startedOf} dragPaletteId={dragPaletteId} scrollRequest={scrollReq}
            />
          </div>
          <BlockPalette onAdd={(id) => addFromPalette(id)} onDragStart={setDragPaletteId} />
        </>
      ) : (
        <div data-routine-mobile>
          <MobileRoutineList
            items={projected.items} markers={projected.markers} tiers={tiers} visuals={visuals} followup={followup}
            nowMin={nowMin} isDark={isDark}
            onToggle={toggleDone} onOpen={(item) => openEditor(item, null)} onNames={() => setNamesOpen(true)}
            onHeld={held} onOpenProspect={openProspect} onAdd={(id) => addFromPalette(id)}
            onSkipToday={(it) => skipToday(it?.blockId)} onDelete={(it) => deleteBlock(it?.blockId)}
            onRemoveMakeup={(it) => removeMakeup(it?.makeupId)} onDetach={detach} onRemoveAppt={removeFromToday}
            startedOf={startedOf}
          />
        </div>
      )}

      <WeeklyLookback week={week} />

      <BlockEditorSheet
        open={!!editingRec}
        block={editingRec}
        isMakeup={editing?.kind === 'makeup'}
        sheet={!isDesktop}
        anchor={editing?.anchor || null}
        attachOptions={attachOptions}
        defaultMinutesBefore={settings.defaultMinutesBefore}
        onSave={(patch) => (editing?.kind === 'makeup' ? updateMakeup(editing.id, patch) : updateBlock(editing?.id, patch))}
        onDelete={() => deleteBlock(editing?.id)}
        onSkipToday={() => skipToday(editing?.id)}
        onAttach={(prospectId) => attach(editing?.id, prospectId)}
        onRemoveMakeup={() => removeMakeup(editing?.id)}
        onClose={() => setEditing(null)}
      />

      <FollowupSheet
        open={namesOpen}
        rows={queue}
        stageLabelOf={(id) => stages.find((s) => s.id === id)?.label || id}
        apptTimeOf={apptTimeOf}
        onOpenProspect={openProspect}
        onClose={() => setNamesOpen(false)}
      />

      <RoutineSettingsSheet
        open={settingsOpen}
        settings={settings}
        stages={stages}
        onChange={commitSettings}
        onStartOver={() => { setSettingsOpen(false); setReplaceOpen(true); }}
        onClose={() => setSettingsOpen(false)}
      />

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-3 rounded-full bg-slate-900 px-4 py-2 text-[12px] font-medium text-white shadow-xl dark:bg-slate-700">
          <span>{toast.text}</span>
          <button type="button" onClick={runUndo} className="font-semibold underline underline-offset-2">Undo</button>
        </div>
      )}
    </div>
  );
}

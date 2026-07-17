'use client';
import { useState, useMemo, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import RepeatedClientBadge from '@/components/RepeatedClientBadge';
import FollowupNextStep from '@/components/FollowupNextStep';
import FollowupTimeline from '@/components/FollowupTimeline';
import LogTouchSheet from '@/components/LogTouchSheet';
import SendOutreachEmail from '../SendOutreachEmail';
import FollowupDueWidget from '../FollowupDueWidget';
import FollowupScorecard from '@/components/FollowupScorecard';
import {
  Plus, Search, LayoutGrid, List as ListIcon, Settings as SettingsIcon, Upload,
  Calendar, CalendarDays, Phone, Mail, MapPin, ArrowRight, Trash2, X, AlertCircle, Clock, GripVertical,
  User, Home, Briefcase, FileText, Pencil, Pill, Activity, DollarSign, Tag, Palette,
  ChevronLeft, ChevronRight, Sparkles, Loader2,
} from 'lucide-react';
import { TiltCard, FadeIn, Stagger, StaggerItem } from '../motion/MotionPrimitives';
import { fmt2, today, formatDob } from '@/lib/utils';
import { newProspect, defaultProspectSettings, detectFieldFromHeader, detectStageId, detectSource, detectIndvOrFamily, prospectDedupKey, formatQuotes, isDateLike } from '@/lib/prospects';
import { DEFAULT_PROSPECT_STAGES, getCrmStyle, PROSPECT_SOURCES, PROSPECT_CRMS } from '@/lib/constants';
import { useIsDark } from '@/lib/useIsDark';
import * as XLSX from 'xlsx';
import ProspectForm from '../ProspectForm';
import SmartProspectImportWizard from '../SmartProspectImportWizard';
import SourceColorManager from '../SourceColorManager';
import { useSourceColors, colorForSource } from '@/lib/sourceColors';
import { dueStatus } from '@/lib/followupEngine.mjs';
import Tooltip from '@/components/Tooltip';

const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

// ---------- helpers ----------
function timeUntil(isoDateTime) {
  const d = apptDate(isoDateTime);
  if (!d) return null;
  const t = d.getTime();
  const now = Date.now();
  const diffMs = t - now;
  if (diffMs > 0 && diffMs < 60 * 60 * 1000) return { mins: Math.round(diffMs / 60000), soon: true, past: false };
  if (diffMs > 0 && diffMs < 24 * 60 * 60 * 1000) return { hours: Math.round(diffMs / 3600000), soon: false, past: false };
  if (diffMs <= 0 && diffMs > -24 * 60 * 60 * 1000) return { mins: Math.round(-diffMs / 60000), soon: false, past: true };
  return null;
}

// Returns a formatted appointment string, OR null if the value isn't a real
// date. Used to be lenient (returned the raw input) but that allowed garbage
// (e.g. situation text accidentally mapped to appointmentTime during import)
// to display in the appointment column. Now we hard-validate.
function formatAppt(iso) {
  if (!iso) return null;
  const s = String(iso).trim();
  if (!s) return null;
  // Reject anything that doesn't look at least like a date string
  // (must contain digits and either dash, slash, or "T")
  if (!/\d/.test(s) || !/[-/T:]/.test(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // Filter out the unix epoch fallback (1970-01-01) which often comes from
  // bad parsing
  if (d.getFullYear() < 2000) return null;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Returns the parsed Date object (or null), used by filters
function apptDate(iso) {
  if (!iso) return null;
  const s = String(iso).trim();
  if (!s || !/\d/.test(s) || !/[-/T:]/.test(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000) return null;
  return d;
}

function isToday(iso) {
  const d = apptDate(iso);
  if (!d) return false;
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}

function isThisWeek(iso) {
  const d = apptDate(iso);
  if (!d) return false;
  const now = new Date();
  // Sunday = 0; treat Monday as start of week
  const day = now.getDay();
  const diffToMon = (day === 0 ? -6 : 1) - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 7);
  return d >= monday && d < sunday;
}

function isUpcoming(iso) {
  const d = apptDate(iso);
  if (!d) return false;
  return d.getTime() > Date.now();
}

function isOverdueAppt(iso, stage) {
  const d = apptDate(iso);
  if (!d) return false;
  if (['SOLD', 'LOST', 'GHOSTED'].includes(stage)) return false;
  return d.getTime() < Date.now() - 12 * 60 * 60 * 1000; // > 12h past
}

function isOverdueFollowup(p) {
  if (['SOLD', 'LOST'].includes(p.stage)) return false;
  const s = dueStatus(p, new Date().toISOString());
  return s.state === 'overdue' || s.state === 'due_today';
}

function FollowupDot({ prospect }) {
  const s = dueStatus(prospect, new Date().toISOString());
  const map = {
    overdue:   { c: 'bg-rose-500',    t: 'Follow-up overdue' },
    due_today: { c: 'bg-amber-500',   t: 'Follow-up due today' },
    ontrack:   { c: 'bg-emerald-500', t: 'On track' },
    snoozed:   { c: 'bg-slate-300',   t: 'Snoozed' },
  };
  const m = map[s.state];
  if (!m) return null; // 'none' / 'done'
  return (
    <Tooltip label={m.t}>
      {/* role+aria-label: the dot is the only signal of follow-up status, and
          the CSS tooltip is hover-only — without an accessible name, screen
          readers can't tell which prospects are overdue (title= used to do this). */}
      <span role="img" aria-label={m.t} className={`inline-block w-2 h-2 rounded-full ${m.c} flex-shrink-0`} />
    </Tooltip>
  );
}

// ---------- TextDrip Chat Section ----------
function TextDripChatSection({ chat }) {
  const msgs = chat?.messages || [];
  if (msgs.length === 0) return null;
  const synced = chat.syncedAt
    ? new Date(chat.syncedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Texts (TextDrip)</span>
          <span className="text-[10px] font-bold uppercase tracking-wider bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded">
            {msgs.length} msg{msgs.length !== 1 ? 's' : ''}
          </span>
        </div>
        {synced && (
          <span className="text-[10px] text-slate-400">synced {synced}</span>
        )}
      </div>
      <div className="p-3 space-y-2 max-h-72 overflow-y-auto bg-white dark:bg-slate-900">
        {/* Display chronologically (oldest first for readability) */}
        {[...msgs].reverse().map((msg, i) => (
          <TextBubble key={i} msg={msg} />
        ))}
      </div>
    </div>
  );
}

function TextBubble({ msg }) {
  const isOut = msg.direction === 'out';
  const timeStr = msg.at
    ? new Date(msg.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          isOut
            ? 'bg-indigo-600 text-white rounded-br-sm'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-sm'
        }`}
      >
        <div className="whitespace-pre-wrap break-words leading-relaxed">{msg.body}</div>
        <div className={`flex items-center gap-1.5 mt-1 text-[10px] ${isOut ? 'text-indigo-200 justify-end' : 'text-slate-400 justify-start'}`}>
          {timeStr && <span>{timeStr}</span>}
          {msg.isDrip && (
            <span className={`uppercase tracking-wider font-bold ${isOut ? 'text-indigo-300' : 'text-slate-400'}`}>drip</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Today Panel ----------
function TodayPanel({ prospects, onEdit }) {
  const todayAppts = prospects
    .filter(p => p.appointmentTime && isToday(p.appointmentTime) && !p.archivedAt)
    .sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));
  const overdue = prospects.filter(p => isOverdueFollowup(p) && !p.archivedAt).slice(0, 8);

  if (todayAppts.length === 0 && overdue.length === 0) return null;

  return (
    <div className="bg-gradient-to-br from-indigo-50 via-white to-violet-50 border border-indigo-100 rounded-xl p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Calendar size={16} className="text-indigo-600" />
        <h3 className="text-sm font-bold text-slate-900 tracking-wide">TODAY</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] font-bold text-slate-500 tracking-wider mb-1.5">APPOINTMENTS</div>
          {todayAppts.length === 0 ? (
            <div className="text-xs text-slate-400 italic">No appointments today.</div>
          ) : (
            <div className="space-y-1.5">
              {todayAppts.map(p => {
                const tu = timeUntil(p.appointmentTime);
                const colorClass = tu?.soon ? 'bg-amber-100 text-amber-800 border-amber-200' :
                                  tu?.past ? 'bg-slate-100 text-slate-500 border-slate-200' :
                                  'bg-white text-slate-700 border-slate-200';
                return (
                  <button key={p.id} onClick={() => onEdit(p)}
                    className={`w-full text-left rounded-lg border px-3 py-2 hover:shadow-sm transition ${colorClass}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm truncate">{p.name || '(no name)'}</div>
                      <div className="text-xs whitespace-nowrap">{formatAppt(p.appointmentTime)}</div>
                    </div>
                    {p.phone && <div className="text-xs text-slate-500 mt-0.5">{p.phone}</div>}
                    {tu?.soon && <div className="text-[11px] font-bold text-amber-700 mt-0.5">In {tu.mins} min</div>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <div className="text-[11px] font-bold text-slate-500 tracking-wider mb-1.5">OVERDUE FOLLOW-UPS</div>
          {overdue.length === 0 ? (
            <div className="text-xs text-slate-400 italic">All caught up.</div>
          ) : (
            <div className="space-y-1.5">
              {overdue.map(p => (
                <button key={p.id} onClick={() => onEdit(p)}
                  className="w-full text-left rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 hover:shadow-sm transition">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-sm text-slate-800 truncate">{p.name || '(no name)'}</div>
                    <div className="text-xs text-orange-700 whitespace-nowrap">last: {p.lastContact}</div>
                  </div>
                  {p.nextSteps && <div className="text-[11px] text-slate-600 mt-0.5 truncate">{p.nextSteps}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Kanban Card ----------
function KanbanCard({ prospect, onEdit, onDragStart, isSelected, onToggleSelect, sourceColor, readOnly = false }) {
  const tu = timeUntil(prospect.appointmentTime);
  const apptStr = formatAppt(prospect.appointmentTime);
  // When the user has assigned a color to this prospect's source, use it
  // as a left-border accent stripe + a slight fill on the source label.
  // Falls back to neutral slate when uncolored.
  const accentStyle = sourceColor
    ? { borderLeftColor: sourceColor, borderLeftWidth: '4px' }
    : undefined;
  return (
    <div
      draggable={!readOnly}
      onDragStart={(e) => onDragStart(e, prospect.id)}
      onClick={() => onEdit(prospect)}
      style={accentStyle}
      className={`bg-white border rounded-lg p-3 cursor-pointer transition-all relative group ${
        isSelected
          ? 'border-indigo-500 ring-2 ring-indigo-300 shadow-md'
          : 'border-slate-200 hover:shadow-lg hover:shadow-indigo-500/10 hover:border-indigo-300 hover:-translate-y-0.5'
      }`}
    >
      {/* Selection checkbox — always visible if selected, on hover otherwise */}
      {!readOnly && (
        <input
          type="checkbox"
          checked={isSelected}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleSelect(prospect.id)}
          className={`absolute top-2 left-2 w-4 h-4 cursor-pointer accent-indigo-600 z-10 transition-opacity ${
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          title="Select"
        />
      )}
      <div className={`flex items-start justify-between gap-2 mb-1 ${isSelected ? 'pl-6' : ''} group-hover:pl-6 transition-all`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <FollowupDot prospect={prospect} />
          <div className="font-semibold text-sm text-slate-900 truncate">{prospect.name || '(no name)'}</div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {prospect.needsReview && (
            <Tooltip label="Imported from your website form — PRIM wasn't 100% sure it read every field right. Open and verify, then clear.">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Double-check</span>
            </Tooltip>
          )}
          {prospect.indvOrFamily === 'Family' && (
            <span className="text-[10px] font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">FAM</span>
          )}
        </div>
      </div>
      {prospect.phone && (
        <div className="text-xs text-slate-500 flex items-center gap-1"><Phone size={11} /> {prospect.phone}</div>
      )}
      {prospect.state && (
        <div className="text-xs text-slate-500 flex items-center gap-1"><MapPin size={11} /> {prospect.state} {prospect.timezone && `· ${prospect.timezone}`}</div>
      )}
      {apptStr && (
        <div className={`mt-1.5 text-[11px] px-2 py-1 rounded inline-flex items-center gap-1
          ${tu?.soon ? 'bg-amber-100 text-amber-800' :
            tu?.past ? 'bg-slate-100 text-slate-500' :
            'bg-indigo-50 text-indigo-700'}`}>
          <Clock size={10} /> {apptStr}
        </div>
      )}
      {formatQuotes(prospect) && (
        <div className="mt-1 text-[11px] font-semibold text-emerald-700 truncate" title={formatQuotes(prospect)}>{formatQuotes(prospect)}</div>
      )}
      {prospect.source && (
        sourceColor ? (
          <div
            className="mt-1.5 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-block"
            style={{
              background: sourceColor + '22',
              color: sourceColor,
              border: `1px solid ${sourceColor}55`,
            }}
          >
            {prospect.source}
          </div>
        ) : (
          <div className="mt-1 text-[10px] text-slate-400">{prospect.source}</div>
        )
      )}
    </div>
  );
}

// ---------- Kanban Column ----------
function KanbanColumn({ stage, prospects, onEdit, onDragStart, onDrop, selected, onToggleSelect, onSelectAllInStage, sourceColors, readOnly = false }) {
  const [over, setOver] = useState(false);
  const allSelectedInCol = prospects.length > 0 && prospects.every(p => selected.has(p.id));
  const someSelectedInCol = prospects.some(p => selected.has(p.id));
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDrop(stage.id); }}
      className={`flex-shrink-0 w-72 rounded-xl p-2.5 transition-all ${over ? 'bg-indigo-50 ring-2 ring-indigo-300/60' : 'bg-slate-50'}`}
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: stage.color }} />
          <span className="text-xs font-bold text-slate-700 tracking-wide uppercase truncate">{stage.label}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs font-semibold text-slate-400">{prospects.length}</span>
          {prospects.length > 0 && !readOnly && (
            <button
              onClick={() => onSelectAllInStage(stage.id, !allSelectedInCol)}
              title={allSelectedInCol ? 'Deselect all in this stage' : 'Select all in this stage'}
              className="text-[10px] font-bold uppercase text-indigo-600 hover:text-indigo-700 hover:bg-indigo-100 px-1.5 py-0.5 rounded"
            >
              {allSelectedInCol ? 'Clear' : someSelectedInCol ? 'All' : 'Select'}
            </button>
          )}
        </div>
      </div>
      <div className="space-y-2 min-h-[80px]">
        {prospects.map(p => (
          <KanbanCard
            key={p.id}
            prospect={p}
            onEdit={onEdit}
            onDragStart={onDragStart}
            isSelected={selected.has(p.id)}
            onToggleSelect={onToggleSelect}
            sourceColor={colorForSource(sourceColors, p.source)}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}

// ---------- Calendar Panel ----------
// Compact month-grid widget that lives above the Kanban/List on the main
// Prospects page. Click a day with appointments to drop down that day's
// list inline. No verbose 14-day list — agents click only the days they
// care about.
function CalendarPanel({ prospects, stages, onView }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [anchor, setAnchor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  // Default the focused day to today so the expanded calendar shows today's
  // appointments right away; clicking another day switches to it.
  const [focusedDay, setFocusedDay] = useState(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  });
  // Collapsed by default — first impression is a single line, agents expand
  // only when they want to see the grid.
  const [collapsed, setCollapsed] = useState(true);

  const byDay = useMemo(() => {
    const m = new Map();
    for (const p of prospects) {
      const d = apptDate(p.appointmentTime);
      if (!d) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(p);
    }
    for (const list of m.values()) {
      list.sort((a, b) => apptDate(a.appointmentTime).getTime() - apptDate(b.appointmentTime).getTime());
    }
    return m;
  }, [prospects]);

  const cells = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last  = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const out = [];
    for (let i = 0; i < first.getDay(); i++) out.push(null);
    for (let d = 1; d <= last.getDate(); d++) {
      const date = new Date(anchor.getFullYear(), anchor.getMonth(), d);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      out.push({ date, key, count: byDay.get(key)?.length || 0 });
    }
    return out;
  }, [anchor, byDay]);

  const monthLabel = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const totalThisMonth = cells.reduce((s, c) => s + (c?.count || 0), 0);
  const focusedItems = focusedDay ? (byDay.get(focusedDay) || []) : [];
  const focusedDate = focusedDay ? new Date(focusedDay + 'T00:00:00') : null;

  const dayCellClass = (count, isToday, isFocused) => {
    // Roomy month-view cells that fill the full-width panel. Day number sits
    // top-left; a count pill sits at the bottom (rendered in the grid below).
    let base = 'h-16 flex flex-col items-start p-1.5 rounded-lg text-xs cursor-pointer transition select-none border';
    if (isFocused) return base + ' border-indigo-600 bg-indigo-100 ring-1 ring-indigo-400';
    if (isToday)   return base + ' border-indigo-300 bg-indigo-50 hover:bg-indigo-100';
    if (count >= 4) return base + ' border-violet-400 bg-violet-200 hover:bg-violet-300 text-violet-900';
    if (count >= 2) return base + ' border-violet-300 bg-violet-100 hover:bg-violet-200 text-violet-800';
    if (count >= 1) return base + ' border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700';
    return base + ' border-slate-200 bg-white hover:bg-slate-50 text-slate-700';
  };

  const focusedDateLabel = focusedDate ? (
    focusedDate.toDateString() === today.toDateString()
      ? 'Today · ' + focusedDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      : focusedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  ) : '';

  return (
    <div className="premium-card p-2.5">
      {/* Header — collapsible */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center gap-2 text-slate-900 hover:text-indigo-700 font-bold text-sm"
        >
          <CalendarDays size={14} className="text-indigo-600" />
          {monthLabel}
          <span className="text-xs font-normal text-slate-500">
            · {totalThisMonth} appointment{totalThisMonth !== 1 ? 's' : ''}
          </span>
          {collapsed ? <ChevronRight size={14} className="text-slate-400" /> : <ChevronLeft size={14} className="text-slate-400 rotate-90" />}
        </button>
        {!collapsed && (
          <div className="flex items-center gap-1">
            <Tooltip label="Previous month">
              <button
                onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}
                className="p-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-600"
                aria-label="Previous month"
              >
                <ChevronLeft size={12} />
              </button>
            </Tooltip>
            <button
              onClick={() => { setAnchor(new Date(today.getFullYear(), today.getMonth(), 1)); setFocusedDay(null); }}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2"
            >
              Today
            </button>
            <Tooltip label="Next month">
              <button
                onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}
                className="p-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-600"
                aria-label="Next month"
              >
                <ChevronRight size={12} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {!collapsed && (
        <>
          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-2 mt-3 mb-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
              <div key={d} className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center">{d}</div>
            ))}
          </div>

          {/* Day grid — roomy month view that fills the full-width panel */}
          <div className="grid grid-cols-7 gap-2">
            {cells.map((c, i) => {
              if (!c) return <div key={`blank-${i}`} className="h-16" />;
              const isToday = c.key === todayKey;
              const isFocused = c.key === focusedDay;
              return (
                <button
                  key={c.key}
                  onClick={() => setFocusedDay(focusedDay === c.key ? null : c.key)}
                  className={dayCellClass(c.count, isToday, isFocused)}
                  title={c.count > 0 ? `${c.count} appointment${c.count !== 1 ? 's' : ''}` : 'No appointments'}
                >
                  <span className="font-semibold text-sm">{c.date.getDate()}</span>
                  {c.count > 0 && (
                    <span className="mt-auto text-[9px] font-bold text-indigo-700 bg-white rounded-full px-1.5 py-0.5 shadow-sm">
                      {c.count} appt{c.count !== 1 ? 's' : ''}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Click-to-expand: appointments for the focused day appear as a
              dropdown panel right below the grid. Replaces the old verbose
              14-day list. */}
          {focusedDay && (
            <div className="mt-3 pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Clock size={11} className="text-indigo-600" />
                  {focusedDateLabel}
                  <span className="text-slate-400 font-normal normal-case">
                    · {focusedItems.length === 0 ? 'No appointments' : `${focusedItems.length} appointment${focusedItems.length !== 1 ? 's' : ''}`}
                  </span>
                </div>
                <Tooltip label="Close">
                  <button
                    onClick={() => setFocusedDay(null)}
                    className="text-slate-400 hover:text-slate-700 p-1"
                    aria-label="Close"
                  >
                    <X size={12} />
                  </button>
                </Tooltip>
              </div>
              {focusedItems.length === 0 ? (
                <div className="text-xs text-slate-500 italic py-2">Nothing scheduled for this day.</div>
              ) : (
                <div className="space-y-1.5">
                  {focusedItems.map(p => {
                    const apptD = apptDate(p.appointmentTime);
                    const stage = stages.find(s => s.id === p.stage);
                    const tu = timeUntil(p.appointmentTime);
                    return (
                      <button
                        key={p.id}
                        onClick={() => onView(p)}
                        className="w-full text-left flex items-center gap-3 px-3 py-2 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-lg transition"
                      >
                        <div className={`text-xs font-bold whitespace-nowrap min-w-[70px] ${tu?.soon ? 'text-amber-700' : tu?.past ? 'text-slate-400' : 'text-slate-700'}`}>
                          {apptD.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-slate-900 truncate flex items-center gap-1.5">
                            {p.name || '(no name)'}
                            {p.indvOrFamily === 'Family' && (
                              <span className="text-[9px] font-bold text-violet-700 bg-violet-100 px-1 py-0.5 rounded">FAM</span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {p.phone && <span>{p.phone}</span>}
                            {p.phone && p.state && <span className="mx-1">·</span>}
                            {p.state && <span>{p.state}</span>}
                            {p.source && <span className="mx-1">·</span>}
                            {p.source && <span>{p.source}</span>}
                          </div>
                        </div>
                        {stage && (
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded whitespace-nowrap"
                            style={{
                              background: (stage.color || '#64748b') + '22',
                              color: stage.color || '#64748b',
                              border: `1px solid ${(stage.color || '#64748b')}44`,
                            }}
                          >
                            {stage.label}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Settings Modal ----------
function SettingsModal({ open, settings, onSave, onClose, onSyncTextDrip }) {
  const [draft, setDraft] = useState(settings);
  if (!open) return null;

  const updateStage = (i, patch) => {
    setDraft(d => ({ ...d, stages: d.stages.map((s, idx) => idx === i ? { ...s, ...patch } : s) }));
  };
  const removeStage = (i) => setDraft(d => ({ ...d, stages: d.stages.filter((_, idx) => idx !== i) }));
  const addStage = () => setDraft(d => ({ ...d, stages: [...d.stages, { id: 'STAGE_' + Date.now(), label: 'New Stage', color: '#6366f1' }] }));
  const moveStage = (i, dir) => {
    setDraft(d => {
      const next = [...d.stages];
      const j = i + dir;
      if (j < 0 || j >= next.length) return d;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...d, stages: next };
    });
  };

  const updateField = (i, patch) => {
    setDraft(d => ({ ...d, customFields: d.customFields.map((f, idx) => idx === i ? { ...f, ...patch } : f) }));
  };
  const removeField = (i) => setDraft(d => ({ ...d, customFields: d.customFields.filter((_, idx) => idx !== i) }));
  const addField = () => setDraft(d => ({ ...d, customFields: [...d.customFields, { id: 'cf_' + Date.now(), label: 'New Field', type: 'text', options: [] }] }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md overlay-fade">
      <div className="bg-white/85 backdrop-blur-2xl border border-white/60 rounded-2xl shadow-2xl shadow-indigo-500/10 modal-pop w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-900">Prospects Settings</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-6">
          {/* Stages */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-900">Pipeline Stages</h3>
              <button onClick={addStage} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"><Plus size={12} /> Add stage</button>
            </div>
            <p className="text-[11px] text-slate-500 mb-2">Drag to reorder, rename freely. Renaming or deleting a stage will keep prospects on it but they'll show as "{`<stage id>`}" until you rename to match.</p>
            <div className="space-y-1.5">
              {draft.stages.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
                  <div className="flex flex-col">
                    <button onClick={() => moveStage(i, -1)} className="text-slate-400 hover:text-slate-700 text-xs">▲</button>
                    <button onClick={() => moveStage(i, 1)} className="text-slate-400 hover:text-slate-700 text-xs">▼</button>
                  </div>
                  <input type="color" value={s.color} onChange={e => updateStage(i, { color: e.target.value })} className="w-8 h-8 rounded cursor-pointer border-0" />
                  <input className={`${inp} flex-1`} value={s.label} onChange={e => updateStage(i, { label: e.target.value })} />
                  <button onClick={() => removeStage(i)} className="text-red-500 hover:bg-red-50 p-1.5 rounded"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </section>

          {/* Custom fields */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-900">Custom Fields</h3>
              <button onClick={addField} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"><Plus size={12} /> Add field</button>
            </div>
            <p className="text-[11px] text-slate-500 mb-2">Add fields specific to your workflow. They'll appear on every prospect form.</p>
            {draft.customFields.length === 0 && (
              <div className="text-xs text-slate-400 italic">No custom fields yet.</div>
            )}
            <div className="space-y-1.5">
              {draft.customFields.map((f, i) => (
                <div key={f.id} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2 flex-wrap">
                  <input className={`${inp} flex-1 min-w-[160px]`} value={f.label} onChange={e => updateField(i, { label: e.target.value })} placeholder="Field label" />
                  <select className={`${inp} w-32`} value={f.type} onChange={e => updateField(i, { type: e.target.value })}>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="dropdown">Dropdown</option>
                  </select>
                  {f.type === 'dropdown' && (
                    <input className={`${inp} flex-1 min-w-[200px]`} value={(f.options || []).join(', ')}
                      onChange={e => updateField(i, { options: e.target.value.split(',').map(o => o.trim()).filter(Boolean) })}
                      placeholder="Option 1, Option 2, ..." />
                  )}
                  <button onClick={() => removeField(i)} className="text-red-500 hover:bg-red-50 p-1.5 rounded"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </section>

          {/* TextDrip integration */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-bold text-slate-900">TextDrip Integration</h3>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">v1</span>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">Connect your TextDrip API key to pull tagged contacts into Prospects as leads with their SMS conversations.</p>
            <TextDripSettingsSection stages={draft.stages} onSyncTextDrip={onSyncTextDrip} />
          </section>

          {/* Ringy integration */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-bold text-slate-900">Ringy Integration</h3>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded">v1</span>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">Receive real-time leads from Ringy via webhook — when you disposition a lead in Ringy, PRIM creates or updates the prospect automatically.</p>
            <RingySettingsSection stages={draft.stages} />
          </section>

          {/* Website Leads integration */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-bold text-slate-900">Website Leads</h3>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded">v1</span>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">Capture leads straight from your website&apos;s contact form — point any form or automation tool at PRIM&apos;s webhook URL and every submission lands in Prospects automatically. No API key needed.</p>
            <WebformsSettingsSection />
          </section>

          {/* Benepath integration */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-bold text-slate-900">Benepath Integration</h3>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">v1</span>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">Receive leads from the Benepath portal in real time — paste PRIM&apos;s Posting URL into a Benepath POST integration and every lead lands in Prospects automatically.</p>
            <BenepathSettingsSection stages={draft.stages} />
          </section>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-slate-200">
          <button onClick={onClose} className="border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg text-sm font-semibold">Cancel</button>
          <button onClick={() => { onSave(draft); onClose(); }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">Save Settings</button>
        </div>
      </div>
    </div>
  );
}

// Thin wrapper that renders TextDripSettings inside the SettingsModal.
// It lives here to avoid circular imports (ProspectsView imports from itself).
function TextDripSettingsSection({ stages, onSyncTextDrip }) {
  // Lazily imported so it doesn't affect the initial bundle for agents who
  // haven't connected TextDrip.
  const [Comp, setComp] = useState(null);
  useEffect(() => {
    import('@/components/TextDripSettings').then(m => setComp(() => m.default));
  }, []);
  if (!Comp) return <div className="text-xs text-slate-400 italic">Loading…</div>;
  return (
    <Comp
      stages={stages}
      onSyncDone={onSyncTextDrip}
      onStatus={() => {}}
    />
  );
}

// Thin wrapper that renders RingySettings inside the SettingsModal.
// Lazily imported so the Ringy bundle is not fetched for agents who haven't set it up.
function RingySettingsSection({ stages }) {
  const [Comp, setComp] = useState(null);
  useEffect(() => {
    import('@/components/RingySettings').then(m => setComp(() => m.default));
  }, []);
  if (!Comp) return <div className="text-xs text-slate-400 italic">Loading…</div>;
  return <Comp stages={stages} />;
}

// Thin wrapper that renders WebformsSettings inside the SettingsModal.
// Lazily imported so the Website Leads bundle is not fetched for agents who haven't set it up.
function WebformsSettingsSection() {
  const [Comp, setComp] = useState(null);
  useEffect(() => {
    import('@/components/WebformsSettings').then(m => setComp(() => m.default));
  }, []);
  if (!Comp) return <div className="text-xs text-slate-400 italic">Loading…</div>;
  return <Comp />;
}

// Thin wrapper that renders BenepathSettings inside the SettingsModal.
// Lazily imported so the Benepath bundle is not fetched for agents who haven't set it up.
function BenepathSettingsSection({ stages }) {
  const [Comp, setComp] = useState(null);
  useEffect(() => {
    import('@/components/BenepathSettings').then(m => setComp(() => m.default));
  }, []);
  if (!Comp) return <div className="text-xs text-slate-400 italic">Loading…</div>;
  return <Comp stages={stages} />;
}

// ---------- Import Wizard ----------
function ImportWizard({ open, file, settings, prospects, onImport, onClose }) {
  const [step, setStep] = useState('preview'); // 'preview' | 'mapping' | 'done'
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [error, setError] = useState('');

  // Load file once when modal opens with a file
  useMemo(() => {
    if (!open || !file) return;
    setError('');
    (async () => {
      try {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
        if (!data || data.length < 2) { setError('Empty or unreadable file.'); return; }
        // Smarter header-row detection: scan the first 12 rows and pick the
        // one with the MOST recognized field names. This handles spreadsheets
        // that start with section labels ("APPOINTMENT SET" etc.) before the
        // actual column headers, or a title row above the headers.
        let headerRowIdx = 0;
        let headerScore = -1;
        for (let i = 0; i < Math.min(data.length, 12); i++) {
          const row = data[i] || [];
          let score = 0;
          for (const cell of row) {
            if (detectFieldFromHeader(cell)) score++;
          }
          if (score > headerScore) {
            headerScore = score;
            headerRowIdx = i;
          }
        }
        // Fallback: if nothing matched any known field, use first non-empty row
        if (headerScore <= 0) {
          for (let i = 0; i < Math.min(data.length, 6); i++) {
            if (data[i].some(c => String(c || '').trim())) { headerRowIdx = i; break; }
          }
        }
        const hdr = data[headerRowIdx].map(c => String(c || '').trim());
        const body = data.slice(headerRowIdx + 1).filter(row => row.some(c => String(c || '').trim()));
        setHeaders(hdr);
        setRows(body);
        // Auto-map columns
        const auto = {};
        hdr.forEach((h, i) => {
          const f = detectFieldFromHeader(h);
          if (f) auto[i] = f;
        });
        setMapping(auto);
        setStep('mapping');
      } catch (e) {
        setError('Could not read file: ' + (e.message || e));
      }
    })();
  }, [open, file]);

  if (!open) return null;

  const FIELD_OPTIONS = [
    ['', '— Skip column —'],
    ['name', 'Name'],
    ['phone', 'Phone'],
    ['email', 'Email'],
    ['state', 'State'],
    ['zip', 'ZIP'],
    ['timezone', 'Time Zone'],
    ['indvOrFamily', 'Indv/Family'],
    ['dobs', 'DOB(s)'],
    ['income', 'Income'],
    ['quoteSize', 'Quote Size'],
    ['policyType', 'Policy Type'],
    ['meds', 'Health Notes'],
    ['situation', 'Situation/Notes'],
    ['startDate', 'Start Date'],
    ['source', 'Lead Source'],
    ['referrer', 'Referrer'],
    ['crm', 'CRM'],
    ['stage', 'Stage'],
    ['appointmentTime', 'Appointment Time'],
    ['nextSteps', 'Next Steps'],
    ['lastContact', 'Last Contact'],
  ];

  const doImport = () => {
    const existingKeys = new Set(prospects.map(prospectDedupKey));
    const fresh = [];
    let dups = 0;
    for (const row of rows) {
      const p = newProspect({});
      for (const [colIdx, field] of Object.entries(mapping)) {
        if (!field) continue;
        const val = String(row[colIdx] ?? '').trim();
        if (!val) continue;
        if (field === 'stage')              p.stage = detectStageId(val, settings.stages);
        else if (field === 'source')        p.source = detectSource(val);
        else if (field === 'indvOrFamily')  p.indvOrFamily = detectIndvOrFamily(val);
        else                                p[field] = val;
      }
      // Skip rows with neither name nor phone
      if (!p.name && !p.phone) continue;
      const key = prospectDedupKey(p);
      if (existingKeys.has(key)) { dups++; continue; }
      existingKeys.add(key);
      fresh.push(p);
    }
    onImport(fresh, dups);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Import Prospects</h2>
            <p className="text-xs text-slate-500 mt-0.5">{file?.name} · {rows.length} rows</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <div className="p-5">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 mb-4 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" /><span>{error}</span>
            </div>
          )}
          {step === 'mapping' && (
            <>
              <p className="text-sm text-slate-700 mb-3">
                Map your columns to prospect fields. We auto-matched what we recognized — adjust anything that's wrong.
              </p>
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {headers.map((h, i) => (
                  <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-lg p-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-700 truncate">{h || `(column ${i + 1})`}</div>
                      <div className="text-[11px] text-slate-400 truncate">e.g. {String(rows[0]?.[i] ?? '').slice(0, 40) || '(empty)'}</div>
                    </div>
                    <ArrowRight size={14} className="text-slate-300" />
                    <select className={`${inp} w-56`}
                      value={mapping[i] || ''}
                      onChange={e => setMapping(m => ({ ...m, [i]: e.target.value }))}>
                      {FIELD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-slate-200">
          <button onClick={onClose} className="border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg text-sm font-semibold">Cancel</button>
          <button onClick={doImport} disabled={!!error || rows.length === 0}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg text-sm font-semibold">
            Import {rows.length} prospects
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Detail Bubble (read-only summary card) ----------
function DetailRow({ Icon, label, value, valueClass = '' }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-2.5 text-sm py-1.5">
      <Icon size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        {label && <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">{label}</div>}
        <div className={`text-slate-800 ${valueClass} break-words`}>{value}</div>
      </div>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <div className="premium-card p-4">
      <h3 className="text-sm font-bold text-slate-900 mb-2">{title}</h3>
      <div className="divide-y divide-slate-100 -my-1.5">{children}</div>
    </div>
  );
}

/**
 * Renders the CRM name in its branded color + bold weight. Picks the
 * light-mode or dark-mode color based on the active theme so each
 * brand stays vivid against the current canvas.
 */
function CrmLabel({ crm }) {
  const isDark = useIsDark();
  const style = getCrmStyle(crm);
  return (
    <span style={{ color: isDark ? style.colorDark : style.color, fontWeight: 700 }}>
      {style.label || crm}
    </span>
  );
}

/**
 * Compact list of outreach emails fired for this prospect, newest
 * first. Each row shows the template name, when it went out, and the
 * latest tracking signal (delivered / opened / clicked / bounced) from
 * Resend's webhook updates. Hover the timestamp for the full ISO.
 */
function OutreachLogList({ log }) {
  // Capture "now" once via state so React's purity rule isn't tripped
  // by reading Date.now() in render. Re-renders use the same anchor.
  const [now] = useState(() => Date.now());

  const sorted = [...(log || [])].sort((a, b) => {
    const ax = new Date(a?.sentAt || 0).getTime();
    const bx = new Date(b?.sentAt || 0).getTime();
    return bx - ax;
  });

  const fmtRelative = (iso) => {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (!isFinite(t)) return '';
    const diff = now - t;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  };

  const statusOf = (entry) => {
    if (entry?.bouncedAt)    return { label: 'Bounced',   cls: 'bg-rose-50 text-rose-700 border-rose-200' };
    if (entry?.complainedAt) return { label: 'Complaint', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
    if (entry?.clickedAt)    return { label: 'Clicked',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    if (entry?.openedAt)     return { label: 'Opened',    cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
    if (entry?.deliveredAt)  return { label: 'Delivered', cls: 'bg-slate-100 text-slate-700 border-slate-200' };
    return { label: 'Sent', cls: 'bg-slate-100 text-slate-700 border-slate-200' };
  };

  return (
    <div className="space-y-2 py-2">
      {sorted.map((entry, i) => {
        const status = statusOf(entry);
        return (
          <div key={entry?.messageId || i} className="flex items-center justify-between gap-2 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-900 truncate">
                {entry?.templateName || entry?.subject || 'Email'}
              </div>
              <div className="text-[11px] text-slate-500 truncate" title={entry?.sentAt}>
                {fmtRelative(entry?.sentAt)}
                {entry?.recipient && <> &middot; <span className="font-mono">{entry.recipient}</span></>}
              </div>
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${status.cls} flex-shrink-0`}>
              {status.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ProspectDetail({ open, prospect, settings, onClose, onEdit, onDelete, onConvertToLead, onProspectUpdate, playbook, onLogTouch, onOutreachEmailSent, agentName, onApplyStageSuggestion, onSnooze, onResolveReminder, onExtractFromTexts, readOnly = false }) {
  const [logOpen, setLogOpen] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  // ProspectDetail stays mounted across prospects — clear any pending
  // suggestion when the viewed prospect changes or the modal closes, so a
  // suggestion from one prospect can never be applied to another.
  useEffect(() => { setSuggestion(null); }, [prospect?.id, open]);
  if (!open || !prospect) return null;
  const stage = settings.stages.find(s => s.id === prospect.stage);
  const stageColor = stage?.color || '#64748b';
  const stageLabel = stage?.label || prospect.stage;
  const isSold = prospect.stage === 'SOLD';
  const created = prospect.createdAt ? new Date(prospect.createdAt) : null;
  const daysSinceCreated = created ? Math.floor((Date.now() - created.getTime()) / 86400000) : null;
  const apptD = apptDate(prospect.appointmentTime);

  // Portal-mount this modal to the document body so it escapes the
  // ViewMount <motion.div> ancestor that applies a transform. Any
  // ancestor with `transform` breaks `position: fixed` (it pins to
  // the transformed ancestor instead of the viewport), which is why
  // the modal was rendering BELOW the page header instead of over
  // it. The portal target only exists on the client, so guard.
  if (typeof document === 'undefined') return null;

  const modal = (
    // Outer scroller — if the whole modal is somehow taller than the
    // viewport (small laptop screens + big custom-fields list), the
    // user can scroll the entire modal up/down. Inside the modal we
    // use flex-column so the hero + footer stay pinned and only the
    // middle body scrolls — that was the bug Juan caught: hero used
    // to scroll out of view together with the body.
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-md overlay-fade overflow-y-auto" onClick={onClose}>
      <div className="min-h-full flex items-center justify-center p-4">
        <div onClick={e => e.stopPropagation()} className="bg-slate-50 border border-white/60 rounded-2xl shadow-2xl shadow-indigo-500/10 modal-pop w-full max-w-2xl max-h-[92vh] flex flex-col">
          {/* Hero header — pinned, doesn't scroll */}
          <div className="bg-white rounded-t-2xl border-b border-slate-200 p-6 relative flex-shrink-0">
          <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 p-1">
            <X size={20} />
          </button>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: stageColor + '22', color: stageColor }}>
              {stageLabel}
            </span>
            {prospect.indvOrFamily === 'Family' && (
              <span className="text-[11px] font-bold text-violet-700 bg-violet-100 px-2.5 py-1 rounded-full">FAMILY</span>
            )}
            {prospect.source && (
              <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">{prospect.source}</span>
            )}
            {prospect.needsReview && (
              <>
                <Tooltip label="Imported from your website form — PRIM wasn't 100% sure it read every field right. Open and verify, then clear.">
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Double-check</span>
                </Tooltip>
                {!readOnly && (
                  <button
                    onClick={() => onProspectUpdate?.({ ...prospect, needsReview: false })}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/20">
                    Mark reviewed
                  </button>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{prospect.name || '(no name)'}</h2>
            <RepeatedClientBadge lead={prospect} />
          </div>
          <div className="text-sm text-slate-500 mt-1 space-y-0.5">
            {formatQuotes(prospect) && (
              <div className="flex items-center gap-1.5"><DollarSign size={14} className="text-emerald-600" /><span className="text-emerald-700 font-semibold">Quote: {formatQuotes(prospect)}</span></div>
            )}
            {created && (
              <div>Added: {created.toLocaleDateString()} ({daysSinceCreated} day{daysSinceCreated !== 1 ? 's' : ''} ago)</div>
            )}
            {apptD && (
              <div className="font-semibold text-indigo-700">Appointment: {apptD.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
            )}
          </div>
        </div>

        {/* Body sections — flex-1 + overflow-y-auto so only this middle
            region scrolls. Hero stays pinned at top, footer at bottom. */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Follow-up next-step coaching card — an action card, hidden in
              the leader's read-only mirror */}
          {!readOnly && (
            <div className="mb-3">
              <FollowupNextStep
                prospect={prospect}
                playbook={playbook}
                agentName={agentName}
                onLogTouch={() => setLogOpen(true)}
                onSnooze={(days) => onSnooze?.(prospect.id, days)}
              />
            </div>
          )}
          {suggestion && (
            <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50 p-3 flex items-center gap-2">
              <Sparkles size={15} className="text-violet-600 flex-shrink-0" />
              <div className="flex-1 text-sm text-slate-700">{suggestion.reason}</div>
              <button
                onClick={() => { onApplyStageSuggestion?.(prospect.id, suggestion.stage); setSuggestion(null); onClose?.(); }}
                className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap">
                Move to {settings.stages.find(s => s.id === suggestion.stage)?.label || suggestion.stage}
              </button>
              <button onClick={() => setSuggestion(null)} className="text-slate-400 hover:text-slate-700 text-xs font-semibold px-2">Dismiss</button>
            </div>
          )}
          {/* Primary Information */}
          <DetailSection title="Primary Information">
            <DetailRow Icon={User} value={prospect.indvOrFamily === 'Family' ? 'Family policy' : 'Individual'} />
            {prospect.dobs && <DetailRow Icon={Calendar} value={formatDob(prospect.dobs)} />}
            {prospect.phone && <DetailRow Icon={Phone} value={<a href={`tel:${prospect.phone}`} className="text-indigo-700 hover:underline">{prospect.phone}</a>} />}
            {prospect.email && <DetailRow Icon={Mail} value={<a href={`mailto:${prospect.email}`} className="text-indigo-700 hover:underline break-all">{prospect.email}</a>} />}
            {(prospect.state || prospect.zip || prospect.timezone) && (
              <DetailRow Icon={Home} value={[prospect.state, prospect.zip, prospect.timezone].filter(Boolean).join(' · ')} />
            )}
          </DetailSection>

          {/* Pipeline Activity */}
          {(prospect.lastContact || prospect.appointmentTime || prospect.nextSteps || prospect.crm || prospect.leadVendor) && (
            <DetailSection title="Pipeline Activity">
              {prospect.appointmentTime && (
                <DetailRow Icon={Clock} label="Appointment" value={apptD?.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} valueClass="font-semibold" />
              )}
              {prospect.lastContact && (
                <DetailRow Icon={Activity} label="Last Contact" value={prospect.lastContact} />
              )}
              {prospect.nextSteps && (
                <DetailRow Icon={ArrowRight} label="Next Steps" value={prospect.nextSteps} valueClass="font-medium" />
              )}
              {prospect.crm && prospect.crm !== 'None' && (
                <DetailRow Icon={Tag} label="CRM" value={<CrmLabel crm={prospect.crm} />} />
              )}
              {prospect.referrer && (
                <DetailRow Icon={User} label="Referred By" value={prospect.referrer} />
              )}
              {prospect.leadVendor && (
                <DetailRow Icon={Tag} label="Lead Vendor" value={prospect.leadVendor} />
              )}
            </DetailSection>
          )}

          {/* Coverage Needs */}
          {(prospect.policyType || prospect.income || formatQuotes(prospect) || isDateLike(prospect.startDate)) && (
            <DetailSection title="Coverage Needs">
              {prospect.policyType && <DetailRow Icon={Briefcase} label="Policy Type" value={prospect.policyType} />}
              {prospect.income && <DetailRow Icon={DollarSign} label="Income" value={prospect.income} />}
              {formatQuotes(prospect) && <DetailRow Icon={DollarSign} label="Quotes" value={formatQuotes(prospect)} valueClass="font-semibold text-emerald-700" />}
              {isDateLike(prospect.startDate) && <DetailRow Icon={Calendar} label="Desired Start" value={prospect.startDate} />}
            </DetailSection>
          )}

          {/* Notes / Health */}
          {(prospect.situation || prospect.meds) && (
            <DetailSection title="Notes">
              {prospect.meds && <DetailRow Icon={Pill} label="Health Notes" value={prospect.meds} />}
              {prospect.situation && <DetailRow Icon={FileText} label="Situation" value={prospect.situation} />}
            </DetailSection>
          )}

          {/* Custom fields */}
          {settings.customFields?.length > 0 && Object.values(prospect.custom || {}).some(v => v !== '' && v != null) && (
            <DetailSection title="Custom Fields">
              {settings.customFields.map(cf => {
                const v = prospect.custom?.[cf.id];
                if (v === '' || v == null) return null;
                return <DetailRow key={cf.id} Icon={Tag} label={cf.label} value={String(v)} />;
              })}
            </DetailSection>
          )}

          {/* Follow-up activity — merged touch log + email log */}
          <DetailSection title="Follow-up activity">
            <FollowupTimeline
              touchLog={prospect.touchLog}
              emailLog={prospect.emailLog}
              onResolveReminder={onResolveReminder ? (touchId) => onResolveReminder(prospect.id, touchId) : undefined}
            />
          </DetailSection>

          {/* TextDrip SMS thread — only shown when chat data exists */}
          {prospect.textdripChat?.messages?.length > 0 && (
            <div>
              <TextDripChatSection chat={prospect.textdripChat} />
              {onExtractFromTexts && (
                <button
                  onClick={() => onExtractFromTexts(prospect.id)}
                  className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-500/40 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 flex items-center gap-1.5"
                >
                  ✨ Extract details from texts
                </button>
              )}
            </div>
          )}
        </div>

        {/* Action footer — flex-shrink-0 keeps it pinned at the bottom
            of the modal card. Hidden entirely in the read-only mirror. */}
        {!readOnly && (
        <div className="bg-white border-t border-slate-200 rounded-b-2xl p-4 flex items-center justify-between gap-2 flex-shrink-0 flex-wrap">
          <button onClick={() => onDelete(prospect.id)}
            className="text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
            <Trash2 size={14} /> Delete
          </button>
          <div className="flex gap-2 items-center flex-wrap">
            {/* Always-available Log touch — works on any prospect, any stage,
                independent of the suggested-next-step card. */}
            <button onClick={() => setLogOpen(true)}
              className="border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5">
              <Phone size={14} /> Log touch
            </button>
            {/* Outreach email — only renders for allowlist beta users
                (component handles its own access gate). */}
            <SendOutreachEmail
              prospect={prospect}
              onLogged={(entry) => onOutreachEmailSent?.(prospect.id, entry)}
            />
            {isSold && (
              <button onClick={() => onConvertToLead(prospect)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5">
                <ArrowRight size={14} /> Convert to Lead
              </button>
            )}
            <button onClick={() => onEdit(prospect)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5">
              <Pencil size={14} /> Edit
            </button>
          </div>
        </div>
        )}
        </div>{/* /modal card */}
      </div>{/* /flex centering wrapper */}
    </div>
  );

  return (
    <>
      {createPortal(modal, document.body)}
      {createPortal(
        <LogTouchSheet
          open={logOpen}
          prospectName={prospect.name}
          defaultChannel={(playbook?.stages?.[prospect.stage]?.steps?.[prospect.cadence?.stepIndex || 0]?.channel) || 'Call'}
          onSave={(touch) => { const s = onLogTouch?.(prospect.id, touch); if (s) setSuggestion(s); }}
          onClose={() => setLogOpen(false)}
        />,
        document.body
      )}
    </>
  );
}

// ---------- Kanban Scroller ----------
// Two synchronized scrollbars: a thin one at the top (visible mirror) +
// the actual content scrollbar at the bottom. Scrolling either updates
// the other so users with many stages can scroll from the top without
// having to drag down to the bottom of the page.
function KanbanScroller({ topScrollRef, bodyScrollRef, innerWidth, setInnerWidth, children }) {
  // Track the body's scrollWidth so the top mirror has the same width
  useLayoutEffect(() => {
    const el = bodyScrollRef.current;
    if (!el) return;
    const measure = () => setInnerWidth(el.scrollWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Re-measure on child changes too
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [bodyScrollRef, setInnerWidth]);

  // Use a ref so both scroll handlers share the same flag across renders.
  const syncingRef = useRef(false);
  const onTopScroll = (e) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (bodyScrollRef.current) bodyScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    requestAnimationFrame(() => { syncingRef.current = false; });
  };
  const onBodyScroll = (e) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (topScrollRef.current) topScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    requestAnimationFrame(() => { syncingRef.current = false; });
  };

  return (
    <div>
      <div
        ref={topScrollRef}
        onScroll={onTopScroll}
        className="overflow-x-auto overflow-y-hidden h-3 mb-1 rounded"
        style={{ scrollbarWidth: 'thin' }}
      >
        <div style={{ width: innerWidth || 1, height: 1 }} />
      </div>
      <div ref={bodyScrollRef} onScroll={onBodyScroll} className="overflow-x-auto pb-3 scroll-fade-x">
        {children}
      </div>
    </div>
  );
}

// ---------- Main View ----------
export default function ProspectsView({
  prospects = [],
  settings,
  onAdd,
  onUpdate,
  onDelete,
  onBulkAdd,
  onSaveSettings,
  onConvertToLead,
  playbook = { stages: {} },
  onLogTouch,
  onOutreachEmailSent,
  onSnoozeProspect,
  onApplyStageSuggestion,
  onResolveReminder,
  onSyncTextDrip,
  onExtractFromTexts,
  // readOnly: rendered inside the Team leader mirror with ANOTHER user's
  // data — hide every mutate affordance; viewing client records stays.
  readOnly = false,
}) {
  const cfg = settings || defaultProspectSettings();
  const [view, setView] = useState('kanban'); // 'kanban' | 'list'
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [apptFilter, setApptFilter] = useState(''); // '' | 'today' | 'week' | 'upcoming' | 'overdue' | 'none'
  const [sourceFilter, setSourceFilter] = useState(''); // '' | source string
  const [crmFilter, setCrmFilter] = useState('');       // '' | crm string
  const [sortBy, setSortBy] = useState('');             // '' | 'appt' | 'name'
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);  // read-only detail bubble
  const [showSettings, setShowSettings] = useState(false);
  const [showSourceColors, setShowSourceColors] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [showSmartImport, setShowSmartImport] = useState(false);
  const [tdSyncing, setTdSyncing] = useState(false); // header Sync TextDrip busy state
  const [selected, setSelected] = useState(() => new Set());

  // Per-agent source-color map; reloaded after the manager modal saves.
  const { colors: sourceColors, reload: reloadSourceColors } = useSourceColors();
  const fileRef = useRef(null);
  const dragId = useRef(null);
  // Refs for the dual-scrollbar Kanban (top mirror + body)
  const topScrollRef = useRef(null);
  const bodyScrollRef = useRef(null);
  const [kanbanInnerWidth, setKanbanInnerWidth] = useState(0);

  const visible = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = prospects.filter(p => {
      if (p.archivedAt) return false;
      if (stageFilter && p.stage !== stageFilter) return false;
      if (sourceFilter && p.source !== sourceFilter) return false;
      if (crmFilter && p.crm !== crmFilter) return false;
      if (apptFilter) {
        if (apptFilter === 'today'    && !isToday(p.appointmentTime)) return false;
        if (apptFilter === 'week'     && !isThisWeek(p.appointmentTime)) return false;
        if (apptFilter === 'upcoming' && !isUpcoming(p.appointmentTime)) return false;
        if (apptFilter === 'overdue'  && !isOverdueAppt(p.appointmentTime, p.stage)) return false;
        if (apptFilter === 'none'     && apptDate(p.appointmentTime)) return false;
      }
      if (!q) return true;
      const blob = `${p.name} ${p.phone} ${p.email} ${p.state} ${p.notes} ${p.situation} ${p.referrer}`.toLowerCase();
      return blob.includes(q);
    });
    if (sortBy === 'name') {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    } else if (sortBy === 'appt') {
      // Closest to today first: upcoming appointments nearest-first, then past
      // appointments most-recent-first, then prospects with no appointment.
      const now = Date.now();
      const rank = (p) => {
        const d = apptDate(p.appointmentTime);
        if (!d) return [2, 0];
        const t = d.getTime();
        return t >= now ? [0, t - now] : [1, now - t];
      };
      list.sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        return ra[0] - rb[0] || ra[1] - rb[1];
      });
    }
    return list;
  }, [prospects, search, stageFilter, apptFilter, sourceFilter, crmFilter, sortBy]);

  // Build the union of built-in PROSPECT_SOURCES + any custom values
  // an agent has entered. That way a free-text source like "TikTok Ads"
  // still appears in the filter dropdown if at least one prospect uses it.
  const sourceOptions = useMemo(() => {
    const set = new Set(PROSPECT_SOURCES);
    for (const p of prospects) {
      if (p?.source && typeof p.source === 'string') set.add(p.source);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [prospects]);

  // Same idea for CRMs — built-in list plus any custom values in use.
  const crmOptions = useMemo(() => {
    const set = new Set(PROSPECT_CRMS.filter(c => c !== 'None'));
    for (const p of prospects) {
      if (p?.crm && p.crm !== 'None' && typeof p.crm === 'string') set.add(p.crm);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [prospects]);

  const grouped = useMemo(() => {
    const map = new Map(cfg.stages.map(s => [s.id, []]));
    for (const p of visible) {
      if (!map.has(p.stage)) map.set(p.stage, []);
      map.get(p.stage).push(p);
    }
    return map;
  }, [visible, cfg.stages]);

  const totals = useMemo(() => {
    const active = prospects.filter(p => !p.archivedAt && !['SOLD', 'LOST'].includes(p.stage));
    const apptsToday = prospects.filter(p => p.appointmentTime && isToday(p.appointmentTime) && !p.archivedAt).length;
    const sold = prospects.filter(p => p.stage === 'SOLD').length;
    return { active: active.length, apptsToday, sold };
  }, [prospects]);

  const onDragStart = (e, id) => { dragId.current = id; e.dataTransfer.effectAllowed = 'move'; };
  const onDrop = (stageId) => {
    if (!dragId.current) return;
    const p = prospects.find(x => x.id === dragId.current);
    if (p && p.stage !== stageId) {
      // Disposition: dropping into Sold auto-converts to a Lead.
      if (stageId === 'SOLD' && p.stage !== 'SOLD') {
        if (confirm(`Mark ${p.name || 'this prospect'} as Sold? This converts them to a Lead and archives the prospect.`)) {
          onConvertToLead({ ...p, stage: 'SOLD' });
        }
      } else {
        onUpdate({ ...p, stage: stageId });
      }
    }
    dragId.current = null;
  };

  const startNew = () => setEditing(newProspect({ createdAt: '' }));
  // Click anywhere a row/card → open the read-only detail bubble.
  // The bubble has its own Edit button which switches to the form.
  const onView = (p) => setViewing(p);
  const onEdit = (p) => { setViewing(null); setEditing(p); };
  const onSave = (p) => {
    const isNew = !p.createdAt;
    const final = isNew ? { ...p, createdAt: new Date().toISOString() } : p;
    // Disposition: saving with stage = Sold (and it wasn't already Sold)
    // auto-fires the convert-to-Lead flow.
    const wasSold = !isNew && prospects.find(x => x.id === p.id)?.stage === 'SOLD';
    if (final.stage === 'SOLD' && !wasSold) {
      if (confirm(`Mark ${final.name || 'this prospect'} as Sold? This converts them to a Lead and archives the prospect.`)) {
        if (isNew) onAdd(final);
        onConvertToLead(final);
        setEditing(null);
        return;
      }
    }
    if (isNew) onAdd(final); else onUpdate(final);
    setEditing(null);
  };
  const onDeleteWrap = (id) => { onDelete(id); setEditing(null); };
  const onConvertWrap = (p) => {
    onConvertToLead({ ...p, createdAt: p.createdAt || new Date().toISOString() });
    setEditing(null);
  };

  // ----- Bulk selection helpers -----
  const toggleAllInStage = (stageId, makeSelected) => {
    const ids = (grouped.get(stageId) || []).map(p => p.id);
    setSelected(s => {
      const next = new Set(s);
      ids.forEach(id => { if (makeSelected) next.add(id); else next.delete(id); });
      return next;
    });
  };
  const allVisibleSelected = visible.length > 0 && visible.every(p => selected.has(p.id));
  const toggleOne = (id, e) => {
    if (e) e.stopPropagation();
    setSelected(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelected(s => {
        const next = new Set(s);
        visible.forEach(p => next.delete(p.id));
        return next;
      });
    } else {
      setSelected(s => {
        const next = new Set(s);
        visible.forEach(p => next.add(p.id));
        return next;
      });
    }
  };
  const clearSelection = () => setSelected(new Set());
  const bulkDelete = () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} prospect${selected.size !== 1 ? 's' : ''}? This can't be undone.`)) return;
    selected.forEach(id => onDelete(id));
    clearSelection();
  };
  const bulkSetStage = (stageId) => {
    if (selected.size === 0 || !stageId) return;
    const targets = [...selected].map(id => prospects.find(x => x.id === id)).filter(Boolean);
    // Disposition: bulk-moving to Sold converts each to a Lead. Confirm
    // because this is a meaningful state change that creates new records.
    if (stageId === 'SOLD') {
      const toConvert = targets.filter(p => p.stage !== 'SOLD');
      if (toConvert.length === 0) { clearSelection(); return; }
      if (!confirm(`Mark ${toConvert.length} prospect${toConvert.length !== 1 ? 's' : ''} as Sold? Each will be converted to a Lead and archived.`)) {
        clearSelection();
        return;
      }
      toConvert.forEach(p => onConvertToLead({ ...p, stage: 'SOLD' }));
      clearSelection();
      return;
    }
    targets.forEach(p => {
      if (p.stage !== stageId) onUpdate({ ...p, stage: stageId });
    });
    clearSelection();
  };

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    if (f) setImportFile(f);
    if (fileRef.current) fileRef.current.value = '';
  };
  const onImportDone = (fresh, dups) => {
    if (fresh.length) onBulkAdd(fresh);
    setImportFile(null);
    alert(`Imported ${fresh.length} prospects${dups ? ` · ${dups} duplicates skipped` : ''}.`);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center"><span className="section-accent" />Prospects</h1>
          <p className="text-sm text-slate-500">{totals.active} active · {totals.apptsToday} appt{totals.apptsToday !== 1 ? 's' : ''} today · {totals.sold} sold all-time</p>
        </div>
        {/* flex-wrap so the action buttons stack onto multiple rows on narrow
            (mobile) screens instead of overflowing off the edge. */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <input type="file" ref={fileRef} accept=".csv,.xlsx,.xls" onChange={onPickFile} className="hidden" />
          {onSyncTextDrip && (
            <Tooltip label="Pull tagged contacts from TextDrip into Prospects" side="bottom">
              <button
                onClick={async () => {
                  if (tdSyncing) return;
                  setTdSyncing(true);
                  try { await onSyncTextDrip(); } finally { setTdSyncing(false); }
                }}
                disabled={tdSyncing}
                className="border border-violet-200 hover:border-violet-400 hover:bg-violet-50 text-violet-700 rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait"
              >
                {tdSyncing ? (<><Loader2 size={14} className="animate-spin" /> Syncing…</>) : (<>💬 Sync TextDrip</>)}
              </button>
            </Tooltip>
          )}
          {!readOnly && (<>
          <Tooltip label="Drop any pipeline file (Excel, CSV, PDF, screenshot) — AI extracts every prospect" side="bottom">
            <button onClick={() => setShowSmartImport(true)}
              className="bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-500/30">
              ✨ Smart Import (AI)
            </button>
          </Tooltip>
          <button onClick={() => fileRef.current?.click()}
            className="border border-slate-200 hover:bg-slate-50 rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5">
            <Upload size={14} /> Classic
          </button>
          <Tooltip label="Color-code prospect cards by lead source" side="bottom">
            <button onClick={() => setShowSourceColors(true)}
              className="border border-violet-200 hover:border-violet-400 hover:bg-violet-50 text-violet-700 rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5">
              <Palette size={14} /> Color sources
            </button>
          </Tooltip>
          <button onClick={() => setShowSettings(true)}
            className="border border-slate-200 hover:bg-slate-50 rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5">
            <SettingsIcon size={14} /> Settings
          </button>
          <button onClick={startNew}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5">
            <Plus size={14} /> New Prospect
          </button>
          </>)}
        </div>
      </div>

      {/* Playbook follow-ups (the accountability list) — prospects whose
          next manual touch is due today or overdue, any channel. Driven by
          the cadence engine. Sits above the email widget so "who needs a
          touch" is the first thing agents see. */}
      <FollowupDueWidget
        prospects={prospects}
        playbook={playbook}
        onOpenProspect={(id) => {
          const p = prospects.find(x => x.id === id);
          if (p) onView(p);
        }}
      />

      {prospects.length > 0 && (
        <FollowupScorecard prospects={prospects} stages={cfg.stages} />
      )}

      {/* Calendar widget — appointments month grid; click a day in the
          expanded grid to drop down that day's appointments. Ordered last,
          below the performance scorecard (Needs-a-touch → Follow-up
          performance → Calendar). The legacy TodayPanel (white APPOINTMENTS
          + OVERDUE FOLLOW-UPS box) was removed — that data already lives
          inside the calendar dropdown and the Follow-ups widget. */}
      {prospects.length > 0 && (
        <CalendarPanel prospects={visible} stages={cfg.stages} onView={onView} />
      )}

      {/* Bulk action bar — appears whenever something is selected, in either view */}
      {selected.size > 0 && (
        <div className="bg-indigo-600 text-white rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap shadow-lg">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{selected.size} selected</span>
            <button onClick={clearSelection} className="text-xs underline opacity-80 hover:opacity-100">clear</button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              defaultValue=""
              onChange={(e) => { bulkSetStage(e.target.value); e.target.value = ''; }}
              className="bg-indigo-700 border border-indigo-500 text-white text-xs font-semibold rounded-lg px-3 py-1.5 cursor-pointer"
            >
              <option value="" disabled>Move to stage…</option>
              {cfg.stages.map(s => <option key={s.id} value={s.id} className="bg-white text-slate-900">{s.label}</option>)}
            </select>
            <button onClick={bulkDelete}
              className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5">
              <Trash2 size={12} /> Delete {selected.size}
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="premium-card p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder="Search name, phone, email..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" title="Filter by stage">
          <option value="">All stages</option>
          {cfg.stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" title="Filter by lead source">
          <option value="">All sources</option>
          {sourceOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={crmFilter} onChange={e => setCrmFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" title="Filter by CRM">
          <option value="">All CRMs</option>
          {crmOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={apptFilter} onChange={e => setApptFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" title="Filter by appointment time">
          <option value="">Any time</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="upcoming">Upcoming</option>
          <option value="overdue">Overdue</option>
          <option value="none">No appointment</option>
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" title="Sort order">
          <option value="">Sort: Default</option>
          <option value="appt">Sort: Appointment (soonest)</option>
          <option value="name">Sort: Name A–Z</option>
        </select>
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          <button onClick={() => setView('kanban')}
            className={`px-3 py-1.5 text-xs font-semibold rounded flex items-center gap-1.5 ${view === 'kanban' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
            <LayoutGrid size={12} /> Kanban
          </button>
          <button onClick={() => setView('list')}
            className={`px-3 py-1.5 text-xs font-semibold rounded flex items-center gap-1.5 ${view === 'list' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
            <ListIcon size={12} /> List
          </button>
        </div>
      </div>

      {/* Empty state */}
      {prospects.length === 0 && (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center">
          <h3 className="text-lg font-bold text-slate-900 mb-1">No prospects yet</h3>
          {readOnly ? (
            <p className="text-sm text-slate-500">This agent hasn&apos;t added any prospects yet.</p>
          ) : (
            <>
              <p className="text-sm text-slate-500 mb-4">Add your first prospect or import from a CSV/Excel file (your existing pipeline works).</p>
              <div className="flex items-center justify-center gap-2">
                <button onClick={startNew} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-semibold">+ New Prospect</button>
                <button onClick={() => fileRef.current?.click()} className="border border-slate-200 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold">Import file</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* (Calendar widget was moved above the Toolbar so both collapsible
          dropdowns — Follow-ups and Calendar — sit together at the top of
          the page, and the search/filters row lands directly above the
          kanban/list.) */}

      {/* Kanban — dual scrollbar (top + bottom) so users can scroll from
           wherever is closer. Top bar is a thin mirror that drives the body. */}
      {prospects.length > 0 && view === 'kanban' && (
        <KanbanScroller
          topScrollRef={topScrollRef}
          bodyScrollRef={bodyScrollRef}
          innerWidth={kanbanInnerWidth}
          setInnerWidth={setKanbanInnerWidth}
        >
          <div className="flex gap-3 min-w-min">
            {cfg.stages.map(s => (
              <KanbanColumn
                key={s.id}
                stage={s}
                prospects={grouped.get(s.id) || []}
                onEdit={onView}
                onDragStart={onDragStart}
                onDrop={onDrop}
                selected={selected}
                onToggleSelect={(id) => toggleOne(id)}
                onSelectAllInStage={toggleAllInStage}
                sourceColors={sourceColors}
                readOnly={readOnly}
              />
            ))}
          </div>
        </KanbanScroller>
      )}

      {/* List — compact 3-column layout: Name · Phone · Appt time + Stage.
          Click any row to open the read-only detail bubble. */}
      {prospects.length > 0 && view === 'list' && (
        <div className="premium-card overflow-hidden">
          <table className="w-full text-sm border-collapse premium-table">
            <thead>
              <tr className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5 text-left border-b-2 border-slate-200 border-r border-slate-200 w-10">
                  {!readOnly && (
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      className="cursor-pointer accent-indigo-600 w-4 h-4"
                      title="Select all visible"
                    />
                  )}
                </th>
                <th className="px-4 py-2.5 text-left border-b-2 border-slate-200 border-r border-slate-200">Name</th>
                <th className="px-4 py-2.5 text-left border-b-2 border-slate-200 border-r border-slate-200 w-44">Phone</th>
                <th className="px-4 py-2.5 text-left border-b-2 border-slate-200 border-r border-slate-200 w-56">Appointment</th>
                <th className="px-4 py-2.5 text-right border-b-2 border-slate-200 w-40">Stage</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(p => {
                const st = cfg.stages.find(s => s.id === p.stage);
                const stColor = st?.color || '#64748b';
                const tu = timeUntil(p.appointmentTime);
                const apptStr = formatAppt(p.appointmentTime);
                const isSel = selected.has(p.id);
                return (
                  <tr
                    key={p.id}
                    onClick={() => onView(p)}
                    className={`cursor-pointer transition border-b border-slate-200 last:border-b-0 ${isSel ? 'bg-indigo-50' : 'hover:bg-indigo-50/40'}`}
                  >
                    {/* Stage accent bar — inset shadow (not a border) so the
                        4px color edge never shifts the checkbox column. */}
                    <td className="px-3 py-3 border-r border-slate-200 align-middle"
                      style={{ boxShadow: `inset 4px 0 0 0 ${stColor}` }}
                      onClick={(e) => e.stopPropagation()}>
                      {!readOnly && (
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={(e) => toggleOne(p.id, e)}
                          className="cursor-pointer accent-indigo-600 w-4 h-4"
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 border-r border-slate-200 align-middle">
                      <div className="font-semibold text-slate-900 truncate flex items-center gap-2">
                        {p.name || '(no name)'}
                        {p.indvOrFamily === 'Family' && (
                          <span className="text-[10px] font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">FAM</span>
                        )}
                      </div>
                      {p.source && (
                        <div className="text-[11px] text-slate-400 mt-0.5">{p.source}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 border-r border-slate-200 text-slate-700 align-middle">
                      {p.phone || <span className="text-slate-400 italic text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 border-r border-slate-200 align-middle">
                      {apptStr ? (
                        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium
                          ${tu?.soon ? 'bg-amber-100 text-amber-800' :
                            tu?.past ? 'bg-slate-100 text-slate-500' :
                            'bg-blue-50 text-blue-700'}`}>
                          <Clock size={11} />
                          <span>{apptStr}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-xs">No appointment</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-middle text-right">
                      <span
                        className="text-[11px] font-bold px-2.5 py-1 rounded-md whitespace-nowrap inline-block"
                        style={{
                          background: (st?.color || '#64748b') + '22',
                          color: st?.color || '#64748b',
                          border: `1px solid ${(st?.color || '#64748b')}44`,
                        }}
                      >
                        {st?.label || p.stage}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan="5" className="px-4 py-8 text-center text-slate-400 italic text-sm">No prospects match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      <ProspectDetail
        open={!!viewing}
        prospect={viewing ? (prospects.find(p => p.id === viewing.id) || viewing) : viewing}
        readOnly={readOnly}
        settings={cfg}
        onClose={() => setViewing(null)}
        onEdit={onEdit}
        onDelete={(id) => { setViewing(null); onDeleteWrap(id); }}
        onConvertToLead={(p) => { setViewing(null); onConvertWrap(p); }}
        onProspectUpdate={(p) => { onUpdate(p); setViewing(p); }}
        playbook={playbook}
        onLogTouch={onLogTouch}
        onOutreachEmailSent={onOutreachEmailSent}
        agentName={''}
        onApplyStageSuggestion={onApplyStageSuggestion}
        onSnooze={onSnoozeProspect}
        onResolveReminder={onResolveReminder}
        onExtractFromTexts={onExtractFromTexts}
      />
      <ProspectForm
        open={!!editing}
        prospect={editing}
        stages={cfg.stages}
        customFields={cfg.customFields}
        onSave={onSave}
        onClose={() => setEditing(null)}
        onDelete={onDeleteWrap}
        onConvertToLead={onConvertWrap}
      />
      <SettingsModal open={showSettings} settings={cfg} onSave={onSaveSettings} onClose={() => setShowSettings(false)} onSyncTextDrip={onSyncTextDrip} />
      <ImportWizard open={!!importFile} file={importFile} settings={cfg} prospects={prospects}
        onImport={onImportDone} onClose={() => setImportFile(null)} />
      <SmartProspectImportWizard
        open={showSmartImport}
        onClose={() => setShowSmartImport(false)}
        stages={cfg.stages}
        existingProspects={prospects}
        onImport={(newProspects, opts) => {
          if (newProspects.length) onBulkAdd(newProspects);
          const dupNote = opts?.duplicatesSkipped ? ` · ${opts.duplicatesSkipped} duplicate${opts.duplicatesSkipped !== 1 ? 's' : ''} skipped` : '';
          alert(`Imported ${newProspects.length} prospect${newProspects.length !== 1 ? 's' : ''}${dupNote}.`);
        }}
      />
      <SourceColorManager
        open={showSourceColors}
        onClose={() => setShowSourceColors(false)}
        prospects={prospects}
        onChanged={() => reloadSourceColors()}
      />
    </div>
  );
}

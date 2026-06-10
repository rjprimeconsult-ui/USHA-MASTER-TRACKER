import { QUARTERS } from './constants';

// Collision-proof unique ID generator.
//
// The old implementation — Math.random().toString(36).slice(2, 10) —
// was only 8 base-36 chars (~2.8e12 keyspace) AND it called Math.random
// in tight import loops, which produces correlated values that can
// truncate to identical 8-char strings. Result: occasional duplicate
// IDs across heavy platform imports (Ringy CSV with many refill rows
// imported repeatedly). Duplicate IDs break React's row reconciliation
// — stale rows linger in the DOM when filters change.
//
// crypto.randomUUID() is RFC 4122 v4, ~36 chars, 122 bits of entropy.
// Available in every modern browser and in Node 19+. The Math.random
// fallback is kept only as a last-resort safety net for ancient runtimes.
export const uid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback — exceedingly unlikely to be reached.
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
};
// Local calendar date (YYYY-MM-DD) in the user's timezone — NOT UTC. Using
// toISOString() (UTC) made evening actions roll over to "tomorrow" for US
// agents (e.g. 9pm ET = next-day UTC), misfiling deals/touches into the wrong
// week/period. ymdLocal keeps dates in the agent's actual day.
export const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => ymdLocal(new Date());
export const daysAgo = (n) => ymdLocal(new Date(Date.now() - n * 86400000));
export const fmt  = (n) => '$' + (n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
export const fmt2 = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

// Live formatter for phone-number inputs — turns whatever the agent
// types or pastes into "(XXX) XXX-XXXX". Strips non-digits, drops a
// leading US country-code 1 on pasted 11-digit numbers, and formats
// progressively so partial entry still reads cleanly.
export const formatPhoneInput = (input) => {
  let digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

// Live formatter for whole-dollar currency inputs (income, etc.) —
// turns "120000" into "$120,000" as the agent types or pastes. Drops
// any non-digit so existing "$"/commas don't compound on re-edit.
export const formatCurrencyInput = (input) => {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 0) return '';
  return '$' + Number(digits).toLocaleString('en-US');
};

// Live-format a typed date of birth as the agent types: 01021962 → 01/02/1962
// (MM/DD/YYYY). Strips non-digits per segment; supports comma-separated DOBs
// for family entries.
export const formatDobInput = (input) => {
  return String(input || '')
    .split(',')
    .map((seg) => {
      const d = seg.replace(/\D/g, '').slice(0, 8);
      if (d.length <= 2) return d;
      if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
      return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
    })
    .join(', ');
};

// Display a stored DOB as MM/DD/YYYY. Tolerant of YYYY-MM-DD (imports),
// MM/DD/YYYY or MM-DD-YYYY (manual), and comma-separated family DOBs.
// Leaves non-date values (e.g. an age like "42") untouched.
export const formatDob = (value) => {
  if (!value) return '';
  return String(value)
    .split(',')
    .map((seg) => {
      const s = seg.trim();
      let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);          // ISO YYYY-MM-DD
      if (m) return `${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}/${m[1]}`;
      m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);         // US MM/DD/YYYY
      if (m) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
      return s;
    })
    .filter(Boolean)
    .join(', ');
};

// Normalize any stored appointment value to the exact "YYYY-MM-DDTHH:mm"
// shape <input type="datetime-local"> requires. Imports/AI sometimes store
// "2026-06-04 20:00" (space) or values with seconds/zone — the picker renders
// those as BLANK, so the agent can neither see nor truly clear them (the old
// value silently survives a save). Returns '' for anything unparseable.
export const toDateTimeLocalInput = (value) => {
  if (!value) return '';
  const s = String(value).trim();
  const m = s.replace(' ', 'T').match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  if (m) return m[1];
  if (!/\d/.test(s)) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000) return '';
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

export const getWeekStart = (d) => {
  if (!d || typeof d !== 'string') return '';
  // Normalize various accepted forms to YYYY-MM-DD before parsing
  let iso = d.length >= 10 ? d.slice(0, 10) : d;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const m = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return '';
    let yy = m[3];
    if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
    iso = `${yy}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  }
  const date = new Date(iso + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getDay();
  const offset = -((day - 5 + 7) % 7);
  date.setDate(date.getDate() + offset);
  return ymdLocal(date);
};

export const getWeekEnd = (friIso) => {
  const d = new Date(friIso + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return ymdLocal(d);
};

export const weekAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return getWeekStart(ymdLocal(d));
};

export const weekLabel = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const weekRangeLabel = (friIso) => {
  const fri = new Date(friIso + 'T00:00:00');
  const thu = new Date(friIso + 'T00:00:00');
  thu.setDate(thu.getDate() + 6);
  const opt = { month: 'short', day: 'numeric' };
  return `Fri ${fri.toLocaleDateString(undefined, opt)} → Thu ${thu.toLocaleDateString(undefined, opt)}, ${thu.getFullYear()}`;
};

export const monthLabel = (ym) => {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase();
};

export const usDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
};

export const monthsActiveTotal = (client) => {
  if (!client.associationStartDate) return 0;
  const start = new Date(client.associationStartDate + 'T00:00:00');
  let end;
  if (client.associationStatus === 'cancelled' && client.associationEndDate)
    end = new Date(client.associationEndDate + 'T00:00:00');
  else if (client.associationStatus === 'paused' && client.associationPauseDate)
    end = new Date(client.associationPauseDate + 'T00:00:00');
  else end = new Date();
  const m = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return Math.max(0, m + 1);
};

export const monthsActiveInQuarter = (client, quarter, year) => {
  if (!client.associationStartDate || quarter.key === 'waiting') return 0;
  const start = new Date(client.associationStartDate + 'T00:00:00');
  const end   = (client.associationStatus === 'cancelled' && client.associationEndDate)
              ? new Date(client.associationEndDate + 'T00:00:00') : null;
  const pause = (client.associationStatus === 'paused' && client.associationPauseDate)
              ? new Date(client.associationPauseDate + 'T00:00:00') : null;
  let count = 0;
  for (const monthIdx of quarter.earningMonths) {
    let monthYear = year;
    if (quarter.key === 'Q1' && monthIdx === 11) monthYear = year - 1;
    const mStart = new Date(monthYear, monthIdx, 1);
    const mEnd   = new Date(monthYear, monthIdx + 1, 1);
    const activeAtStart   = start < mEnd;
    const notEnded        = !end   || end   >= mStart;
    const notPausedBefore = !pause || pause >= mStart;
    if (activeAtStart && notEnded && notPausedBefore) count++;
  }
  return count;
};

export const getCurrentQuarter = (date = new Date()) => {
  const m = date.getMonth();
  return QUARTERS.find(q => q.earningMonths.includes(m))
      || { key: 'waiting', label: 'Between Quarters', earningMonths: [], payoutMonth: null, desc: 'Between Q1 payout & Q2 earning' };
};

export const getNextQuarter = (date = new Date()) => {
  const cur = getCurrentQuarter(date);
  if (cur.key === 'waiting') return QUARTERS[1];
  const i = QUARTERS.findIndex(q => q.key === cur.key);
  return QUARTERS[(i + 1) % 4];
};

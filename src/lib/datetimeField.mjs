/**
 * Pure helpers backing the custom clamping date+time picker.
 *
 * The app stores appointment times as a native `datetime-local` string,
 * "YYYY-MM-DDTHH:mm" (24-hour). The picker shows a 12-hour clock with
 * separate Hour / Minute / AM-PM columns, so we convert between the two
 * here — kept pure + unit-tested because 12 AM = 00:00 and 12 PM = 12:00
 * are easy to get wrong.
 */

// 12-hour clock + meridiem -> 24-hour hour (0..23).
export function to24(hour12, ampm) {
  const h = ((Number(hour12) % 12) + 12) % 12; // 12 -> 0, 1..11 stay
  return ampm === 'PM' ? h + 12 : h;
}

// 24-hour hour (0..23) -> { hour12: 1..12, ampm: 'AM'|'PM' }.
export function to12(hour24) {
  const h = Number(hour24);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return { hour12, ampm };
}

const p2 = (n) => String(n).padStart(2, '0');

// "YYYY-MM-DDTHH:mm" -> { date, hour12, minute, ampm }. All-null when absent
// or unparseable, so the caller can show a placeholder.
export function parseDateTimeLocal(value) {
  const empty = { date: '', hour12: null, minute: null, ampm: null };
  if (!value) return empty;
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return empty;
  const [, date, hh, mm] = m;
  const { hour12, ampm } = to12(Number(hh));
  return { date, hour12, minute: Number(mm), ampm };
}

// { date, hour12, minute, ampm } -> "YYYY-MM-DDTHH:mm". Returns '' when the
// value is incomplete (no date, or no time chosen) — an incomplete datetime
// isn't a real value.
export function composeDateTimeLocal({ date, hour12, minute, ampm }) {
  if (!date || hour12 == null || minute == null || !ampm) return '';
  return `${date}T${p2(to24(hour12, ampm))}:${p2(minute)}`;
}

/**
 * Normalize ANY stored appointment value to the exact "YYYY-MM-DDTHH:mm"
 * shape <input type="datetime-local"> requires. Imports and AI extraction
 * store several shapes — "2026-06-04 20:00" (space), values with seconds or
 * a zone, and bare dates — and the picker renders anything else as BLANK,
 * so the agent can neither see the value nor truly clear it (the old value
 * silently survives a save). Returns '' for anything unparseable.
 *
 * Lives here rather than in utils.js because utils.js imports './constants'
 * extensionlessly and so cannot be loaded by `node --test`. This is date
 * math with a timezone trap in it; it needs to be on the tested lane.
 *
 * THE TRAP (fixed 2026-07-28, shipped bug): a date-only ISO value like
 * "2026-08-14" is parsed by `new Date()` as UTC midnight per spec. Formatting
 * that back out of LOCAL components then lands on the PREVIOUS day for every
 * zone west of UTC — "2026-08-13T20:00" in Eastern. Because ProspectForm
 * normalizes on open, merely opening and saving a prospect silently moved its
 * appointment back a day. Date-only values are a supported shape (the AI
 * import schema documents "ISO 8601 datetime or YYYY-MM-DD"), so this was
 * reachable in normal use. Note the non-ISO date-only shapes ("8/14/2026")
 * never had the bug — those parse as LOCAL midnight — which is why it hid.
 */
export function toDateTimeLocalInput(value) {
  if (!value) return '';
  const s = String(value).trim();

  // Already the right shape (optionally with seconds/zone, or a space
  // separator) — take the leading "YYYY-MM-DDTHH:mm" verbatim.
  const m = s.replace(' ', 'T').match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  if (m) return m[1];

  if (!/\d/.test(s)) return '';

  // Date-only ISO, handled WITHOUT `new Date()` so the UTC parse can never
  // shift the calendar day. Time defaults to midnight — which is already
  // what the other date-only shapes produce, so this is consistent, and it
  // keeps the day the agent actually entered.
  const dateOnly = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    if (Number(y) < 2000) return '';           // same epoch-garbage guard as below
    if (Number(mo) < 1 || Number(mo) > 12) return '';
    if (Number(d) < 1 || Number(d) > 31) return '';
    return `${y}-${p2(mo)}-${p2(d)}T00:00`;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000) return '';
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

// Clamp an index into [0, len-1] — the whole point of the picker: scrolling
// past either end STOPS, it never wraps (59 won't roll to 0, 12 won't roll to 1).
export function clampIndex(i, len) {
  return Math.max(0, Math.min(len - 1, i));
}

// Parse free-typed shorthand into { hour12, minute, ampm } — or null if it
// can't be read as a valid time. Lets agents type "600" -> 6:00, "1230" ->
// 12:30, "9" -> 9:00, "6:07" -> 6:07. A trailing a/p/am/pm sets the meridiem;
// 24-hour entry ("1400" -> 2:00 PM) is understood too. `ampm` is null when the
// input didn't specify one, so the caller keeps the current AM/PM toggle.
export function parseTypedTime(raw) {
  let s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s) return null;

  let ampm = null;
  if (/p\.?m?\.?$/.test(s)) ampm = 'PM';
  else if (/a\.?m?\.?$/.test(s)) ampm = 'AM';
  s = s.replace(/\s*[ap]\.?m?\.?$/, '').trim();

  let hour, minute;
  if (s.includes(':')) {
    const [hp, mp] = s.split(':');
    hour = parseInt(hp, 10);
    minute = parseInt(mp || '0', 10);
  } else {
    const d = s.replace(/\D/g, '');
    if (!d) return null;
    if (d.length <= 2) { hour = parseInt(d, 10); minute = 0; }
    else if (d.length === 3) { hour = parseInt(d.slice(0, 1), 10); minute = parseInt(d.slice(1), 10); }
    else { hour = parseInt(d.slice(0, 2), 10); minute = parseInt(d.slice(2, 4), 10); }
  }
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;

  // 24-hour entry → fold into 12-hour + meridiem.
  if (hour >= 13 && hour <= 23) { ampm = ampm || 'PM'; hour -= 12; }
  else if (hour === 0) { hour = 12; }

  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  return { hour12: hour, minute, ampm };
}

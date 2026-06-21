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

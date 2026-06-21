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

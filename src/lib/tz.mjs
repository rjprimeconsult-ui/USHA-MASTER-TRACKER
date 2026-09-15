// Pure IANA time-zone math for the Routine Builder (spec §5). No imports.
// Every instant is a millisecond epoch number; every "day" is 'YYYY-MM-DD'.

const fmtCache = new Map();
function fmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function wallParts(instant, tz) {
  const out = {};
  for (const { type, value } of fmt(tz).formatToParts(new Date(instant))) out[type] = value;
  // Some engines print hour "24" at midnight even with h23; normalise.
  if (out.hour === '24') out.hour = '00';
  return out;
}

const p2 = (n) => String(n).padStart(2, '0');

// local − UTC in minutes (New York summer = −240).
export function offsetMinutesAt(instant, tz) {
  const p = wallParts(instant, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const whole = Math.floor(instant / 1000) * 1000;
  return Math.round((asUtc - whole) / 60000);
}

export function localDayKey(instant, tz) {
  const p = wallParts(instant, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localMinuteOfDay(instant, tz) {
  const p = wallParts(instant, tz);
  return (+p.hour) * 60 + (+p.minute);
}

function dayToUtcMs(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// 0 = Sunday … 6 = Saturday, from a 'YYYY-MM-DD' key (Date#getDay convention).
export function localWeekday(day) {
  return new Date(dayToUtcMs(day)).getUTCDay();
}

export function addDays(day, n) {
  const d = new Date(dayToUtcMs(day) + n * 86400000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

// dayB − dayA in whole calendar days.
export function daysBetween(dayA, dayB) {
  return Math.round((dayToUtcMs(dayB) - dayToUtcMs(dayA)) / 86400000);
}

// Wall-clock (day + minute-of-day) in `tz` → UTC instant. Two-step algorithm
// from spec §5; a spring-forward gap resolves to the first guess (utc1).
export function zonedTimeToUtc(day, minute, tz) {
  const guess = dayToUtcMs(day) + minute * 60000;
  const off1 = offsetMinutesAt(guess, tz);
  const utc1 = guess - off1 * 60000;
  if (offsetMinutesAt(utc1, tz) === off1) return utc1;
  const off2 = offsetMinutesAt(utc1, tz);
  const utc2 = guess - off2 * 60000;
  if (offsetMinutesAt(utc2, tz) === off2) return utc2;
  return utc1;
}

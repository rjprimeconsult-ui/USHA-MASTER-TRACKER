import { QUARTERS } from './constants';

export const uid = () => Math.random().toString(36).slice(2, 10);
export const today = () => new Date().toISOString().slice(0, 10);
export const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
export const fmt  = (n) => '$' + (n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
export const fmt2 = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

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
  return date.toISOString().slice(0, 10);
};

export const getWeekEnd = (friIso) => {
  const d = new Date(friIso + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
};

export const weekAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return getWeekStart(d.toISOString().slice(0, 10));
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

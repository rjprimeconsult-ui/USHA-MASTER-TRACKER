/**
 * Non-destructive rollup of logged follow-up touches into the dashboard
 * Activity Funnel. NEVER writes storage — pure derivation for display.
 *
 * Guard: manual activities_v1 entries are the source of truth. Follow-up
 * counts only fill days that have NO manual entry, so a day is never
 * double-counted and a typed-in number is never overwritten.
 *
 * Mapping: each logged touch (any channel) = 1 dial; a 'Booked appt'
 * outcome also = 1 appointment. Pitches/closes are NOT inferred.
 */

function dayKey(iso) { return new Date(iso).toISOString().slice(0, 10); }

/** Map of 'YYYY-MM-DD' -> { dials, appointments } derived from touch logs. */
export function followupDailyActivity(prospects) {
  const map = {};
  for (const p of prospects || []) {
    for (const t of (p.touchLog || [])) {
      if (!t.at) continue;
      const k = dayKey(t.at);
      if (!map[k]) map[k] = { dials: 0, appointments: 0 };
      map[k].dials += 1;
      if (t.outcome === 'Booked appt') map[k].appointments += 1;
    }
  }
  return map;
}

/**
 * Funnel totals merging manual activities with follow-up-derived activity.
 * Returns { dials, appts, pitches, closes }. Manual day wins.
 */
export function mergeFunnelTotals(activities, prospects) {
  const manualDays = new Set((activities || []).map(a => a.date));
  const totals = (activities || []).reduce((acc, x) => ({
    dials: acc.dials + (x.dials || 0),
    appts: acc.appts + (x.appointments || 0),
    pitches: acc.pitches + (x.pitches || 0),
    closes: acc.closes + (x.closes || 0),
  }), { dials: 0, appts: 0, pitches: 0, closes: 0 });

  const daily = followupDailyActivity(prospects);
  for (const [day, c] of Object.entries(daily)) {
    if (manualDays.has(day)) continue;
    totals.dials += c.dials;
    totals.appts += c.appointments;
  }
  return totals;
}

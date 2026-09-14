// Timeline geometry (spec §7c). Pure.
export const PX_PER_MIN = 2;
export const SNAP_MIN = 5;
export const DEFAULT_START = 360;
export const DEFAULT_END = 1260;

export const floorHour = (m) => Math.floor(m / 60) * 60;
export const ceilHour = (m) => Math.ceil(m / 60) * 60;

// Derived from the composed items; never stored.
export function bounds(items) {
  let start = DEFAULT_START, end = DEFAULT_END;
  for (const it of items || []) {
    if (Number.isFinite(it.startMin)) start = Math.min(start, floorHour(it.startMin));
    const e = Number.isFinite(it.endMin) ? it.endMin : it.startMin + (it.durationMin || 0);
    if (Number.isFinite(e)) end = Math.max(end, ceilHour(e));
  }
  return { start, end: Math.min(1440, end) };
}

export const topPx = (startMin, boundsStart) => (startMin - boundsStart) * PX_PER_MIN;
export const heightPx = (durationMin) => durationMin * PX_PER_MIN;
export function minuteFromPx(px, boundsStart) {
  const raw = boundsStart + px / PX_PER_MIN;
  return Math.max(boundsStart, Math.min(1440, Math.round(raw / SNAP_MIN) * SNAP_MIN)); // clamp to bounds (§7c), never before the canvas
}

// Routine templates (spec §7e): ONE starter + Blank. An entry never overrides
// paletteId; an unlisted durationMin uses the palette default.
export const LUNCH = { paletteId: 'break', name: 'Lunch', durationMin: 45 };
export const DAY_WRAP_UP = { paletteId: 'review', name: 'Day wrap-up', durationMin: 15 };

export const STARTER_TEMPLATE = {
  id: 'agent-day',
  name: 'Agent day',
  description: 'Morning review, two dial blocks, follow-up queues, breaks, a wrap-up. 8:00–5:30.',
  entries: [
    { paletteId: 'review',   startMin: 480,  durationMin: 30 },
    { paletteId: 'dial',     startMin: 510,  durationMin: 120, note: 'Fresh leads first. Aim for 40 dials.' },
    { paletteId: 'break',    startMin: 630,  durationMin: 15 },
    { paletteId: 'text',     startMin: 645,  durationMin: 30 },
    { paletteId: 'followup', startMin: 675,  durationMin: 75 },
    { ...LUNCH,              startMin: 750 },
    { paletteId: 'dial',     startMin: 795,  durationMin: 120, note: 'Callbacks + aged leads' },
    { paletteId: 'break',    startMin: 915,  durationMin: 15 },
    { paletteId: 'followup', startMin: 930,  durationMin: 60 },
    { paletteId: 'admin',    startMin: 990,  durationMin: 45 },
    { ...DAY_WRAP_UP,        startMin: 1035, note: "Log every touch. Set tomorrow's top 3." },
  ],
};

export const BLANK_TEMPLATE = { id: 'blank', name: 'Blank', description: 'Start from an empty day.', entries: [] };

export const TEMPLATES = [STARTER_TEMPLATE, BLANK_TEMPLATE];

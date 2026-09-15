import { test, expect, vi, beforeEach } from 'vitest';
const calls = vi.hoisted(() => []);            // every terminal chain, in order: { table|rpc, ops }
const responder = vi.hoisted(() => ({ fn: null })); // (call) => { data, error }
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const chain = (target) => {
      const c = { target, ops: [] };
      const add = (op) => (...args) => { c.ops.push([op, ...args]); return c; };
      for (const op of ['select', 'eq', 'in', 'gte', 'lt', 'maybeSingle', 'upsert', 'update', 'delete']) c[op] = add(op);
      c.then = (resolve, reject) => { calls.push(c); try { resolve(responder.fn(c)); } catch (e) { reject(e); } };
      return c;
    };
    return { from: (table) => chain({ table }), rpc: (name, args) => { const c = chain({ rpc: name, args }); return c; } };
  },
}));
vi.mock('@/lib/pushServer', () => ({ pushConfigured: () => true, sendPushAll: vi.fn(async () => ({ sentCount: 1, dead: [], failures: [] })), pruneDeadSubs: vi.fn(async () => ({ ok: true })) }));
import { GET } from './route';
import { sendPushAll } from '@/lib/pushServer';

const ok = (data) => ({ data, error: null });
const NOW = new Date('2026-09-08T13:25:00Z');           // 8:25 Chicago — the starter Dial reminds at 8:25
const settings = (tz) => ({ version: 1, timezone: tz, timezoneMode: 'manual', remindersEnabled: true, defaultMinutesBefore: 5, activeDays: [0, 1, 2, 3, 4, 5, 6], appointmentStages: ['APPOINTMENT_SET'], followupStages: [], followupStagesSeeded: true, lastReplacedBackup: null });
const block = { id: 'blk_dial000', name: 'Dial block', paletteId: 'dial', category: 'dial', startMin: 510, durationMin: 120, remind: { enabled: true, minutesBefore: 5 }, note: '', deletedAt: null, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' };
const profile = (id, tier = 'starter') => ({ id, email: `${id}@x.com`, subscription_status: 'active', subscription_tier: tier, trial_ends_at: null, is_complimentary: false, is_admin: false, past_due_since: null });
const req = (auth = 'Bearer secret') => new Request('http://x/api/routine/tick', { headers: { authorization: auth } });

function world({ users }) {
  // users: { [id]: { settings, profile|null, subs, blocks, day } }
  responder.fn = (c) => {
    const key = c.ops.find(([op, col, v]) => op === 'eq' && col === 'key')?.[2];
    const inIds = c.ops.find(([op, col]) => op === 'in' && (col === 'user_id' || col === 'id'))?.[2] || Object.keys(users);
    if (c.target.rpc === 'routine_appt_rows') return ok([]);
    if (c.target.rpc === 'routine_day_write') return ok([]);
    if (c.target.table === 'profiles') return ok(inIds.map((id) => users[id]?.profile).filter(Boolean));
    if (c.target.table === 'routine_push_log') {
      if (c.ops.some(([op]) => op === 'upsert')) return ok(c.ops.find(([op]) => op === 'upsert')[1].map((r) => ({ fire_key: r.fire_key })));
      if (c.ops.some(([op]) => op === 'update')) return ok([{ fire_key: 'x' }]);
      return ok([]);
    }
    if (c.target.table === 'user_kv') {
      const field = { routine_settings_v1: 'settings', push_subscriptions_v1: 'subs', routine_blocks_v1: 'blocks', routine_day_v1: 'day' }[key];
      return ok(inIds.filter((id) => users[id] && users[id][field] !== undefined).map((id) => ({ user_id: id, value: users[id][field] })));
    }
    return ok([]);
  };
}
const phaseBCallsFor = (id) => calls.filter((c) => c.ops.some(([op, , v]) => op === 'in' && Array.isArray(v) && v.includes(id)) && c.ops.some(([op, , v]) => op === 'eq' && ['routine_blocks_v1', 'routine_day_v1'].includes(v)));

beforeEach(() => { calls.length = 0; vi.stubEnv('CRON_SECRET', 'secret'); vi.stubEnv('SUPABASE_URL', 'http://s'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k'); vi.useFakeTimers(); vi.setSystemTime(NOW); sendPushAll.mockClear(); });

test('fails closed without CRON_SECRET / wrong bearer', async () => {
  vi.stubEnv('CRON_SECRET', '');
  expect((await GET(req())).status).toBe(401);
  vi.stubEnv('CRON_SECRET', 'other');
  expect((await GET(req())).status).toBe(401);
  // An unset CRON_SECRET must never be satisfied by an empty-token header —
  // `Bearer ${expected}` would equal 'Bearer ' if expected were '' unguarded.
  vi.stubEnv('CRON_SECRET', '');
  expect((await GET(req('Bearer '))).status).toBe(401);
});

test('a due block on an entitled Central agent is claimed, sent, and stamped once; a bad_tz agent with subs is never Phase-B queried; a non-entitled id never reaches .in()', async () => {
  world({ users: {
    u1: { settings: settings('America/Chicago'), profile: profile('u1'), subs: [{ endpoint: 'e1' }], blocks: [block], day: [] },
    u2: { settings: settings(null), profile: profile('u2'), subs: [{ endpoint: 'e2' }], blocks: [block], day: [] },
    u3: { settings: settings('America/Chicago'), profile: profile('u3', 'none'), subs: [{ endpoint: 'e3' }], blocks: [block], day: [] },
  } });
  const res = await GET(req());
  const body = await res.json();
  expect(body.skipped.bad_tz).toBe(1);
  expect(body.skipped.not_entitled).toBe(1);
  expect(body.claimed).toBe(1); expect(body.sent).toBe(1); expect(body.failed).toBe(0);
  expect(sendPushAll).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(sendPushAll.mock.calls[0][1])).toContain('Dial block starts in 5 min');
  for (const id of ['u2', 'u3']) expect(phaseBCallsFor(id).length).toBe(0);
  const stamp = calls.find((c) => c.target.table === 'routine_push_log' && c.ops.some(([op]) => op === 'update'));
  expect(stamp.ops.find(([op]) => op === 'update')[1].status).toBe('sent');
});

test('an unparseable settings value counts bad_shape once and does not stop the other agent', async () => {
  world({ users: {
    u1: { settings: '{not json', profile: profile('u1'), subs: [{ endpoint: 'e1' }], blocks: [block], day: [] },
    u4: { settings: settings('America/Chicago'), profile: profile('u4'), subs: [{ endpoint: 'e4' }], blocks: [block], day: [] },
  } });
  const body = await (await GET(req())).json();
  expect(body.skipped.bad_shape).toBe(1); expect(body.skipped.bad_tz).toBe(0); expect(body.sent).toBe(1);
});

test('a compose-eligible agent with zero subscriptions hits sendSkip no_subs and never sends, while another agent still sends', async () => {
  world({ users: {
    u4: { settings: settings('America/Chicago'), profile: profile('u4'), subs: [{ endpoint: 'e4' }], blocks: [block], day: [] },
    u5: { settings: settings('America/Chicago'), profile: profile('u5'), subs: [], blocks: [block], day: [] },
  } });
  const body = await (await GET(req())).json();
  expect(body.skipped.no_subs).toBe(1);
  expect(body.sent).toBe(1);
});

test('a chunk whose blocks read fails is skipped, never composed as empty', async () => {
  world({ users: { u1: { settings: settings('America/Chicago'), profile: profile('u1'), subs: [{ endpoint: 'e1' }], blocks: [block], day: [] } } });
  const base = responder.fn;
  responder.fn = (c) => (c.target.table === 'user_kv' && c.ops.some(([op, , v]) => op === 'eq' && v === 'routine_blocks_v1') ? { data: null, error: { message: 'boom' } } : base(c));
  const body = await (await GET(req())).json();
  expect(body.errors.some((e) => String(e.err || e).includes('phase B read failed'))).toBe(true);
  expect(body.sent).toBe(0); expect(body.frozen).toBe(0);
  expect(body.compose_eligible).toBe(0);
  expect(calls.some((c) => c.target.rpc === 'routine_day_write')).toBe(false);
});

test('claim loses the race: another tick already claimed this fire_key, so nothing sends here', async () => {
  world({ users: { u1: { settings: settings('America/Chicago'), profile: profile('u1'), subs: [{ endpoint: 'e1' }], blocks: [block], day: [] } } });
  const base = responder.fn;
  // The upsert lands (ignoreDuplicates) but .select('fire_key') comes back empty:
  // a concurrent tick claimed this fire_key first.
  responder.fn = (c) => (c.target.table === 'routine_push_log' && c.ops.some(([op]) => op === 'upsert') ? ok([]) : base(c));
  const body = await (await GET(req())).json();
  expect(sendPushAll).not.toHaveBeenCalled();
  expect(body.claimed).toBe(0);
  expect(body.sent).toBe(0);
});

test('CAS retry: a stale failed row (attempts 1) is reclaimed once, sent, and stamped sent with attempts 2', async () => {
  world({ users: { u1: { settings: settings('America/Chicago'), profile: profile('u1'), subs: [{ endpoint: 'e1' }], blocks: [block], day: [] } } });
  const base = responder.fn;
  const existingRow = { user_id: 'u1', fire_key: 'blk_dial000|2026-09-08|505|America/Chicago', block_id: 'blk_dial000', fire_at_utc: '2026-09-08T13:25:00.000Z', status: 'failed', attempts: 1, created_at: '2026-09-08T13:24:00.000Z' };
  responder.fn = (c) => {
    if (c.target.table === 'routine_push_log') {
      if (c.ops.some(([op]) => op === 'update')) return ok([{ fire_key: existingRow.fire_key }]);
      if (c.ops.some(([op]) => op === 'upsert')) return ok([]); // fresh is empty here; upsert should never fire
      return ok([existingRow]); // the log read
    }
    return base(c);
  };
  const body = await (await GET(req())).json();
  // The fire_key already has a log row, so it's never in `fresh` — the CAS
  // retry path is the only way this can be reclaimed.
  expect(body.claimed).toBe(0);
  expect(body.retried).toBe(1);
  const retryCall = calls.find((c) => c.target.table === 'routine_push_log' && c.ops.some(([op, col, v]) => op === 'eq' && col === 'attempts' && v === 1));
  expect(retryCall).toBeTruthy();
  expect(retryCall.ops).toContainEqual(['eq', 'attempts', 1]);
  expect(retryCall.ops).toContainEqual(['in', 'status', ['failed', 'claimed']]);
  expect(sendPushAll).toHaveBeenCalledTimes(1);
  const stampCall = calls.filter((c) => c.target.table === 'routine_push_log' && c.ops.some(([op]) => op === 'update') && c !== retryCall).pop();
  const stampArgs = stampCall.ops.find(([op]) => op === 'update')[1];
  expect(stampArgs.status).toBe('sent');
  expect(stampArgs.attempts).toBe(2);
});

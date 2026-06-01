// Tests for the Payment Alerts logic — the proactive draft-date reminders
// that protect Taken Rate. Run: node --test src/lib/paymentAlerts.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePaymentAlerts, daysUntil, monthlyPremiumOf, buildReminderMessage,
  ALERT_TIER, REMINDER_TONES,
} from './paymentAlerts.mjs';

const TODAY = '2026-06-01';
// effective date N days from TODAY
const plus = (n) => {
  const ms = Date.UTC(2026, 5, 1) + n * 86400000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
const deal = (o = {}) => ({ id: o.id || Math.random().toString(36).slice(2), name: 'Test Client', stage: 'Issued', mainProductPremium: 200, products: [], ...o });

test('daysUntil is date-only and TZ-safe', () => {
  assert.equal(daysUntil('2026-06-06', TODAY), 5);
  assert.equal(daysUntil('2026-06-01', TODAY), 0);
  assert.equal(daysUntil('2026-05-30', TODAY), -2);
  assert.equal(daysUntil('', TODAY), null);
});

test('3–7 days out → headsup tier', () => {
  const alerts = computePaymentAlerts([deal({ effectiveDate: plus(5) })], { today: TODAY });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].tier, ALERT_TIER.HEADSUP);
  assert.equal(alerts[0].daysUntil, 5);
});

test('today / tomorrow / 2 days out → urgent tier', () => {
  for (const n of [0, 1, 2]) {
    const a = computePaymentAlerts([deal({ effectiveDate: plus(n) })], { today: TODAY });
    assert.equal(a.length, 1, `n=${n} should alert`);
    assert.equal(a[0].tier, ALERT_TIER.URGENT, `n=${n} should be urgent`);
  }
});

test('exactly 3 days out → headsup (boundary)', () => {
  const a = computePaymentAlerts([deal({ effectiveDate: plus(3) })], { today: TODAY });
  assert.equal(a[0].tier, ALERT_TIER.HEADSUP);
});

test('beyond 7 days and in the past are excluded', () => {
  const a = computePaymentAlerts([
    deal({ id: 'far', effectiveDate: plus(8) }),
    deal({ id: 'past', effectiveDate: plus(-1) }),
  ], { today: TODAY });
  assert.equal(a.length, 0);
});

test('only submitted/closed stages alert', () => {
  const leads = [
    deal({ id: 'issued', stage: 'Issued', effectiveDate: plus(4) }),
    deal({ id: 'pending', stage: 'Pending', effectiveDate: plus(4) }),
    deal({ id: 'declined', stage: 'Declined', effectiveDate: plus(4) }),
    deal({ id: 'nottaken', stage: 'Not taken', effectiveDate: plus(4) }),
  ];
  const a = computePaymentAlerts(leads, { today: TODAY });
  assert.deepEqual(a.map(x => x.id).sort(), ['issued', 'pending']);
});

test('no effective date → no alert', () => {
  assert.equal(computePaymentAlerts([deal({})], { today: TODAY }).length, 0);
});

test('marked Taken (paymentConfirmedAt) clears the alert', () => {
  const a = computePaymentAlerts([deal({ effectiveDate: plus(4), paymentConfirmedAt: '2026-06-01T10:00:00Z' })], { today: TODAY });
  assert.equal(a.length, 0);
});

test('alerts are sorted soonest-first', () => {
  const a = computePaymentAlerts([
    deal({ id: 'd5', effectiveDate: plus(5) }),
    deal({ id: 'd1', effectiveDate: plus(1) }),
    deal({ id: 'd3', effectiveDate: plus(3) }),
  ], { today: TODAY });
  assert.deepEqual(a.map(x => x.daysUntil), [1, 3, 5]);
});

test('monthlyPremiumOf sums main + add-ons + association', () => {
  const lead = deal({ mainProductPremium: 200, products: [{ id: 'A', premium: 42 }, { id: 'B', premium: 18 }], associationMonthlyPremium: 32.95 });
  assert.equal(monthlyPremiumOf(lead), 292.95);
});

test('sent flag reflects paymentHeadsUpSentAt', () => {
  const a = computePaymentAlerts([deal({ effectiveDate: plus(4), paymentHeadsUpSentAt: '2026-05-31T12:00:00Z' })], { today: TODAY });
  assert.equal(a[0].sent, true);
});

test('all three tones include name, amount, and date', () => {
  const lead = deal({ name: 'Maria Lopez', mainProductPremium: 218, effectiveDate: '2026-06-03' });
  for (const tone of REMINDER_TONES) {
    const { subject, body, sms } = buildReminderMessage(lead, tone);
    assert.match(body, /Maria/, `${tone} body has first name`);
    assert.match(body, /\$218\.00/, `${tone} body has amount`);
    assert.match(body, /Jun 3/, `${tone} body has date`);
    assert.ok(subject.length > 0, `${tone} has subject`);
    assert.ok(!sms.includes('\n'), `${tone} sms is single-line`);
  }
});

// Tests for the support-ticket pure logic: category set, input validation, and
// the PHI-safe email builders. The load-bearing test is that the SUBMIT email to
// Juan NEVER contains the agent's free-text description (which may hold PHI).
//
// Run: node --test src/lib/tickets.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TICKET_CATEGORIES, validateTicketInput, buildSubmitEmail, buildResolutionEmail,
} from './tickets.mjs';

test('categories are the fixed set incl. Custom', () => {
  assert.deepEqual(TICKET_CATEGORIES,
    ['Upload', 'Import', 'Login', 'Data looks wrong', 'Billing', 'Other', 'Custom']);
});

test('validateTicketInput — accepts a good ticket', () => {
  const r = validateTicketInput({ category: 'Upload', description: 'It failed', context: {} });
  assert.equal(r.ok, true);
});

test('validateTicketInput — rejects bad category / empty description / too long', () => {
  assert.equal(validateTicketInput({ category: 'Nope', description: 'x' }).ok, false);
  assert.equal(validateTicketInput({ category: 'Upload', description: '' }).ok, false);
  assert.equal(validateTicketInput({ category: 'Upload', description: 'x'.repeat(4001) }).ok, false);
});

test('validateTicketInput — Custom requires custom_category (<=120)', () => {
  assert.equal(validateTicketInput({ category: 'Custom', description: 'x' }).ok, false);
  assert.equal(validateTicketInput({ category: 'Custom', custom_category: 'y', description: 'x' }).ok, true);
  assert.equal(validateTicketInput({ category: 'Custom', custom_category: 'y'.repeat(121), description: 'x' }).ok, false);
});

test('validateTicketInput — rejects oversize context (>8KB)', () => {
  const big = { blob: 'x'.repeat(9000) };
  assert.equal(validateTicketInput({ category: 'Upload', description: 'x', context: big }).ok, false);
});

test('buildSubmitEmail — NEVER contains the description (PHI containment)', () => {
  const secret = 'PATIENT SECRET NOTE';
  const { subject, html, text } = buildSubmitEmail({
    id: 42, category: 'Upload', name: 'Alexis', email: 'a@x.com',
    description: secret, context: { page: 'books', appVersion: 'abc123' },
  });
  assert.match(subject, /#42/);
  assert.ok(!html.includes(secret) && !text.includes(secret), 'description must not appear');
  assert.match(html, /admin/i); // includes a link to the queue
});

test('buildResolutionEmail — contains ticket # + resolution note', () => {
  const { subject, html } = buildResolutionEmail({ id: 42, resolution: 'Re-ran your import.' });
  assert.match(subject, /#42/);
  assert.match(html, /Re-ran your import\./);
});

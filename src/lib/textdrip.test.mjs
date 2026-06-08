/**
 * textdrip.test.mjs — Unit tests for textdrip.mjs (node:test)
 *
 * Run with:   node --test src/lib/textdrip.test.mjs
 * Or via:     npm test  (which runs node --test src/lib/*.test.mjs)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  phoneKey,
  parseTdDate,
  normalizeContact,
  normalizeMessage,
  normalizeConversation,
  contactHasTag,
  classifyImport,
  mapToProspect,
  mergeConversationIntoProspect,
} from './textdrip.mjs';

// ============================================================
// phoneKey
// ============================================================
test('phoneKey: 11-digit with leading 1 → 10-digit', () => {
  assert.equal(phoneKey('19416851718'), '9416851718');
});

test('phoneKey: +1 prefix stripped via digit-only then leading-1 logic', () => {
  assert.equal(phoneKey('+19416851718'), '9416851718');
});

test('phoneKey: formatted (xxx) xxx-xxxx', () => {
  assert.equal(phoneKey('(941) 685-1718'), '9416851718');
});

test('phoneKey: already 10 digits, no leading 1', () => {
  assert.equal(phoneKey('9416851718'), '9416851718');
});

test('phoneKey: 10-digit number that happens to start with 1 stays untouched', () => {
  // 10 digits starting with 1 → NOT dropped (only 11-digit leading-1 is dropped)
  assert.equal(phoneKey('1415555267'), '1415555267');
});

test('phoneKey: short number (< 10 digits) stays as-is', () => {
  assert.equal(phoneKey('1234'), '1234');
});

test('phoneKey: null/empty returns empty string', () => {
  assert.equal(phoneKey(null), '');
  assert.equal(phoneKey(''), '');
  assert.equal(phoneKey(undefined), '');
});

test('phoneKey: dashes and spaces stripped', () => {
  assert.equal(phoneKey('1-941-685-1718'), '9416851718');
});

// ============================================================
// parseTdDate
// ============================================================
test('parseTdDate: parses "8th Jun, 2026 6:29 PM"', () => {
  const iso = parseTdDate('8th Jun, 2026 6:29 PM');
  assert.ok(iso, 'should return a string');
  const d = new Date(iso);
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 5); // 0-based: June = 5
  assert.equal(d.getUTCDate(), 8);
});

test('parseTdDate: parses "21st Mar, 2026 9:00 AM"', () => {
  const iso = parseTdDate('21st Mar, 2026 9:00 AM');
  assert.ok(iso);
  const d = new Date(iso);
  assert.equal(d.getFullYear() >= 2026, true);
});

test('parseTdDate: parses "2nd Jan, 2026 12:00 PM"', () => {
  const iso = parseTdDate('2nd Jan, 2026 12:00 PM');
  assert.ok(iso);
  const d = new Date(iso);
  assert.equal(d.getFullYear(), 2026);
});

test('parseTdDate: parses "3rd Apr, 2025 11:45 AM"', () => {
  const iso = parseTdDate('3rd Apr, 2025 11:45 AM');
  assert.ok(iso);
  const d = new Date(iso);
  assert.equal(d.getFullYear(), 2025);
});

test('parseTdDate: garbage returns null', () => {
  assert.equal(parseTdDate('not a date at all'), null);
  assert.equal(parseTdDate(''), null);
  assert.equal(parseTdDate(null), null);
  assert.equal(parseTdDate(undefined), null);
  assert.equal(parseTdDate('hello world'), null);
});

test('parseTdDate: returns ISO string (contains T)', () => {
  const iso = parseTdDate('8th Jun, 2026 6:29 PM');
  assert.ok(iso.includes('T'), 'should be ISO format');
});

// ============================================================
// normalizeMessage — direction mapping
// ============================================================
test('normalizeMessage: receiver → out (agent sent to contact)', () => {
  const msg = normalizeMessage({ message: 'Hi', type: 'receiver', date: '8th Jun, 2026 6:29 PM', delivery_status: 'delivered', is_drip: false });
  assert.equal(msg.direction, 'out');
  assert.equal(msg.body, 'Hi');
  assert.equal(msg.deliveryStatus, 'delivered');
  assert.equal(msg.isDrip, false);
  assert.ok(msg.at);
});

test('normalizeMessage: sender → in (contact sent to agent)', () => {
  const msg = normalizeMessage({ message: 'Reply', type: 'sender', date: '8th Jun, 2026 7:00 PM', delivery_status: '', is_drip: false });
  assert.equal(msg.direction, 'in');
});

test('normalizeMessage: unknown type → in (default)', () => {
  const msg = normalizeMessage({ message: 'x', type: 'something_else', date: '8th Jun, 2026 1:00 PM' });
  assert.equal(msg.direction, 'in');
});

test('normalizeMessage: is_drip truthy set correctly', () => {
  const msg = normalizeMessage({ message: 'drip', type: 'receiver', date: '8th Jun, 2026 1:00 PM', is_drip: 1 });
  assert.equal(msg.isDrip, true);
});

// ============================================================
// normalizeConversation — cap to 50 + lastMessageAt
// ============================================================
test('normalizeConversation: caps to 50 most-recent messages', () => {
  const chats = Array.from({ length: 80 }, (_, i) => ({
    message: `msg ${i}`,
    type: 'sender',
    date: `${(i + 1)}th Jun, 2026 1:00 PM`,
    delivery_status: '',
    is_drip: false,
  }));
  const result = normalizeConversation(chats);
  assert.equal(result.messages.length, 50);
});

test('normalizeConversation: fewer than 50 kept as-is', () => {
  const chats = Array.from({ length: 5 }, (_, i) => ({
    message: `m${i}`,
    type: 'sender',
    date: `${i + 1}th Jun, 2026 3:00 PM`,
    delivery_status: '',
    is_drip: false,
  }));
  const result = normalizeConversation(chats);
  assert.equal(result.messages.length, 5);
});

test('normalizeConversation: lastMessageAt is the most-recent message at', () => {
  const chats = [
    { message: 'older', type: 'sender', date: '1st Jun, 2026 8:00 AM', delivery_status: '', is_drip: false },
    { message: 'newer', type: 'receiver', date: '8th Jun, 2026 6:29 PM', delivery_status: '', is_drip: false },
    { message: 'middle', type: 'sender', date: '4th Jun, 2026 3:00 PM', delivery_status: '', is_drip: false },
  ];
  const result = normalizeConversation(chats);
  // Should be the Jun 8 timestamp
  const last = new Date(result.lastMessageAt);
  assert.equal(last.getUTCDate(), 8);
  // Messages should be sorted newest-first
  assert.equal(result.messages[0].at, result.lastMessageAt);
});

test('normalizeConversation: empty array → empty messages, null lastMessageAt', () => {
  const result = normalizeConversation([]);
  assert.deepEqual(result.messages, []);
  assert.equal(result.lastMessageAt, null);
});

test('normalizeConversation: null/undefined → empty', () => {
  const result = normalizeConversation(null);
  assert.deepEqual(result.messages, []);
  assert.equal(result.lastMessageAt, null);
});

// ============================================================
// contactHasTag — case-insensitivity
// ============================================================
test('contactHasTag: exact case match', () => {
  const contact = { tags: ['PRIM', 'VIP'] };
  assert.equal(contactHasTag(contact, 'PRIM'), true);
});

test('contactHasTag: case-insensitive match', () => {
  const contact = { tags: ['APPT SET PRIM', 'VIP'] };
  assert.equal(contactHasTag(contact, 'appt set prim'), true);
  assert.equal(contactHasTag(contact, 'Appt Set Prim'), true);
  assert.equal(contactHasTag(contact, 'APPT SET PRIM'), true);
});

test('contactHasTag: no match returns false', () => {
  const contact = { tags: ['VIP', 'FOLLOW UP'] };
  assert.equal(contactHasTag(contact, 'PRIM'), false);
});

test('contactHasTag: empty tags returns false', () => {
  assert.equal(contactHasTag({ tags: [] }, 'PRIM'), false);
});

test('contactHasTag: null/undefined contact returns false', () => {
  assert.equal(contactHasTag(null, 'PRIM'), false);
  assert.equal(contactHasTag(undefined, 'PRIM'), false);
});

// ============================================================
// classifyImport
// ============================================================
const mkContact = (phone, tdId = '99') => ({
  phoneKey: phoneKey(phone),
  textdripContactId: tdId,
  name: 'Test',
  phone,
  tags: [],
});

test('classifyImport: no prospects → create', () => {
  const result = classifyImport(mkContact('9416851718'), []);
  assert.equal(result.action, 'create');
});

test('classifyImport: no phone match → create', () => {
  const prospects = [{ id: 'p1', phone: '5555555555', source: 'Google Ads' }];
  const result = classifyImport(mkContact('9416851718'), prospects);
  assert.equal(result.action, 'create');
});

test('classifyImport: phone match, source = TextDrip → update', () => {
  const prospects = [{ id: 'p1', phone: '9416851718', source: 'TextDrip', textdripContactId: '99' }];
  const result = classifyImport(mkContact('9416851718', '99'), prospects);
  assert.equal(result.action, 'update');
  assert.equal(result.matchId, 'p1');
});

test('classifyImport: phone match, same textdripContactId → update', () => {
  const prospects = [{ id: 'p2', phone: '9416851718', source: 'Referral', textdripContactId: '99' }];
  const result = classifyImport(mkContact('9416851718', '99'), prospects);
  assert.equal(result.action, 'update');
  assert.equal(result.matchId, 'p2');
});

test('classifyImport: phone match, different source, different tdId → review', () => {
  const prospects = [{ id: 'p3', phone: '9416851718', source: 'Google Ads' }];
  const result = classifyImport(mkContact('9416851718', '77'), prospects);
  assert.equal(result.action, 'review');
  assert.equal(result.matchId, 'p3');
});

test('classifyImport: phone with +1 prefix matches 10-digit stored phone', () => {
  const prospects = [{ id: 'p4', phone: '9416851718', source: 'TextDrip', textdripContactId: '5' }];
  const contact = mkContact('+19416851718', '5');
  const result = classifyImport(contact, prospects);
  assert.equal(result.action, 'update');
});

test('classifyImport: 11-digit TextDrip phone matches 10-digit PRIM phone', () => {
  const prospects = [{ id: 'p5', phone: '9416851718', source: 'TextDrip', textdripContactId: '123' }];
  const contact = mkContact('19416851718', '123');
  const result = classifyImport(contact, prospects);
  assert.equal(result.action, 'update');
});

// ============================================================
// mapToProspect — shape validation
// ============================================================
test('mapToProspect: source is TextDrip', () => {
  const contact = mkContact('19416851718', '42');
  contact.name = 'Jane Doe';
  const conv = normalizeConversation([]);
  const p = mapToProspect(contact, 'WEBBY_SET', conv, '2026-06-08T00:00:00.000Z');
  assert.equal(p.source, 'TextDrip');
});

test('mapToProspect: stage is set to defaultStage', () => {
  const contact = mkContact('19416851718', '42');
  const conv = normalizeConversation([]);
  const p = mapToProspect(contact, 'APPOINTMENT_SET', conv, '2026-06-08T00:00:00.000Z');
  assert.equal(p.stage, 'APPOINTMENT_SET');
});

test('mapToProspect: textdripContactId is propagated', () => {
  const contact = mkContact('19416851718', '777');
  const conv = normalizeConversation([]);
  const p = mapToProspect(contact, 'PENDING_DECISION', conv, '2026-06-08T00:00:00.000Z');
  assert.equal(p.textdripContactId, '777');
});

test('mapToProspect: textdripChat.syncedAt matches passed-in now', () => {
  const contact = mkContact('19416851718', '1');
  const conv = normalizeConversation([]);
  const now = '2026-06-08T12:00:00.000Z';
  const p = mapToProspect(contact, 'PENDING_DECISION', conv, now);
  assert.equal(p.textdripChat.syncedAt, now);
});

test('mapToProspect: has required newProspect-shape fields', () => {
  const contact = mkContact('19416851718', '1');
  const conv = normalizeConversation([]);
  const p = mapToProspect(contact, 'PENDING_DECISION', conv, '2026-06-08T00:00:00.000Z');
  // Core newProspect fields must be present
  assert.ok('id' in p);
  assert.ok('name' in p);
  assert.ok('phone' in p);
  assert.ok('email' in p);
  assert.ok('stage' in p);
  assert.ok('createdAt' in p);
  assert.ok('touchLog' in p);
  assert.ok('cadence' in p);
  assert.ok('textdripChat' in p);
  assert.deepEqual(p.touchLog, []);
  assert.deepEqual(p.cadence, { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null });
});

test('mapToProspect: crm is TextDrip', () => {
  const contact = mkContact('9416851718', '5');
  const conv = normalizeConversation([]);
  const p = mapToProspect(contact, 'PENDING_DECISION', conv, '2026-06-08T00:00:00.000Z');
  assert.equal(p.crm, 'TextDrip');
});

// ============================================================
// mergeConversationIntoProspect
// ============================================================
test('mergeConversationIntoProspect: updates textdripChat without clobbering other fields', () => {
  const existing = {
    id: 'p-existing',
    name: 'John',
    phone: '9416851718',
    source: 'TextDrip',
    stage: 'WEBBY_SET',
    email: 'john@test.com',
    textdripContactId: '10',
    textdripChat: { messages: [], lastMessageAt: null, syncedAt: '2026-01-01T00:00:00.000Z' },
  };
  const newConv = normalizeConversation([
    { message: 'hello', type: 'sender', date: '8th Jun, 2026 6:29 PM', delivery_status: '', is_drip: false },
  ]);
  const updated = mergeConversationIntoProspect(existing, newConv, '2026-06-08T12:00:00.000Z');

  // Original fields preserved
  assert.equal(updated.id, 'p-existing');
  assert.equal(updated.name, 'John');
  assert.equal(updated.stage, 'WEBBY_SET');
  assert.equal(updated.email, 'john@test.com');

  // Chat updated
  assert.equal(updated.textdripChat.messages.length, 1);
  assert.equal(updated.textdripChat.syncedAt, '2026-06-08T12:00:00.000Z');
});

test('mergeConversationIntoProspect: stamps textdripContactId when merging a contact into a different-source prospect (stops re-review loop)', () => {
  const existing = { id: 'p2', name: 'Jane', phone: '9416851718', source: 'Google Ads' }; // no textdripContactId
  const contact = {
    textdripContactId: '777',
    conversation: normalizeConversation([
      { message: 'hi', type: 'sender', date: '8th Jun, 2026 6:29 PM', delivery_status: '', is_drip: false },
    ]),
  };
  const updated = mergeConversationIntoProspect(existing, contact, '2026-06-08T12:00:00.000Z');
  assert.equal(updated.textdripContactId, '777'); // stamped → future syncs classify as 'update', not 'review'
  assert.equal(updated.source, 'Google Ads');     // original source preserved
  assert.equal(updated.textdripChat.messages.length, 1);
});

test('mergeConversationIntoProspect: does not mutate original prospect', () => {
  const orig = { id: 'x', textdripChat: { messages: [], lastMessageAt: null, syncedAt: '2026-01-01' } };
  const conv = normalizeConversation([]);
  const updated = mergeConversationIntoProspect(orig, conv, '2026-06-08T00:00:00.000Z');
  // They should be different object references
  assert.notEqual(updated, orig);
  assert.notEqual(updated.textdripChat, orig.textdripChat);
});

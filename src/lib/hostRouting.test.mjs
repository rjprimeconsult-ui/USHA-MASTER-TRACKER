import { test } from 'node:test';
import assert from 'node:assert';
import { classifyHost, routeDecision } from './hostRouting.mjs';

test('classifyHost: app subdomain → app', () => {
  assert.equal(classifyHost('app.primtracker.com'), 'app');
});
test('classifyHost: www + apex → marketing ONLY when the split is enabled', () => {
  assert.equal(classifyHost('www.primtracker.com', { marketingSplitEnabled: true }), 'marketing');
  assert.equal(classifyHost('primtracker.com', { marketingSplitEnabled: true }), 'marketing');
});
test('classifyHost: www + apex → app when the split is OFF (default — inert on merge)', () => {
  assert.equal(classifyHost('www.primtracker.com'), 'app');
  assert.equal(classifyHost('primtracker.com'), 'app');
});
test('classifyHost: host header with port is normalized', () => {
  assert.equal(classifyHost('www.primtracker.com:443', { marketingSplitEnabled: true }), 'marketing');
});
test('classifyHost: localhost → app (dev unchanged)', () => {
  assert.equal(classifyHost('localhost:3000'), 'app');
  assert.equal(classifyHost('127.0.0.1:55525'), 'app');
});
test('classifyHost: preview → app by default, marketing only with override', () => {
  assert.equal(classifyHost('prim-git-x.vercel.app'), 'app');
  assert.equal(classifyHost('prim-git-x.vercel.app', { previewAsMarketing: true }), 'marketing');
});
test('classifyHost: empty/unknown → app (safe default)', () => {
  assert.equal(classifyHost(''), 'app');
});
test('routeDecision marketing: / rewrites to /landing', () => {
  assert.deepEqual(routeDecision('marketing', '/'), { type: 'rewrite', to: '/landing' });
});
test('routeDecision marketing: /landing 308 → /', () => {
  assert.deepEqual(routeDecision('marketing', '/landing'), { type: 'redirect', to: '/', status: 308 });
});
test('routeDecision marketing: /pricing 308 → app host', () => {
  assert.deepEqual(routeDecision('marketing', '/pricing'), { type: 'redirect', to: 'APP:/pricing', status: 308 });
});
test('routeDecision marketing: /admin 308 → app host, path preserved', () => {
  assert.deepEqual(routeDecision('marketing', '/admin'), { type: 'redirect', to: 'APP:/admin', status: 308 });
});
test('routeDecision marketing: legal pages pass through', () => {
  assert.deepEqual(routeDecision('marketing', '/privacy'), { type: 'next' });
  assert.deepEqual(routeDecision('marketing', '/terms'), { type: 'next' });
});
test('routeDecision app: /landing 308 → marketing root', () => {
  assert.deepEqual(routeDecision('app', '/landing'), { type: 'redirect', to: 'MKT:/', status: 308 });
});
test('routeDecision app: app root passes through', () => {
  assert.deepEqual(routeDecision('app', '/'), { type: 'next' });
});

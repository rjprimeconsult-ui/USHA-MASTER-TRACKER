import { test } from 'node:test';
import assert from 'node:assert';
import { isPublicRoute } from './routeAccess.mjs';

test('legal + marketing prefixes are always public', () => {
  for (const p of ['/landing', '/pricing', '/privacy', '/terms']) assert.equal(isPublicRoute(p), true);
});
test('root is gated on the app host', () => {
  assert.equal(isPublicRoute('/', { isMarketingHost: false }), false);
});
test('root is public on the marketing host', () => {
  assert.equal(isPublicRoute('/', { isMarketingHost: true }), true);
});
test('a gated app path stays gated on both hosts', () => {
  assert.equal(isPublicRoute('/admin', { isMarketingHost: true }), false);
  assert.equal(isPublicRoute('/admin', { isMarketingHost: false }), false);
});
test('nested public route inherits', () => {
  assert.equal(isPublicRoute('/landing/x'), true);
});

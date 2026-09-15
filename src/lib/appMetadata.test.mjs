import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { buildAppMetadata, BASE_METADATA } from './appMetadata.mjs';

test('marketing role gets no manifest / apple metadata; app role does (spec §8)', () => {
  const m = buildAppMetadata('marketing');
  assert.equal(m.title, BASE_METADATA.title); assert.equal('manifest' in m, false); assert.equal('appleWebApp' in m, false);
  const a = buildAppMetadata('app');
  assert.equal(a.manifest, '/manifest.webmanifest');
  assert.deepEqual(a.appleWebApp, { capable: true, statusBarStyle: 'default', title: 'PRIM' });
  assert.deepEqual(a.icons, { apple: '/apple-touch-icon.png' });
  assert.deepEqual(buildAppMetadata(undefined).manifest, '/manifest.webmanifest');
});

test('layout.js exports generateMetadata (not a static metadata object) and reads x-prim-role', () => {
  const src = readFileSync(new URL('../app/layout.js', import.meta.url), 'utf8');
  assert.ok(src.includes('export async function generateMetadata'));
  assert.ok(!src.includes('export const metadata'));
  assert.ok(src.includes("get('x-prim-role')"));
  assert.ok(src.includes('buildAppMetadata'));
});

test('manifest + icons exist and the manifest is well-formed', () => {
  const root = new URL('../../public/', import.meta.url);
  const man = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(man.name, 'PRIM'); assert.equal(man.short_name, 'PRIM'); assert.equal(man.display, 'standalone'); assert.equal(man.start_url, '/');
  assert.equal(man.theme_color, '#6366f1'); assert.equal(man.background_color, '#ffffff');
  assert.deepEqual(man.icons.map(i => i.src), ['/icons/prim-192.png', '/icons/prim-512.png']);
  for (const f of ['icons/prim-192.png', 'icons/prim-512.png', 'apple-touch-icon.png']) assert.ok(existsSync(new URL(f, root)), f);
});

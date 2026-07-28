/**
 * Component-test lane (Vitest + React Testing Library, jsdom).
 *
 * SEPARATE from `npm test` on purpose: `npm test` = `node --test
 * src/lib/*.test.mjs` and stays the fast, dependency-free lane for pure
 * logic. This lane renders React components and asserts BEHAVIOR (what an
 * agent would see and click) — run it with `npm run test:ui`.
 *
 * The include glob picks up ONLY component suites (`.test/.spec` with a
 * `.jsx`/`.tsx` extension), so the `.test.mjs` logic suites are never
 * double-run here.
 *
 * OneDrive note: this repo lives inside OneDrive, and Vite writes a
 * temporary `vitest.config.mjs.timestamp-*.mjs` on every run. If a run
 * dies with `errno -4094` (UNKNOWN, read), that's the OneDrive filter
 * driver racing the write — just re-run; it clears immediately.
 *
 * Scope discipline (why there is no coverage target): component tests are
 * limited to behavior-critical components — surfaces where a wrong render
 * costs money or credibility (drafts, taken-rate math, exports, commission
 * displays). Assert behavior, never styling; a suite that breaks on a
 * padding tweak gets ignored, and an ignored suite is worse than none.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // globals:true lets Testing Library register its automatic afterEach
    // cleanup; tests still import { test, expect, vi } explicitly.
    globals: true,
    // {test,spec} + {jsx,tsx} so a conventionally-named future suite can't
    // be silently skipped; .mjs stays excluded (that's the node lane).
    include: ['src/**/*.{test,spec}.{jsx,tsx}'],
  },
  resolve: {
    alias: { '@': path.resolve(root, 'src') },
  },
});

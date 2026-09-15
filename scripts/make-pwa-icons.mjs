// One-off: rasterise the PRIM mark into the PWA icon set. sharp is a transitive
// dependency of next (0.34.5) — not added to package.json on purpose.
//   node scripts/make-pwa-icons.mjs
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';

const src = existsSync('public/prim-mark.png') ? 'public/prim-mark.png' : 'public/icon.svg';
mkdirSync('public/icons', { recursive: true });
const make = (size, out) => sharp(src).resize(size, size, { fit: 'contain', background: '#0f172a' }).png().toFile(out);
await make(192, 'public/icons/prim-192.png');
await make(512, 'public/icons/prim-512.png');
await make(180, 'public/apple-touch-icon.png');
console.log('icons written from', src);

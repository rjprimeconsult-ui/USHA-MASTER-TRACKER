// Replicate the browser pdfjs-dist extraction in Node to see what the parser sees.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);

// Use the legacy Node-friendly build
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

const file = process.argv[2];
const buffer = readFileSync(file);
const task = pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableWorker: true });
const pdf = await task.promise;

let pageText = '';
const page1 = await pdf.getPage(1);
const content = await page1.getTextContent();
let prevY = null;
for (const item of content.items) {
  const y = item.transform ? item.transform[5] : null;
  if (prevY !== null && y !== null && Math.abs(y - prevY) > 1) pageText += '\n';
  else if (pageText && !pageText.endsWith(' ') && !pageText.endsWith('\n')) pageText += ' ';
  pageText += item.str;
  prevY = y;
}

console.log('--- Page 1 extracted text ---');
console.log(pageText);
console.log('\n--- length:', pageText.length);

// Find policy IDs
const ids = [...pageText.matchAll(/\b(\d{2}[A-Z]\d{6}[A-Z]?)\b/g)];
console.log('\nPolicy IDs found:', ids.length);
ids.slice(0, 5).forEach(m => {
  console.log(`  at index ${m.index}: ${m[0]}`);
  console.log(`    context: "...${pageText.slice(Math.max(0, m.index - 80), m.index + 20).replace(/\n/g, '\\n')}..."`);
});

await pdf.destroy();

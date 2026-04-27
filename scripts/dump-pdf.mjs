import { readFileSync } from 'node:fs';
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

const file = process.argv[2];
const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(readFileSync(file)), disableWorker: true }).promise;

for (let i = 1; i <= pdf.numPages; i++) {
  const p = await pdf.getPage(i);
  const c = await p.getTextContent();
  let text = '', prevY = null;
  for (const item of c.items) {
    const y = item.transform ? item.transform[5] : null;
    if (prevY !== null && y !== null && Math.abs(y - prevY) > 1) text += '\n';
    else if (text && !text.endsWith(' ') && !text.endsWith('\n')) text += ' ';
    text += item.str;
    prevY = y;
  }
  console.log(`\n\n=== PAGE ${i} ===\n${text}`);
}
await pdf.destroy();

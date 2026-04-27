import { readFileSync } from 'node:fs';
import pdfParse from 'pdf-parse';

const file = process.argv[2];
const data = await pdfParse(readFileSync(file));
console.log('Pages:', data.numpages);
console.log('--- TEXT ---');
console.log(data.text);

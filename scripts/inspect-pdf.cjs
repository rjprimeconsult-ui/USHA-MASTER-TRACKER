const { PDFParse } = require('pdf-parse');
const fs = require('fs');
(async () => {
  const buf = fs.readFileSync(process.argv[2]);
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  console.log('Pages:', result.pages?.length || result.numpages || '?');
  console.log('--- TEXT ---');
  console.log(result.text);
})();

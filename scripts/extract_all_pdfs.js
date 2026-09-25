const fs = require('fs');
const pdf = require('pdf-parse');
const path = require('path');

const refDir = path.join(__dirname, '..', 'reference-documents');

const files = [
  { name: 'Annexture RFI-113.pdf', label: 'ANNEXTURE RFI-113' },
  { name: 'CLA-4700025071-1064.pdf', label: 'CLA DOCUMENT' },
  { name: 'M509 stop Watch.pdf', label: 'M509 STOP WATCH CERT' },
  { name: 'P30339B-RFI-INST-008-ARC-INT-KSB-0113.pdf', label: 'RFI-113' },
];

async function main() {
  for (const f of files) {
    const filePath = path.join(refDir, f.name);
    try {
      const buf = fs.readFileSync(filePath);
      const d = await pdf(buf);
      console.log(`=== ${f.label} ===`);
      console.log('Pages:', d.numpages);
      console.log(d.text);
      console.log('\n--- END OF ' + f.label + ' ---\n');
    } catch (e) {
      console.log(`=== ${f.label} ===`);
      console.log('ERROR:', e.message);
    }
  }
}

main();

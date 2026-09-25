import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import fs from 'fs';

const rfiPath = process.argv[2] || '../reference-documents/P30339B-RFI-INST-008-ARC-INT-KSB-0109 Rev.0.pdf';
const dataBuffer = fs.readFileSync(rfiPath);

const data = await pdf(dataBuffer);
console.log('=== RFI PDF ANALYSIS ===');
console.log('Pages:', data.numpages);
console.log('Info:', JSON.stringify(data.info, null, 2));
console.log('\n=== FULL TEXT ===\n');
console.log(data.text);

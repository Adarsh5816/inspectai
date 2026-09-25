import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import fs from 'fs';

const itpPath = process.argv[2] || '../reference-documents/P30339B-30-99-52-4607 - INSPECTION AND TEST PLAN FOR CONTROL VALVES.pdf';
const dataBuffer = fs.readFileSync(itpPath);

const data = await pdf(dataBuffer);
console.log('=== ITP PDF ANALYSIS ===');
console.log('Pages:', data.numpages);
console.log('Info:', JSON.stringify(data.info, null, 2));
console.log('\n=== FULL TEXT ===\n');
console.log(data.text);

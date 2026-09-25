const fs = require('fs');
const pdf = require('pdf-parse');

const rfiPath = process.argv[2] || '../reference-documents/P30339B-RFI-INST-008-ARC-INT-KSB-0109 Rev.0.pdf';
const dataBuffer = fs.readFileSync(rfiPath);

pdf(dataBuffer).then(function(data) {
  console.log('=== RFI PDF ANALYSIS ===');
  console.log('Pages:', data.numpages);
  console.log('Info:', JSON.stringify(data.info, null, 2));
  console.log('\n=== FULL TEXT ===\n');
  console.log(data.text);
}).catch(function(err) {
  console.error('Error:', err);
});

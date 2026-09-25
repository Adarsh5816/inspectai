const fs = require('fs');
const pdf = require('pdf-parse');

const itpPath = process.argv[2] || '../reference-documents/P30339B-30-99-52-4607 - INSPECTION AND TEST PLAN FOR CONTROL VALVES.pdf';
const dataBuffer = fs.readFileSync(itpPath);

pdf(dataBuffer).then(function(data) {
  console.log('=== ITP PDF ANALYSIS ===');
  console.log('Pages:', data.numpages);
  console.log('Info:', JSON.stringify(data.info, null, 2));
  console.log('\n=== FULL TEXT ===\n');
  console.log(data.text);
}).catch(function(err) {
  console.error('Error:', err);
});

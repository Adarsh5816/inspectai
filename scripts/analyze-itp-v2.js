const path = require('path');
const fs = require('fs');
const { PDFParse } = require('pdf-parse');

const itpPath = process.argv[2] || path.resolve(__dirname, '../reference-documents/P30339B-30-99-52-4607 - INSPECTION AND TEST PLAN FOR CONTROL VALVES.pdf');
const absolutePath = path.resolve(itpPath);
const outputPath = path.resolve(__dirname, 'itp-extracted-text.txt');

async function main() {
  const p = new PDFParse({ url: absolutePath });
  let output = '';
  
  try {
    const info = await p.getInfo();
    output += '=== ITP PDF ANALYSIS ===\n';
    output += 'Pages: ' + info.total + '\n';
    output += 'Info: ' + JSON.stringify(info.info, null, 2) + '\n';
    output += 'Metadata: ' + JSON.stringify(info.metadata, null, 2) + '\n';
  } catch(e) {
    output += 'Info extraction error: ' + e.message + '\n';
  }
  
  output += '\n=== FULL TEXT ===\n';
  try {
    const text = await p.getText();
    if (text.pages) {
      for (const page of text.pages) {
        const pageNum = page.pageNumber || page.num || 'unknown';
        output += '\n--- PAGE ' + pageNum + ' ---\n\n';
        output += page.text + '\n';
      }
    } else {
      output += JSON.stringify(text, null, 2) + '\n';
    }
  } catch(e) {
    output += 'Text extraction error: ' + e.message + '\n';
  }
  
  await p.destroy();
  
  fs.writeFileSync(outputPath, output, 'utf8');
  console.log('Output written to: ' + outputPath);
  console.log('Total length: ' + output.length + ' chars');
}

main().catch(err => console.error('Error:', err));

const path = require('path');
const fs = require('fs');
const { PDFParse } = require('pdf-parse');

async function extractPDF(pdfPath, outputPath) {
  const absolutePath = path.resolve(pdfPath);
  const p = new PDFParse({ url: absolutePath });
  let output = '';

  try {
    const info = await p.getInfo();
    output += `Pages: ${info.total}\n`;
  } catch(e) {
    output += `Info error: ${e.message}\n`;
  }

  try {
    const text = await p.getText();
    if (text.pages) {
      for (const page of text.pages) {
        const pageNum = page.pageNumber || page.num || '?';
        output += `\n--- PAGE ${pageNum} ---\n\n`;
        output += page.text + '\n';
      }
    } else {
      output += JSON.stringify(text, null, 2) + '\n';
    }
  } catch(e) {
    output += `Text error: ${e.message}\n`;
  }

  await p.destroy();

  fs.writeFileSync(outputPath, output, 'utf8');
  console.log(`Extracted: ${pdfPath} -> ${outputPath} (${output.length} chars)`);
  return output;
}

async function main() {
  const docs = [
    ['../reference-documents/P30339B-RFI-INST-008-ARC-INT-KSB-0109 Rev.0.pdf', '../reference-documents/rfi-109-text.txt'],
    ['../reference-documents/P30339B-RFI-INST-008-ARC-INT-KSB-0113.pdf', '../reference-documents/rfi-113-text.txt'],
    ['../reference-documents/Annexture RFI-113.pdf', '../reference-documents/annexture-rfi-113-text.txt'],
    ['../reference-documents/CLA-4700025071-1064.pdf', '../reference-documents/cla-text.txt'],
    ['../reference-documents/M509 stop Watch.pdf', '../reference-documents/m509-cert-text.txt'],
    ['../reference-documents/Calibration-Certificates-15July.pdf', '../reference-documents/calibration-certs-text.txt'],
  ];

  for (const [src, dst] of docs) {
    try {
      await extractPDF(src, dst);
    } catch(e) {
      console.error(`FAILED: ${src}: ${e.message}`);
    }
  }
  
  console.log('\nAll done.');
}

main().catch(console.error);

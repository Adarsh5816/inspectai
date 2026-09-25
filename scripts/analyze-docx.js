const fs = require('fs');
const mammoth = require('mammoth');

const docxPath = process.argv[2] || '../reference-documents/KSB MIL CONTROLS LIMITED 15 Sept 26-Inspection Report Format.docx';

async function analyze() {
  // 1. Extract raw text
  const textResult = await mammoth.extractRawText({ path: docxPath });
  console.log('=== RAW TEXT ===\n');
  console.log(textResult.value);

  // 2. Extract HTML for structure understanding
  const htmlResult = await mammoth.convertToHtml({ path: docxPath });
  console.log('\n=== HTML STRUCTURE (first 10000 chars) ===\n');
  console.log(htmlResult.value.substring(0, 10000));

  console.log('\n=== MAMMOTH MESSAGES ===');
  htmlResult.messages.forEach(m => console.log(m.type + ': ' + m.message));
}

analyze().catch(console.error);

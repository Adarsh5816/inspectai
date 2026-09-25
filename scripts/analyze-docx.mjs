import fs from 'fs';
import mammoth from 'mammoth';
import JSZip from 'jszip';

const docxPath = process.argv[2] || '../reference-documents/KSB MIL CONTROLS LIMITED 15 Sept 26-Inspection Report Format.docx';

// 1. Extract raw HTML to see structure
const result = await mammoth.convertToHtml({ path: docxPath });
console.log('=== DOCX HTML STRUCTURE (first 5000 chars) ===');
console.log(result.value.substring(0, 5000));
console.log('\n=== MAMMOTH MESSAGES ===');
result.messages.forEach(m => console.log(m.type + ': ' + m.message));

// 2. Extract raw text
const textResult = await mammoth.extractRawText({ path: docxPath });
console.log('\n=== RAW TEXT ===\n');
console.log(textResult.value);

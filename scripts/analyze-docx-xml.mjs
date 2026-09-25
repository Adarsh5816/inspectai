import fs from 'fs';
import JSZip from 'jszip';

const docxPath = process.argv[2] || '../reference-documents/KSB MIL CONTROLS LIMITED 15 Sept 26-Inspection Report Format.docx';
const data = fs.readFileSync(docxPath);
const zip = await JSZip.loadAsync(data);

// List all files in the DOCX
console.log('=== DOCX ARCHIVE CONTENTS ===');
const files = Object.keys(zip.files);
for (const f of files) {
  console.log(`  ${f} (${zip.files[f].dir ? 'DIR' : zip.files[f]._data?.uncompressedSize || '?'} bytes)`);
}

// Extract document.xml for structure analysis
const documentXml = await zip.file('word/document.xml')?.async('string');
if (documentXml) {
  // Count paragraphs, tables, runs etc.
  const tableCount = (documentXml.match(/<w:tbl>/g) || []).length;
  const rowCount = (documentXml.match(/<w:tr /g) || []).length + (documentXml.match(/<w:tr>/g) || []).length;
  const paraCount = (documentXml.match(/<w:p /g) || []).length + (documentXml.match(/<w:p>/g) || []).length;
  const imageCount = (documentXml.match(/<wp:inline/g) || []).length + (documentXml.match(/<wp:anchor/g) || []).length;
  const sectionCount = (documentXml.match(/<w:sectPr/g) || []).length;
  const pageBreakCount = (documentXml.match(/<w:br w:type="page"/g) || []).length;

  console.log('\n=== DOCUMENT STRUCTURE SUMMARY ===');
  console.log('Tables:', tableCount);
  console.log('Rows:', rowCount);
  console.log('Paragraphs:', paraCount);
  console.log('Images:', imageCount);
  console.log('Sections:', sectionCount);
  console.log('Page Breaks:', pageBreakCount);

  // Extract text content for mapping
  const textContent = documentXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log('\n=== EXTRACTED TEXT (first 8000 chars) ===');
  console.log(textContent.substring(0, 8000));

  // Save full document.xml for analysis
  fs.writeFileSync('../reference-documents/document-xml-dump.xml', documentXml);
  console.log('\n[Full document.xml saved to reference-documents/document-xml-dump.xml]');
}

// Check headers/footers
const headerFiles = files.filter(f => f.match(/header/i));
const footerFiles = files.filter(f => f.match(/footer/i));
console.log('\n=== HEADERS ===');
for (const h of headerFiles) {
  const content = await zip.file(h)?.async('string');
  if (content) {
    const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`${h}: ${text.substring(0, 500)}`);
  }
}

console.log('\n=== FOOTERS ===');
for (const f of footerFiles) {
  const content = await zip.file(f)?.async('string');
  if (content) {
    const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`${f}: ${text.substring(0, 500)}`);
  }
}

// Check styles
const stylesXml = await zip.file('word/styles.xml')?.async('string');
if (stylesXml) {
  const styleNames = [...stylesXml.matchAll(/w:name w:val="([^"]+)"/g)].map(m => m[1]);
  console.log('\n=== STYLES ===');
  styleNames.forEach(s => console.log(`  ${s}`));
}

// Check relationships for images
const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
if (relsXml) {
  const imgRels = [...relsXml.matchAll(/Target="([^"]*\.(png|jpg|jpeg|gif|bmp|emf|wmf))"/gi)];
  console.log('\n=== IMAGE REFERENCES ===');
  imgRels.forEach(m => console.log(`  ${m[1]}`));
}

import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

async function test() {
  const zip = await JSZip.loadAsync(fs.readFileSync('d:/Inspection report/templates/master-template.docx'));
  const xml = await zip.file('word/document.xml')!.async('string');

  function showField(label: string, length: number = 400) {
    const idx = xml.indexOf(label);
    console.log(`\n========================================\nFIELD: ${label} (index ${idx})\n========================================`);
    if (idx !== -1) {
      console.log(xml.substring(idx, idx + length));
    }
  }

  showField('Requisition No:', 500);
  showField('Date of Order:', 500);
  showField('Date(s) of Visit(s):', 500);
  showField('Date of Previous Visit:', 500);
  showField('Date of Next Scheduled Visit:', 500);
  showField('Supplier Job No:', 500);
  showField('Project Name:', 600);
  showField('Materials/Items Inspected:', 500);
  showField('Technical Specialist:', 1200);
}
test();

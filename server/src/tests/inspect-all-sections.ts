import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

async function testAllSections() {
  const zip = await JSZip.loadAsync(fs.readFileSync('d:/Inspection report/templates/master-template.docx'));
  const xml = await zip.file('word/document.xml')!.async('string');

  console.log('=== 1. Table 5: Attendees ===');
  const attIdx = xml.indexOf('COMPANY REPRESENTED');
  if (attIdx !== -1) {
    const headerTrEnd = xml.indexOf('</w:tr>', attIdx) + 7;
    const firstTblClose = xml.indexOf('</w:tbl>', headerTrEnd);
    const nextH = xml.indexOf('ShowSection_MaterialInspected', headerTrEnd);
    console.log('Attendees headerTrEnd:', headerTrEnd, 'firstTblClose:', firstTblClose, 'nextH:', nextH);
    console.log('Text around firstTblClose:', xml.substring(firstTblClose - 40, firstTblClose + 40));
  }

  console.log('\n=== 2. Table 6: Generic Materials ===');
  const gmIdx = xml.indexOf('TAG / EQPT NO.');
  if (gmIdx !== -1) {
    const headerTrEnd = xml.indexOf('</w:tr>', gmIdx) + 7;
    const firstTblClose = xml.indexOf('</w:tbl>', headerTrEnd);
    console.log('GM headerTrEnd:', headerTrEnd, 'firstTblClose:', firstTblClose);
    console.log('Text around firstTblClose:', xml.substring(firstTblClose - 40, firstTblClose + 40));
  }

  console.log('\n=== 3. Table 7: Materials Inspected ===');
  const matIdx = xml.indexOf('PRODUCT / MATERIAL');
  if (matIdx !== -1) {
    const headerTrEnd = xml.indexOf('</w:tr>', matIdx) + 7;
    const firstTblClose = xml.indexOf('</w:tbl>', headerTrEnd);
    console.log('Mat headerTrEnd:', headerTrEnd, 'firstTblClose:', firstTblClose);
    console.log('Text around firstTblClose:', xml.substring(firstTblClose - 40, firstTblClose + 40));
  }

  console.log('\n=== 4. Table 8: Documents Used ===');
  const docIdx = xml.indexOf('DOCUMENTS USED');
  if (docIdx !== -1) {
    const nextH = xml.indexOf('SCOPE OF INSPECTION', docIdx);
    const tblStart = xml.indexOf('<w:tbl', docIdx);
    const tblEnd = xml.lastIndexOf('</w:tbl>', nextH) + 8;
    console.log('Docs tblStart:', tblStart, 'tblEnd:', tblEnd, 'nextH:', nextH);
    console.log('Text before tblStart:', xml.substring(tblStart - 60, tblStart));
    console.log('Text around tblEnd:', xml.substring(tblEnd - 40, tblEnd + 40));
  }

  console.log('\n=== 5. Table 9: Scope of Inspection ===');
  const itpIdx = xml.indexOf('ITP LINE NO.');
  if (itpIdx !== -1) {
    const headerTrEnd = xml.indexOf('</w:tr>', itpIdx) + 7;
    const firstTblClose = xml.indexOf('</w:tbl>', headerTrEnd);
    const nextH = xml.indexOf('EQUIPMENT AND INSTRUMENTATION', itpIdx);
    const lastTblClose = xml.lastIndexOf('</w:tbl>', nextH);
    console.log('Scope headerTrEnd:', headerTrEnd);
    console.log('firstTblClose (INNER):', firstTblClose);
    console.log('lastTblClose (OUTER):', lastTblClose);
    console.log('Text around firstTblClose:', xml.substring(firstTblClose - 40, firstTblClose + 60));
  }

  console.log('\n=== 6. Table 10: Equipment & Instrumentation ===');
  const eqIdx = xml.indexOf('EQUIPMENT AND INSTRUMENTATION');
  if (eqIdx !== -1) {
    const nextH = xml.indexOf('NON-CONFORMANCES', eqIdx) !== -1 ? xml.indexOf('NON-CONFORMANCES', eqIdx) : xml.indexOf('OBSERVATION', eqIdx);
    const tblStart = xml.indexOf('<w:tbl', eqIdx);
    const tblEnd = xml.lastIndexOf('</w:tbl>', nextH) + 8;
    console.log('Eq tblStart:', tblStart, 'tblEnd:', tblEnd);
    console.log('Text before tblStart:', xml.substring(tblStart - 60, tblStart));
    console.log('Text around tblEnd:', xml.substring(tblEnd - 40, tblEnd + 40));
  }

  console.log('\n=== 7. Photos Section ===');
  const photoIdx = xml.indexOf('Inspection Photos.');
  if (photoIdx !== -1) {
    const tblStart = xml.indexOf('<w:tbl', photoIdx);
    const sectPrIdx = xml.indexOf('<w:sectPr', tblStart);
    const tblEnd = sectPrIdx !== -1 ? xml.lastIndexOf('</w:tbl>', sectPrIdx) + 8 : -1;
    console.log('Photo tblStart:', tblStart, 'tblEnd:', tblEnd, 'sectPrIdx:', sectPrIdx);
    console.log('Text around tblEnd:', xml.substring(tblEnd - 40, tblEnd + 40));
  }
}

testAllSections().catch(console.error);

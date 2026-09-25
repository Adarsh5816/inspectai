import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

async function testCleanReport() {
  const tplPath = path.resolve(__dirname, '../../../templates/master-template.docx');
  const buf = fs.readFileSync(tplPath);
  const zip = await JSZip.loadAsync(buf);
  let docXml = await zip.file('word/document.xml')!.async('string');

  console.log('Original docXml length:', docXml.length);

  // 1. Replace Scope of Inspection table (Table 9)
  const itpHeaderIdx = docXml.indexOf('ITP LINE NO.');
  if (itpHeaderIdx !== -1) {
    const headerTrEnd = docXml.indexOf('</w:tr>', itpHeaderIdx) + 7;
    const nextHeading = docXml.indexOf('EQUIPMENT AND INSTRUMENTATION', headerTrEnd);
    const tableEnd = docXml.lastIndexOf('</w:tbl>', nextHeading);
    console.log('Scope table:', { headerTrEnd, nextHeading, tableEnd, oldLen: tableEnd - headerTrEnd });

    // Only 1 activity done
    const singleRow = `<w:tr w:rsidR="00737F9A">
  <w:trPr><w:cantSplit/><w:trHeight w:val="333"/></w:trPr>
  <w:tc>
    <w:tcPr><w:tcW w:w="1006" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>7.1</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc>
    <w:tcPr><w:tcW w:w="2835" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>Body mount Leakage test</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc>
    <w:tcPr><w:tcW w:w="3119" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>14-01-FCV-1601-01A, 14-01-FCV-1601-01B</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc>
    <w:tcPr><w:tcW w:w="2670" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>Acceptable - Tested at 59 kg/cm2, water medium, no leakage</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc>
    <w:tcPr><w:tcW w:w="1147" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>CLAUSE 7.1</w:t></w:r>
    </w:p>
  </w:tc>
</w:tr>`;

    docXml = docXml.substring(0, headerTrEnd) + singleRow + docXml.substring(tableEnd);
    console.log('Scope table replaced successfully!');
  }

  // 2. Clear old photo table
  const photoHeaderIdx = docXml.indexOf('Inspection Photos.');
  if (photoHeaderIdx !== -1) {
    const tblStart = docXml.indexOf('<w:tbl', photoHeaderIdx);
    const sectPrIdx = docXml.indexOf('<w:sectPr', tblStart);
    const tblEnd = docXml.lastIndexOf('</w:tbl>', sectPrIdx) + 8;
    console.log('Photo table:', { tblStart, sectPrIdx, tblEnd, oldLen: tblEnd - tblStart });

    // Empty photo replacement
    const emptyPhotoMsg = `<w:p w14:paraId="11111111" w14:textId="77777777"><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="666666"/></w:rPr><w:t>No photographs attached for this inspection report.</w:t></w:r></w:p>`;

    docXml = docXml.substring(0, tblStart) + emptyPhotoMsg + docXml.substring(tblEnd);
    console.log('Old photos cleared successfully!');
  }

  // 3. Clear old equipment table
  const eqIdx = docXml.indexOf('EQUIPMENT AND INSTRUMENTATION');
  if (eqIdx !== -1) {
    const nextH = docXml.indexOf('NON-CONFORMANCES', eqIdx) !== -1 ? docXml.indexOf('NON-CONFORMANCES', eqIdx) : docXml.indexOf('OBSERVATION', eqIdx);
    const tblStart = docXml.indexOf('<w:tbl', eqIdx);
    const tblEnd = docXml.lastIndexOf('</w:tbl>', nextH) + 8;
    console.log('Equipment table:', { tblStart, tblEnd, oldLen: tblEnd - tblStart });

    const cleanEquipmentTbl = `<w:p w14:paraId="22222222" w14:textId="77777777"><w:pPr><w:jc w:val="left"/><w:spacing w:before="120" w:after="120"/></w:pPr><w:r><w:t>Standard vendor calibrated test gauges &amp; instrumentation verified prior to testing.</w:t></w:r></w:p>`;
    docXml = docXml.substring(0, tblStart) + cleanEquipmentTbl + docXml.substring(tblEnd);
    console.log('Equipment table cleaned successfully!');
  }

  zip.file('word/document.xml', docXml);

  const outBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const outPath = path.resolve(__dirname, '../../../storage/test-clean-output.docx');
  fs.writeFileSync(outPath, outBuf);
  console.log('✅ Generated clean test docx at:', outPath, 'Size:', outBuf.length);
}

testCleanReport().catch(console.error);

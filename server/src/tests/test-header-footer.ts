import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

function updateHeaderXml(xml: string, values: { reportNumber: string; reportDate: string; customerName: string; jobNo: string }): string {
  let result = xml;

  function setCellAfter(labelRegex: RegExp, newValue: string) {
    const match = labelRegex.exec(result);
    if (!match) return;
    const labelPos = match.index;
    const labelTcEnd = result.indexOf('</w:tc>', labelPos);
    if (labelTcEnd === -1) return;
    const nextTcStart = result.indexOf('<w:tc', labelTcEnd);
    if (nextTcStart === -1) return;
    const nextTcEnd = result.indexOf('</w:tc>', nextTcStart);
    if (nextTcEnd === -1) return;

    const tcContent = result.substring(nextTcStart, nextTcEnd);
    const tcPrEnd = tcContent.indexOf('</w:tcPr>');
    const tcPr = tcPrEnd !== -1 ? tcContent.substring(0, tcPrEnd + 9) : '<w:tc><w:tcPr/>';

    const newTc = `${tcPr}<w:p><w:pPr><w:spacing w:before="40" w:after="40"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${newValue}</w:t></w:r></w:p>`;

    result = result.substring(0, nextTcStart) + newTc + result.substring(nextTcEnd);
  }

  setCellAfter(/Report\s*No\s*:/i, values.reportNumber);
  setCellAfter(/Date\s*of\s*Report\s*:/i, values.reportDate);
  setCellAfter(/Customer\s*:/i, values.customerName);
  setCellAfter(/(EVO\s*)?Job\s*No\s*:/i, values.jobNo);

  return result;
}

function updateFooterXml(xml: string, footerDate: string): string {
  let result = xml;

  // Find the cell that contains mm/dd or Date
  // In footer1.xml: <w:tc> ... <w:t>mm/dd/</w:t> ... <w:t>yyyy</w:t> </w:p> <w:p> ... [DATE RUNS] ... </w:p> </w:tc>
  // In footer2.xml: <w:tc> ... <w:t>Date</w:t> </w:p> <w:p> ... <w:t>DRAFT</w:t> ... </w:p> </w:tc>

  const tcRegex = /<w:tc[\s>][\s\S]*?<\/w:tc>/g;
  result = result.replace(tcRegex, (tcXml) => {
    const text = tcXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    if (text.includes('mm/dd') || (text.includes('Date') && !text.includes('Inspection'))) {
      // Find the second paragraph in this cell, which holds the date value
      const pStarts: number[] = [];
      let pIdx = 0;
      while ((pIdx = tcXml.indexOf('<w:p', pIdx)) !== -1) {
        pStarts.push(pIdx);
        pIdx += 4;
      }

      if (pStarts.length >= 2) {
        // Keep everything up to the second <w:p>
        const firstPart = tcXml.substring(0, pStarts[1]);
        const tcEnd = tcXml.indexOf('</w:tc>');
        const newSecondP = `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="8640"/></w:tabs><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:bCs/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:bCs/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t>${footerDate}</w:t></w:r></w:p>`;
        return firstPart + newSecondP + tcXml.substring(tcEnd);
      }
    }
    return tcXml;
  });

  return result;
}

async function test() {
  const tpls = ['KSB-Sept-15-Format.docx', 'KSB-July-15-Format.docx', 'master-template.docx'];
  for (const tpl of tpls) {
    console.log('=== TESTING:', tpl);
    const zip = await JSZip.loadAsync(fs.readFileSync(path.resolve(`../templates/${tpl}`)));
    const h1 = await zip.file('word/header1.xml')?.async('string');
    const h2 = await zip.file('word/header2.xml')?.async('string');
    const f1 = await zip.file('word/footer1.xml')?.async('string');
    const f2 = await zip.file('word/footer2.xml')?.async('string');

    if (h1) {
      const upH1 = updateHeaderXml(h1, { reportNumber: 'IR-NEW-999', reportDate: '25 Sept 2026', customerName: 'ADNOC Onshore', jobNo: 'CD13E085' });
      console.log('  H1 updated text:', upH1.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    }
    if (h2) {
      const upH2 = updateHeaderXml(h2, { reportNumber: 'IR-NEW-999', reportDate: '25 Sept 2026', customerName: 'ADNOC Onshore', jobNo: 'CD13E085' });
      console.log('  H2 updated text:', upH2.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    }
    if (f1) {
      const upF1 = updateFooterXml(f1, '25/09/2026');
      console.log('  F1 updated text:', upF1.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    }
    if (f2) {
      const upF2 = updateFooterXml(f2, '25/09/2026');
      console.log('  F2 updated text:', upF2.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    }
  }
}

test().catch(console.error);

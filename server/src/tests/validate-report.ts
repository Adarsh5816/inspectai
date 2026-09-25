import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';

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

  const tcRegex = /<w:tc[\s>][\s\S]*?<\/w:tc>/g;
  result = result.replace(tcRegex, (tcXml) => {
    const text = tcXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    if (text.includes('mm/dd') || (text.includes('Date') && !text.includes('Inspection'))) {
      const paragraphs = tcXml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g);
      if (paragraphs && paragraphs.length >= 2) {
        const tcPrMatch = tcXml.match(/<w:tcPr[\s\S]*?<\/w:tcPr>/);
        const tcPr = tcPrMatch ? tcPrMatch[0] : '';
        const newSecondP = `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="8640"/></w:tabs><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:bCs/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:bCs/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t>${footerDate}</w:t></w:r></w:p>`;
        return `<w:tc>${tcPr}${paragraphs[0]}${newSecondP}</w:tc>`;
      }
    }
    return tcXml;
  });

  return result;
}

async function test() {
  const tpls = ['KSB-Sept-15-Format.docx', 'KSB-July-15-Format.docx', 'master-template.docx'];
  for (const tpl of tpls) {
    console.log('Testing template:', tpl);
    const zip = await JSZip.loadAsync(fs.readFileSync(path.resolve(`../templates/${tpl}`)));
    for (const f of ['word/header1.xml', 'word/header2.xml']) {
      const file = zip.file(f);
      if (!file) continue;
      const xml = await file.async('string');
      const updated = updateHeaderXml(xml, { reportNumber: 'IR-001', reportDate: '25 Sept 2026', customerName: 'ADNOC Onshore', jobNo: 'CD13E085' });
      const val = XMLValidator.validate(updated);
      console.log(`  ${f} validation result:`, val === true ? 'VALID XML ✅' : val.err);
    }
    for (const f of ['word/footer1.xml', 'word/footer2.xml']) {
      const file = zip.file(f);
      if (!file) continue;
      const xml = await file.async('string');
      const updated = updateFooterXml(xml, '25/09/2026');
      const val = XMLValidator.validate(updated);
      console.log(`  ${f} validation result:`, val === true ? 'VALID XML ✅' : val.err);
    }
  }
}

test().catch(console.error);

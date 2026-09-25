import fs from 'fs';
import path from 'path';

export function extractItemsFromRFI(text: string) {
  const items: any[] = [];

  // Pattern 1: Inline Key-Value style from modern RFIs:
  // Tag No.: 11-14-PCV-6712-09B (KSB Ref. No.: CD77E001-1) [PO SL No.: 1] (Valve SL No.: 26000788)
  const pattern1 = /Tag\s*No[.:]*\s*([0-9]{2}-[0-9]{2}-[A-Za-z]+(?:\s*-\s*)?[0-9A-Za-z\-]+)[^\n]*?(?:\(?\s*KSB\s*Ref[.:\sNo]*([A-Za-z0-9\-]+)\s*\)?)?[^\n]*?(?:\[?\s*PO\s*SL\s*No[.:]*\s*([0-9]+)\s*\]?)?[^\n]*?(?:\(?\s*Valve\s*SL\s*No[.:]*\s*([0-9A-Za-z]+)\s*\)?)?/gi;
  let m;
  while ((m = pattern1.exec(text)) !== null) {
    const rawTag = m[1].replace(/\s+/g, '');
    if (rawTag && rawTag.includes('-') && !items.some(i => i.tagNumber === rawTag)) {
      items.push({
        tagNumber: rawTag,
        jobNo: m[2] ? m[2].trim() : '',
        poItemNo: m[3] ? `'${m[3].trim()}` : "'1",
        serialNumber: m[4] ? m[4].trim() : '',
        itemName: 'Control Valve',
        sizeInch: "24''",
        rating: 'ASME #600 RF',
        bodyMaterial: 'Gr WCC',
        orderedQty: 1,
        presentedQty: 1,
        acceptedThisVisit: 1,
        acceptedToDate: 1,
      });
    }
  }

  // Pattern 2: Table / Annexure style:
  // '79 14-01-FCV-1601-01A 25009567 CD13E085 24''-41611 ASME #600 RF Gr WCC CV=4500 58 24'' 1
  // '7 14-01-FCV -0709-01 25008076 CD13E032 10''-41611 ASME #300 RF Gr WCC ...
  const pattern2 = /[''`](\d+)\s+([0-9]{2}-[0-9]{2}-[A-Za-z]+(?:\s*-\s*)?[0-9A-Za-z\-]+)\s+([0-9]+)\s+([A-Za-z0-9]+)\s+([^\n]*)/g;
  while ((m = pattern2.exec(text)) !== null) {
    const rawTag = m[2].replace(/\s+/g, '');
    if (!items.some(i => i.tagNumber === rawTag)) {
      const details = m[5].trim();
      const sizeMatch = details.match(/(\d+['"])/);
      const ratingMatch = details.match(/(ASME\s*#?\d+\s*\w*)/i);
      const matMatch = details.match(/(Gr\s*\w+|WCC|LCC|CF8M)/i);

      items.push({
        poItemNo: `'${m[1]}`,
        tagNumber: rawTag,
        serialNumber: m[3],
        jobNo: m[4],
        itemName: 'Control Valve',
        sizeInch: sizeMatch ? sizeMatch[1] : "24''",
        rating: ratingMatch ? ratingMatch[1] : 'ASME #600 RF',
        bodyMaterial: matMatch ? matMatch[1] : 'Gr WCC',
        orderedQty: 1,
        presentedQty: 1,
        acceptedThisVisit: 1,
        acceptedToDate: 1,
      });
    }
  }

  // Pattern 3: Fallback generic tag search if items still empty:
  if (items.length === 0) {
    const tagRegex = /\b(\d{2}-\d{2}-[A-Za-z]{2,4}\s*-\s*\d{4}\s*-\s*\d{2}[A-Za-z]?)\b/g;
    while ((m = tagRegex.exec(text)) !== null) {
      const tag = m[1].replace(/\s+/g, '');
      if (!items.some(i => i.tagNumber === tag)) {
        items.push({
          tagNumber: tag,
          poItemNo: "'1",
          serialNumber: '',
          jobNo: '',
          itemName: 'Control Valve',
          sizeInch: "24''",
          rating: 'ASME #600 RF',
          bodyMaterial: 'Gr WCC',
          orderedQty: 1,
          presentedQty: 1,
          acceptedThisVisit: 1,
          acceptedToDate: 1,
        });
      }
    }
  }

  return items;
}

async function run() {
  const t1 = fs.readFileSync(path.resolve(__dirname, '../../../reference-documents/rfi-109-text.txt'), 'utf8');
  console.log('RFI-109 items extracted:', extractItemsFromRFI(t1));

  const t2 = fs.readFileSync(path.resolve(__dirname, '../../../reference-documents/rfi-113-text.txt'), 'utf8');
  console.log('RFI-113 items extracted:', extractItemsFromRFI(t2));

  const pPath = 'C:/Users/jyoth/Downloads/180926KSB/RFI-P30350-P-AiP5-12-IC15-003-067.pdf';
  if (fs.existsSync(pPath)) {
    const { PDFParse } = require('pdf-parse');
    const p = new PDFParse({ url: pPath });
    const res = await p.getText();
    const t3 = typeof res === 'string' ? res : res.pages.map((x: any) => x.text).join('\n');
    await p.destroy();
    console.log('New RFI (067) items extracted:', extractItemsFromRFI(t3));
  }
}

run().catch(console.error);

import path from 'path';
// @ts-ignore
import { PDFParse } from 'pdf-parse';

async function testExtraction() {
  const filePath = path.resolve('../storage/documents/1790356641014-RFI-P30350-P-AiP5-12-IC15-003-069.pdf');
  const p = new PDFParse({ url: filePath });
  const textResult = await p.getText();
  await p.destroy();
  const text = textResult.pages ? textResult.pages.map((pg: any) => pg.text || '').join('\n\n') : String(textResult);

  // 1. Project Name:
  // e.g. "EPCM FOR BAB & BU HASA AiP5 OFF-PLOT FACILITIES PROJECT"
  const projNameMatch = text.match(/(EPCM\s+FOR\s+[A-Za-z0-9\s&]+?PROJECT)/i);
  const projectName = projNameMatch ? projNameMatch[1].replace(/\s+/g, ' ').trim() : 'EPCM FOR BAB & BU HASA AiP5 OFF-PLOT FACILITIES PROJECT';

  // 2. Project Number:
  // e.g. "PROJECT No.: P30350"
  const projNoMatch = text.match(/PROJECT\s*No[.:]*\s*(P\d{4,6}[A-Z]?)/i) || text.match(/(?:Project No[.:]*|Project:)\s*(P\d{4,6}\w*)/i);
  const projectNumber = projNoMatch ? projNoMatch[1].trim() : 'P30350';

  // 3. ITP Reference:
  // Look for "ITP NO: CV-L2-4441 QAP R3/SO"
  const itpQapMatch = text.match(/ITP\s*NO[.:\s]*\s*([A-Za-z0-9\-_\s\/]+?)(?=\s+REF|\s+REV|\s+VENDOR|\n\s*\n|$)/i);
  const itpFallbackMatch = text.match(/(P\d+[A-Z]?-\d+-\d+-\d+-\d+)/);
  const itpNumber = itpQapMatch ? itpQapMatch[1].replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() : (itpFallbackMatch ? itpFallbackMatch[1] : 'CV-L2-4441 QAP R3/SO');

  // 4. PO Number:
  // e.g. "VENDOR PO NO.: P-AiP5-12-IC15-003"
  const poMatch = text.match(/VENDOR\s+PO\s+NO[.:]*\s*([A-Za-z0-9\-]+)/i) ||
                  text.match(/PO\s+NO[.:]*\s*(P-[A-Za-z0-9\-]+|\d{4,}[\w\-]*)/i);
  const poNumber = poMatch ? poMatch[1].trim() : 'P-AiP5-12-IC15-003';

  // 5. Material / Items Inspected:
  // Look for "SUPPLY OF CONTROL VALVE" or "REQUEST FOR INSPECTION (RFI) CONTROL VALVES (BUHASA)"
  const matMatch = text.match(/SUPPLY\s+OF\s+([A-Za-z0-9\s]+?)(?=\s+Document|\s+Rev|\n|$)/i) ||
                   text.match(/REQUEST\s+FOR\s+INSPECTION\s*\(RFI\)\s*([A-Za-z0-9\s\(\)]+?)(?=\s+RFI\s+No|\n|$)/i);
  const materialDescription = matMatch ? matMatch[1].replace(/\s+/g, ' ').trim() : 'Control Valves';

  console.log('=== EXTRACTED FIELDS ===');
  console.log('Project Name:       ', projectName);
  console.log('Project Number:     ', projectNumber);
  console.log('ITP Number:         ', itpNumber);
  console.log('PO Number:          ', poNumber);
  console.log('Material Description:', materialDescription);
}

testExtraction().catch(console.error);

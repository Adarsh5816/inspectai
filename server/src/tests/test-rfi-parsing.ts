import path from 'path';
import { DocumentService } from '../services/documentService';

async function testAll() {
  const documentService = new DocumentService();
  const files = [
    'd:/Inspection report/reference-documents/RFI-P30350-P-AiP5-12-IC15-003-067.pdf',
    'd:/Inspection report/reference-documents/P30339B-RFI-INST-008-ARC-INT-KSB-0109 Rev.0.pdf',
    'd:/Inspection report/reference-documents/Annexture RFI-113.pdf'
  ];

  for (const f of files) {
    console.log(`\n================================`);
    console.log(`Testing: ${path.basename(f)}`);
    try {
      const data = await documentService.extractDataFromPDF(f, 'RFI');
      console.log('Project No:', data.projectNumber);
      console.log('RFI No:', data.rfiNumber);
      console.log('Activities found:', data.activities?.length || 0);
      if (data.activities?.length) {
        data.activities.forEach((a: any) => console.log(`  Clause ${a.clauseNumber}: ${a.activityName}`));
      }
      console.log('Items found:', data.items?.length || 0);
      if (data.items?.length) {
        data.items.forEach((i: any) => console.log(`  Item: PO=${i.poItemNo}, Tag=${i.tagNumber}, Serial=${i.serialNumber}, Job=${i.jobNo}`));
      }
    } catch (e: any) {
      console.error('Error:', e.message);
    }
  }
}

testAll();

import prisma from '../db/prisma';
import { ReportService } from '../services/reportService';

async function main() {
  const reportService = new ReportService();

  // Find most recent inspection
  const insp = await prisma.inspection.findFirst({
    orderBy: { createdAt: 'desc' }
  });

  if (!insp) {
    console.error('No inspection found');
    return;
  }

  console.log(`Testing report generation for inspection: ${insp.id} (${insp.reportNumber}) with template: KSB-Sept-15-Format.docx`);

  try {
    const docxPath = await reportService.generateReport(insp.id, 'KSB-Sept-15-Format.docx');
    console.log('SUCCESS! Report generated at:', docxPath);
  } catch (err: any) {
    console.error('ERROR generating report:', err.message);
    console.error(err.stack);
  }
}

main().catch(console.error);

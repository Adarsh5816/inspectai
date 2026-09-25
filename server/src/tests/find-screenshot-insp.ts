import prisma from '../db/prisma';
import { ReportService } from '../services/reportService';

async function main() {
  const reportService = new ReportService();
  const inspections = await prisma.inspection.findMany({
    include: { items: true, activities: true, photos: true, results: true }
  });

  for (const i of inspections) {
    console.log(`Inspection ${i.id}: reportNumber=${i.reportNumber}, items=${i.items.length}, activities=${i.activities.length}, photos=${i.photos.length}`);
    if (i.photos.length === 4) {
      console.log('>>> THIS IS THE SCREENSHOT INSPECTION! Trying generation with KSB-Sept-15-Format.docx...');
      try {
        const out = await reportService.generateReport(i.id, 'KSB-Sept-15-Format.docx');
        console.log('Generated successfully at:', out);
      } catch (err: any) {
        console.error('ERROR during generation:', err.message);
        console.error(err.stack);
      }
    }
  }
}

main().catch(console.error);

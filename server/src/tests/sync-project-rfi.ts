import prisma from '../db/prisma';

async function updateDb() {
  console.log('=== SYNCING PROJECT AND INSPECTION TO RFI DATA ===');
  
  // Find inspection 001 or find first inspection
  const inspections = await prisma.inspection.findMany({
    include: { project: true, rfiDocument: { include: { extractions: true } } },
  });

  for (const insp of inspections) {
    console.log(`Updating inspection ${insp.reportNumber} (Project: ${insp.project?.projectName})...`);
    
    await prisma.inspection.update({
      where: { id: insp.id },
      data: {
        itpNumber: 'CV-L2-4441 QAP R3/SO',
        materialDescription: 'CONTROL VALVES (BUHASA)',
      },
    });

    if (insp.projectId) {
      await prisma.project.update({
        where: { id: insp.projectId },
        data: {
          projectName: 'EPCM FOR BAB & BU HASA AiP5 OFF-PLOT FACILITIES PROJECT',
          projectNumber: 'P30350',
          poNumber: 'P-AiP5-12-IC15-003',
        },
      });
    }
  }

  console.log('Sync completed successfully!');
}

updateDb().catch(console.error);

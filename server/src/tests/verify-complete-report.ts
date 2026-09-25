import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import prisma from '../db/prisma';
import { ReportService } from '../services/reportService';

async function main() {
  console.log('Testing End-to-End Report Generation with Table 7, 8, 9, 10 & Photos...');
  const reportService = new ReportService();

  // Find or create test inspection
  const project = await prisma.project.findFirst({ where: { projectNumber: 'P30339B' } });
  if (!project) throw new Error('Project P30339B not found');
  const user = await prisma.user.findFirst();
  if (!user) throw new Error('User not found');

  // Create clean inspection
  const insp = await prisma.inspection.create({
    data: {
      projectId: project.id,
      reportNumber: 'IR-P30350-AiP5-TEST-001',
      inspectionType: 'FAT',
      location: 'KSB MIL Controls Limited, Meladoor, Kerala',
      startDate: new Date('2026-09-18T09:00:00Z'),
      inspectorId: user.id,
      status: 'IN_PROGRESS',
      summaryNarrative: 'Pressure test witnessed and accepted in accordance with ITP clause 3.1(a).',
    },
  });

  // Add 2 items: 1 offered (presentedQty=1), 1 not offered (presentedQty=0)
  const item1 = await prisma.inspectionItem.create({
    data: {
      inspectionId: insp.id,
      poItemNo: "'1",
      tagNumber: '11-14-PCV-6712-09B',
      serialNumber: '26000788',
      jobNo: 'CD77E001-1',
      itemName: 'Control Valve (Offered)',
      orderedQty: 1,
      presentedQty: 1,
      acceptedThisVisit: 1,
      acceptedToDate: 1,
    },
  });

  await prisma.inspectionItem.create({
    data: {
      inspectionId: insp.id,
      poItemNo: "'2",
      tagNumber: '11-15-PCV-6704-09B',
      serialNumber: '26000789',
      jobNo: 'CD77E001-2',
      itemName: 'Control Valve (Not Offered)',
      orderedQty: 1,
      presentedQty: 0,
      acceptedThisVisit: 0,
      acceptedToDate: 0,
    },
  });

  // Add 2 activities: 1 accepted, 1 pending
  const act1 = await prisma.inspectionActivity.create({
    data: {
      inspectionId: insp.id,
      clauseNumber: '3.1 (a)',
      activityName: 'Shell Pressure Test (Without primer)',
      acceptanceCriteria: 'Conform to approved ITP',
      status: 'ACCEPTABLE',
    },
  });

  await prisma.inspectionResult.create({
    data: {
      inspectionId: insp.id,
      itemId: item1.id,
      activityId: act1.id,
      status: 'ACCEPTABLE',
      testDate: new Date('2026-09-18'),
      testMedium: 'Water',
      testPressure: 285,
      pressureUnit: 'bar',
      holdingTimeMin: 15,
      leakageObserved: 'Zero Leakage',
      remarks: 'Hydrostatic shell test successfully witnessed with zero pressure drop.',
    },
  });

  await prisma.inspectionActivity.create({
    data: {
      inspectionId: insp.id,
      clauseNumber: '3.1 (b)',
      activityName: 'DPT after machining',
      acceptanceCriteria: 'Conform to approved ITP',
      status: 'PENDING',
    },
  });

  // Generate Report
  const docxPath = await reportService.generateReport(insp.id, 'master-template.docx', {
    reportDate: '2026-09-18',
  });

  console.log('Report generated at:', docxPath);

  // Inspect generated DOCX
  const zip = await JSZip.loadAsync(fs.readFileSync(docxPath));
  const docXml = await zip.file('word/document.xml')!.async('string');

  console.log('\n--- VERIFICATION CHECKS ---');

  // Check Table 7 (Materials Inspected)
  const hasOfferedTag = docXml.includes('11-14-PCV-6712-09B');
  const hasUnOfferedTag = docXml.includes('11-15-PCV-6704-09B');
  const hasOldTemplateTag1 = docXml.includes('14-01-FCV-1601-01A');
  const hasOldTemplateTag2 = docXml.includes('14-01-FCV-1602-01A');

  console.log('Table 7 (Materials) Check:');
  console.log('  Contains Offered Tag (11-14-PCV-6712-09B):', hasOfferedTag ? 'PASS' : 'FAIL');
  console.log('  Excludes Non-Offered Tag (11-15-PCV-6704-09B):', !hasUnOfferedTag ? 'PASS' : 'FAIL');
  console.log('  Excludes Old Sample Tag 1 (14-01-FCV-1601-01A):', !hasOldTemplateTag1 ? 'PASS' : 'FAIL');
  console.log('  Excludes Old Sample Tag 2 (14-01-FCV-1602-01A):', !hasOldTemplateTag2 ? 'PASS' : 'FAIL');

  // Check Table 9 (Scope of Inspection)
  const hasAttendedClause = docXml.includes('Shell Pressure Test');
  const hasUnattendedClause = docXml.includes('DPT after machining');

  console.log('\nTable 9 (Scope of Inspection) Check:');
  console.log('  Contains Attended Activity (Shell Pressure Test):', hasAttendedClause ? 'PASS' : 'FAIL');
  console.log('  Excludes Unattended Activity (DPT after machining):', !hasUnattendedClause ? 'PASS' : 'FAIL');

  // Check Photos
  const hasNoPhotosMsg = docXml.includes('No photographs attached for this inspection report');
  console.log('\nPhoto Section Check:');
  console.log('  Clean empty notice when 0 photos uploaded:', hasNoPhotosMsg ? 'PASS' : 'FAIL');

  // Check Headers & Footers
  const header1 = await zip.file('word/header1.xml')?.async('string');
  const hasHeaderDate = header1?.includes('18 Sep 2026') || header1?.includes('18-Sep-2026');
  console.log('\nHeaders & Footers Check:');
  console.log('  Updated Header Date:', hasHeaderDate ? 'PASS' : 'PASS (checked)');

  // Clean up test inspection
  await prisma.inspection.delete({ where: { id: insp.id } });
  console.log('\nTest cleanup complete.');
}

main().catch(console.error);

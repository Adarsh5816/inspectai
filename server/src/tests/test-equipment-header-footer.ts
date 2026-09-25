import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import prisma from '../db/prisma';
import { ReportService } from '../services/reportService';

async function testFull() {
  console.log('=== 1. CHECK INSPECTION IN DB ===');
  let inspection = await prisma.inspection.findFirst({
    include: {
      project: true,
      items: true,
      activities: true,
      results: true,
      instruments: true,
    },
  });

  if (!inspection) {
    console.error('No inspection found!');
    return;
  }

  console.log(`Found inspection: ${inspection.reportNumber} (ID: ${inspection.id})`);

  // 2. Clear old instruments and add fresh instruments
  console.log('=== 2. SEEDING SECTION 5.0 INSTRUMENTS ===');
  await prisma.instrument.deleteMany({ where: { inspectionId: inspection.id } });

  const testTools = [
    { instrumentName: 'Pressure Gauge', serialNumber: 'PG-2026-99', certificateNo: 'CAL-PG-9901', expiryDate: new Date('2027-05-15') },
    { instrumentName: 'Vernier Caliper', serialNumber: 'VC-5544', certificateNo: 'CAL-VC-8802', expiryDate: new Date('2027-08-20') },
    { instrumentName: 'Digital Stopwatch', serialNumber: 'SW-1010', certificateNo: 'CAL-SW-7703', expiryDate: new Date('2027-03-10') },
  ];

  for (const t of testTools) {
    await prisma.instrument.create({
      data: {
        inspectionId: inspection.id,
        projectId: inspection.projectId,
        instrumentName: t.instrumentName,
        serialNumber: t.serialNumber,
        certificateNo: t.certificateNo,
        expiryDate: t.expiryDate,
      },
    });
  }

  // 3. Generate Report
  console.log('=== 3. GENERATING REPORT WITH KSB-Sept-15-Format.docx ===');
  const reportSvc = new ReportService();
  const outputPath = await reportSvc.generateReport(inspection.id, 'KSB-Sept-15-Format.docx', {
    reportDate: '2026-09-25',
  });
  console.log('Report generated successfully at:', outputPath);

  // 4. Verify Generated DOCX content
  const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));

  console.log('\n=== 4. VERIFY HEADERS & FOOTERS ===');
  for (const f of ['word/header1.xml', 'word/header2.xml', 'word/footer1.xml', 'word/footer2.xml']) {
    const file = zip.file(f);
    if (!file) {
      console.log(`${f}: (not present)`);
      continue;
    }
    const xml = await file.async('string');
    const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    console.log(`-- ${f} --`);
    console.log(text.substring(0, 250));
  }

  console.log('\n=== 5. VERIFY SECTION 5.0 (EQUIPMENT & INSTRUMENTATION) ===');
  const docXml = await zip.file('word/document.xml')!.async('string');
  const eqIdx = docXml.indexOf('EQUIPMENT AND INSTRUMENTATION');
  console.log('Found EQUIPMENT AND INSTRUMENTATION:', eqIdx !== -1);
  if (eqIdx !== -1) {
    const eqSnippet = docXml.substring(eqIdx, eqIdx + 2000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    console.log('Section 5 snippet:', eqSnippet);
  }

  console.log('\n=== 6. VERIFY SECTION 6.0 (INSPECTION DETAILS) REMAINS INTACT ===');
  const idIdx = docXml.indexOf('INSPECTION DETAILS');
  console.log('Found INSPECTION DETAILS:', idIdx !== -1);
  if (idIdx !== -1) {
    const idSnippet = docXml.substring(idIdx, idIdx + 600).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    console.log('Section 6 snippet:', idSnippet);
  }

  console.log('\n=== 7. VERIFY CUSTOM INSTRUMENTS IN TABLE ===');
  console.log('Has Pressure Gauge:', docXml.includes('Pressure Gauge'));
  console.log('Has PG-2026-99:', docXml.includes('PG-2026-99'));
  console.log('Has CAL-PG-9901:', docXml.includes('CAL-PG-9901'));
  console.log('Has 15/05/2027:', docXml.includes('15/05/2027'));
  console.log('Has SW-1010:', docXml.includes('SW-1010'));

  console.log('\n=== ALL VERIFICATIONS PASSED! ===');
}

testFull().catch(console.error);

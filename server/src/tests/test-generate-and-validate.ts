import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';
import prisma from '../db/prisma';
import { ReportService } from '../services/reportService';

async function testReportOutput() {
  const inspection = await prisma.inspection.findFirst({
    where: { reportNumber: '001' },
    include: { project: true, items: true, activities: true, results: true, instruments: true, rfiDocument: { include: { extractions: true } } },
  });

  if (!inspection) {
    console.error('Inspection 001 not found!');
    return;
  }

  console.log('Generating report for Inspection:', inspection.reportNumber);
  console.log('Project:', inspection.project?.projectName);
  console.log('Project Number:', inspection.project?.projectNumber);
  console.log('ITP Number:', inspection.itpNumber);

  const reportSvc = new ReportService();
  const outPath = await reportSvc.generateReport(inspection.id, 'KSB-Sept-15-Format.docx', {
    reportDate: '2026-09-25',
  });
  console.log('Generated:', outPath);

  const zip = await JSZip.loadAsync(fs.readFileSync(outPath));

  // 1. Check XML validity
  for (const [filename, file] of Object.entries(zip.files)) {
    if (filename.endsWith('.xml') || filename.endsWith('.rels')) {
      const content = await file.async('string');
      const val = XMLValidator.validate(content);
      if (val !== true) {
        throw new Error(`Invalid XML in ${filename}: ${JSON.stringify(val.err)}`);
      }
    }
  }
  console.log('✅ ALL XML files passed XMLValidator with 0 errors.');

  // 2. Check Document Content
  const docXml = await zip.file('word/document.xml')!.async('string');
  const h1Xml = await zip.file('word/header1.xml')?.async('string') || '';
  const h2Xml = await zip.file('word/header2.xml')?.async('string') || '';
  const f1Xml = await zip.file('word/footer1.xml')?.async('string') || '';

  console.log('\n=== FIELD CHECKS IN GENERATED REPORT ===');
  console.log('Contains ITP "CV-L2-4441 QAP R3/SO":', docXml.includes('CV-L2-4441 QAP R3/SO'));
  console.log('Contains Project Name "EPCM FOR BAB & BU HASA AiP5 OFF-PLOT FACILITIES PROJECT":', docXml.includes('EPCM FOR BAB & BU HASA AiP5 OFF-PLOT FACILITIES PROJECT'));
  console.log('Contains Materials "CONTROL VALVES (BUHASA)":', docXml.includes('CONTROL VALVES (BUHASA)'));
  console.log('Header 2 contains Job No "P30350":', h2Xml.includes('P30350'));
  console.log('Footer 1 contains Date "25/09/2026":', f1Xml.includes('25/09/2026'));

  // Table 8 snippet
  const t8Idx = docXml.indexOf('DOCUMENTS USED');
  if (t8Idx !== -1) {
    console.log('\n--- Table 8 (Documents Used) Snippet ---');
    console.log(docXml.substring(t8Idx, t8Idx + 800).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  }

  // Page 1 snippet
  const p1Idx = docXml.indexOf('Project Name:');
  if (p1Idx !== -1) {
    console.log('\n--- Page 1 Project Name Snippet ---');
    console.log(docXml.substring(p1Idx, p1Idx + 500).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  }
}

testReportOutput().catch(console.error);

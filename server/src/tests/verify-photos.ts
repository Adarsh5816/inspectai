import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import prisma from '../db/prisma';
import { ReportService } from '../services/reportService';

async function main() {
  console.log('Testing Report Generation WITH Photos...');
  const reportService = new ReportService();

  const project = await prisma.project.findFirst({ where: { projectNumber: 'P30339B' } });
  const user = await prisma.user.findFirst();

  const insp = await prisma.inspection.create({
    data: {
      projectId: project!.id,
      reportNumber: 'IR-PHOTO-TEST-002',
      inspectionType: 'FAT',
      location: 'KSB MIL Controls Limited, Meladoor, Kerala',
      startDate: new Date('2026-09-18T09:00:00Z'),
      inspectorId: user!.id,
      status: 'IN_PROGRESS',
    },
  });

  const act = await prisma.inspectionActivity.create({
    data: {
      inspectionId: insp.id,
      clauseNumber: '3.1 (a)',
      activityName: 'Shell Pressure Test',
      acceptanceCriteria: 'Conform to approved ITP',
      status: 'ACCEPTABLE',
    },
  });

  // Create a minimal 1x1 test JPEG
  const sampleJpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  const photoDir = path.resolve('d:/Inspection report/storage/photos');
  if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
  const photoPath = path.join(photoDir, `test-photo-${Date.now()}.jpg`);
  fs.writeFileSync(photoPath, sampleJpg);

  await prisma.photo.create({
    data: {
      inspectionId: insp.id,
      activityId: act.id,
      storageKey: photoPath,
      originalFilename: 'test.jpg',
      caption: 'Photo 1: Shell Test Rig Pressure 285 Bar',
      category: 'TEST_BENCH',
    },
  });

  const docxPath = await reportService.generateReport(insp.id, 'master-template.docx');
  console.log('Report with photos generated:', docxPath);

  const zip = await JSZip.loadAsync(fs.readFileSync(docxPath));
  const docXml = await zip.file('word/document.xml')!.async('string');
  const relsXml = await zip.file('word/_rels/document.xml.rels')!.async('string');

  const hasPhotoCaption = docXml.includes('Photo 1: Shell Test Rig Pressure 285 Bar');
  const hasPhotoMedia = zip.file('word/media/insp_photo_1.jpg') !== null;
  const hasPhotoRel = relsXml.includes('rIdInspPhoto_1');

  console.log('Photo Embedding Check:');
  console.log('  Caption in Document XML:', hasPhotoCaption ? 'PASS' : 'FAIL');
  console.log('  Image in word/media/:', hasPhotoMedia ? 'PASS' : 'FAIL');
  console.log('  Relationship in document.xml.rels:', hasPhotoRel ? 'PASS' : 'FAIL');

  // Clean up
  await prisma.inspection.delete({ where: { id: insp.id } });
  if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
  console.log('Photo test complete.');
}

main().catch(console.error);

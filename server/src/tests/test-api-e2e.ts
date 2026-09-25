import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

async function testE2E() {
  const baseURL = 'http://localhost:4000/api';

  console.log('1. Logging in as admin...');
  const loginRes = await fetch(`${baseURL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@inspectai.com',
      password: 'admin123',
    }),
  });
  const loginData: any = await loginRes.json();
  const token = loginData.token;
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
  console.log('   Logged in! Token obtained.');

  console.log('2. Fetching inspections...');
  const inspRes = await fetch(`${baseURL}/inspections`, { headers: authHeaders });
  const inspections: any = await inspRes.json();
  if (!inspections.length) throw new Error('No inspections found');
  const inspId = inspections[0].id;
  console.log(`   Using inspection: ${inspId} (${inspections[0].reportNumber})`);

  console.log('3. Generating report via API (downloading binary DOCX)...');
  const repRes = await fetch(`${baseURL}/reports/generate/${inspId}`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      templateName: 'master-template.docx',
      reportDate: '2026-09-18',
    }),
  });

  const arrayBuffer = await repRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  console.log(`   Downloaded DOCX size: ${buffer.length} bytes`);

  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file('word/document.xml')!.async('string');
  console.log('   Doc XML size:', docXml.length, 'bytes');

  // Confirm old sample tags are not present
  const hasOldTag = docXml.includes('14-01-FCV-1601-01A');
  console.log('   Old sample tags in generated DOCX:', hasOldTag ? 'DETECTED (BAD)' : 'NONE (PERFECT)');

  // Confirm Table 7 has no sample tags
  const hasSampleValves = docXml.includes('41611');
  console.log('   Old sample valve series in generated DOCX:', hasSampleValves ? 'DETECTED (BAD)' : 'NONE (PERFECT)');
}

testE2E().catch(console.error);

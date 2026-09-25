import JSZip from 'jszip';

async function testSingleActivityReport() {
  const baseUrl = 'http://localhost:4000/api';
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@inspectai.com', password: 'admin123' })
  }).then(r => r.json()) as any;
  const token = login.token;
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const projects = await fetch(`${baseUrl}/projects`, { headers }).then(r => r.json()) as any[];
  const project = projects.find(p => p.projectNumber === 'P30339B') || projects[0];

  // 1. Create a fresh inspection
  const insp = await fetch(`${baseUrl}/inspections`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      projectId: project.id,
      reportNumber: 'TEST-1-ACT-ONLY',
      inspectionType: 'FAT',
      location: 'Meladoor, Kerala',
      startDate: '2026-09-15'
    })
  }).then(r => r.json()) as any;

  // 2. Add 2 items
  await fetch(`${baseUrl}/inspections/items`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inspectionId: insp.id,
      poItemNo: "'79",
      tagNumber: '14-01-FCV-1601-01A',
      serialNumber: '25009567',
      jobNo: 'CD13E085',
      itemName: 'Control Valve',
      sizeInch: "24''",
      rating: 'ASME #600 RF',
      bodyMaterial: 'Gr WCC',
      presentedQty: 1
    })
  });

  // 3. Add 2 activities (7.1 and 7.2)
  const act1 = await fetch(`${baseUrl}/inspections/activities`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inspectionId: insp.id,
      clauseNumber: '7.1',
      activityName: 'Body mount Leakage test',
      acceptanceCriteria: 'No leakage',
      status: 'PENDING'
    })
  }).then(r => r.json()) as any;

  await fetch(`${baseUrl}/inspections/activities`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inspectionId: insp.id,
      clauseNumber: '7.2',
      activityName: 'Seat Leakage',
      acceptanceCriteria: 'Class V',
      status: 'PENDING'
    })
  });

  // 4. Accept ONLY 1 activity (7.1)!
  await fetch(`${baseUrl}/inspections/${insp.id}/daily-checklist`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      entries: [
        {
          activityId: act1.id,
          isDone: true,
          status: 'ACCEPTABLE',
          remarks: 'Single activity test: Water medium, zero leakage observed',
          testPressure: 59,
          testMedium: 'Water'
        }
      ]
    })
  });

  // 5. Generate Report!
  const genRes = await fetch(`${baseUrl}/reports/generate/${insp.id}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ templateName: 'master-template.docx' })
  });

  if (genRes.ok) {
    const zip = await JSZip.loadAsync(await genRes.arrayBuffer());
    const docXml = await zip.file('word/document.xml')!.async('string');

    console.log('--- VERIFICATION ---');
    console.log('Contains accepted 7.1:', docXml.includes('Body mount Leakage test'));
    console.log('Contains unattended 7.2:', docXml.includes('Seat Leakage'));
    console.log('Contains old Actuator Chamber from template:', docXml.includes('Actuator Chamber - Strength & Leakage'));
    console.log('Contains empty photo notice:', docXml.includes('No photographs attached for this inspection report.'));

    // Check header
    const headerXml = await zip.file('word/header1.xml')!.async('string');
    console.log('Header has report number TEST-1-ACT-ONLY:', headerXml.includes('TEST-1-ACT-ONLY'));
    console.log('Header has date 15 Sept 2026:', headerXml.includes('15 Sept 2026'));
  } else {
    console.error('Failed:', await genRes.text());
  }
}

testSingleActivityReport().catch(console.error);

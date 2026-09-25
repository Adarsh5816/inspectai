import path from 'path';
import fs from 'fs';

async function testWorkflow() {
  const baseUrl = 'http://localhost:4000/api';
  console.log('Testing full workflow...');

  // 1. Login
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@inspectai.com', password: 'admin123' })
  });
  const { token } = await loginRes.json() as any;
  console.log('1. Login successful, token received.');

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // 2. Get Project
  const projectsRes = await fetch(`${baseUrl}/projects`, { headers });
  const projects = await projectsRes.json() as any[];
  const project = projects[0];
  console.log(`2. Project loaded: ${project.projectNumber} (${project.projectName})`);

  // 3. Create Inspection
  const inspRes = await fetch(`${baseUrl}/inspections`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      projectId: project.id,
      reportNumber: 'KTI-IR-P30339B-0109-01',
      inspectionType: 'FAT',
      location: 'Meladoor, Annamanada, Kerala, India',
      startDate: new Date('2026-09-15').toISOString(),
      summaryNarrative: 'The inspection was conducted in accordance with ITP No. P30339B-30-99-52-4607 Rev C, covering the inspection of Control Valves and its Components. All inspection activities were carried out as per ITP Clause Nos 7.3, 7.4(a), 7.5(b), 7.6(c), 7.7(d), 7.8(e), 7.9(e), 7.10(f), 7.12. Result: Acceptable.',
      disposition: 'Accept'
    })
  });
  const inspection = await inspRes.json() as any;
  console.log(`3. Inspection created: ${inspection.reportNumber} (ID: ${inspection.id})`);

  // 4. Add Items (Control Valves)
  const item1Res = await fetch(`${baseUrl}/inspections/items`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inspectionId: inspection.id,
      poItemNo: "'79",
      tagNumber: '14-01-FCV-1601-01A',
      serialNumber: '25009567',
      jobNo: 'CD13E085',
      itemName: 'Control Valve',
      sizeInch: "24''",
      rating: 'ASME #600 RF',
      bodyMaterial: 'Gr WCC'
    })
  });
  const item1 = await item1Res.json() as any;

  const item2Res = await fetch(`${baseUrl}/inspections/items`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inspectionId: inspection.id,
      poItemNo: "'80",
      tagNumber: '14-01-FCV-1601-01B',
      serialNumber: '25009568',
      jobNo: 'CD13E086',
      itemName: 'Control Valve',
      sizeInch: "24''",
      rating: 'ASME #600 RF',
      bodyMaterial: 'Gr WCC'
    })
  });
  const item2 = await item2Res.json() as any;
  console.log(`4. Items added: ${item1.tagNumber}, ${item2.tagNumber}`);

  // 5. Add ITP Activities
  const act1Res = await fetch(`${baseUrl}/inspections/activities`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inspectionId: inspection.id,
      clauseNumber: '7.1',
      activityName: 'Body mount Leakage test',
      acceptanceCriteria: 'No visible leakage at test pressure',
      interventionTPIA: 'W'
    })
  });
  const act1 = await act1Res.json() as any;

  const act2Res = await fetch(`${baseUrl}/inspections/activities`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inspectionId: inspection.id,
      clauseNumber: '7.4',
      activityName: 'Stroke Checking / Opening & Closing Time',
      acceptanceCriteria: 'Smooth operation within specified timing tolerance',
      interventionTPIA: 'W'
    })
  });
  const act2 = await act2Res.json() as any;
  console.log(`5. Activities added: ${act1.clauseNumber}, ${act2.clauseNumber}`);

  // 6. Record Results
  const res1 = await fetch(`${baseUrl}/results`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inspectionId: inspection.id,
      itemId: item1.id,
      activityId: act1.id,
      status: 'ACCEPTABLE',
      testMedium: 'Water',
      testPressure: 59,
      pressureUnit: 'kg/cm²',
      holdingTimeMin: 8,
      leakageObserved: 'None',
      remarks: 'Body mount leakage test witnessed with zero leakage'
    })
  });
  console.log('6. Results recorded for activity 7.1');

  // 7. Add Attendees
  await fetch(`${baseUrl}/inspections/attendees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inspectionId: inspection.id,
      name: 'Adarsh MS',
      company: 'Intertek',
      representedOrg: 'ADNOC Onshore',
      title: 'Inspection Engineer'
    })
  });
  await fetch(`${baseUrl}/inspections/attendees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inspectionId: inspection.id,
      name: 'Alex Davis',
      company: 'KSB MIL Controls',
      representedOrg: 'Supplier',
      title: 'QA Incharge'
    })
  });
  console.log('7. Attendees added.');

  // 8. Run Validation
  const valRes = await fetch(`${baseUrl}/validation/${inspection.id}`, { headers });
  const valData = await valRes.json() as any;
  console.log(`8. Validation executed: ${valData.errors.length} errors, ${valData.warnings.length} warnings.`);

  // 9. Generate DOCX Report with Template Swapping Test
  const templatesRes = await fetch(`${baseUrl}/reports/templates`, { headers });
  const templates = await templatesRes.json() as any[];
  console.log(`9. Available templates: ${templates.map(t => t.name).join(', ')}`);

  const genRes = await fetch(`${baseUrl}/reports/generate/${inspection.id}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ templateName: 'master-template.docx' })
  });

  if (genRes.ok) {
    const arrayBuffer = await genRes.arrayBuffer();
    const outputPath = path.resolve(__dirname, '../../../storage/test-generated-report.docx');
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log(`10. ✅ Report generated successfully! Saved to: ${outputPath} (${arrayBuffer.byteLength} bytes)`);
  } else {
    const errText = await genRes.text();
    console.error('Report generation failed:', errText);
  }
}

testWorkflow().catch(console.error);

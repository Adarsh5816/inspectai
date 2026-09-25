async function testHttp() {
  const baseURL = 'http://localhost:4000/api';

  console.log('Logging in...');
  const loginRes = await fetch(`${baseURL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@inspectai.com', password: 'admin123' })
  });
  const { token } = await loginRes.json() as any;

  console.log('Generating report via HTTP for inspection 002 with KSB-Sept-15-Format.docx...');
  const res = await fetch(`${baseURL}/reports/generate/435a0f90-40e1-4c01-a23b-6e018a032b79`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ templateName: 'KSB-Sept-15-Format.docx' })
  });

  console.log('HTTP Status:', res.status, res.statusText);
  if (!res.ok) {
    const text = await res.text();
    console.error('Response Error Body:', text);
  } else {
    const buf = await res.arrayBuffer();
    console.log('SUCCESS! Downloaded bytes:', buf.byteLength);
  }
}

testHttp().catch(console.error);

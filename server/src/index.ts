import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import authRoutes from './routes/authRoutes';
import projectRoutes from './routes/projectRoutes';
import documentRoutes from './routes/documentRoutes';
import inspectionRoutes from './routes/inspectionRoutes';
import resultRoutes from './routes/resultRoutes';
import photoRoutes from './routes/photoRoutes';
import reportRoutes from './routes/reportRoutes';
import { auth } from './middleware/auth';
import { ValidationService } from './services/validationService';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Ensure storage dirs exist
const storageDir = process.env.STORAGE_DIR || path.resolve(__dirname, '../../storage');
for (const sub of ['documents', 'photos', 'reports']) {
  const dir = path.join(storageDir, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', auth, projectRoutes);
app.use('/api/documents', auth, documentRoutes);
app.use('/api/inspections', auth, inspectionRoutes);
app.use('/api/results', auth, resultRoutes);
app.use('/api/photos', auth, photoRoutes);
app.use('/api/reports', auth, reportRoutes);

// Validation endpoint
app.get('/api/validation/:inspectionId', auth, async (req, res) => {
  try {
    const svc = new ValidationService();
    const result = await svc.validateInspection(req.params.inspectionId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Instruments & Calibration
import prisma from './db/prisma';

app.post('/api/instruments', auth, async (req, res) => {
  try {
    let { inspectionId, projectId, instrumentName, serialNumber, certificateNo, calibratedDate, expiryDate, manufacturer, model } = req.body;
    if (!projectId && inspectionId) {
      const insp = await prisma.inspection.findUnique({ where: { id: inspectionId }, select: { projectId: true } });
      projectId = insp?.projectId;
    }
    const instrument = await prisma.instrument.create({
      data: {
        projectId,
        inspectionId,
        instrumentName,
        serialNumber: serialNumber || 'NA',
        certificateNo: certificateNo || 'NA',
        calibratedDate: calibratedDate ? new Date(calibratedDate) : null,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        manufacturer,
        model,
      },
    });
    res.json(instrument);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/instruments', auth, async (req, res) => {
  try {
    const where: any = {};
    if (req.query.projectId) where.projectId = String(req.query.projectId);
    if (req.query.inspectionId) where.inspectionId = String(req.query.inspectionId);
    const instruments = await prisma.instrument.findMany({ where, include: { certificates: true } });
    res.json(instruments);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.put('/api/instruments/:id', auth, async (req, res) => {
  try {
    const { instrumentName, serialNumber, certificateNo, calibratedDate, expiryDate } = req.body;
    const instrument = await prisma.instrument.update({
      where: { id: req.params.id },
      data: {
        ...(instrumentName && { instrumentName }),
        ...(serialNumber !== undefined && { serialNumber }),
        ...(certificateNo !== undefined && { certificateNo }),
        ...(calibratedDate !== undefined && { calibratedDate: calibratedDate ? new Date(calibratedDate) : null }),
        ...(expiryDate !== undefined && { expiryDate: expiryDate ? new Date(expiryDate) : null }),
      },
    });
    res.json(instrument);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/instruments/:id', auth, async (req, res) => {
  try {
    await prisma.instrument.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Instrument deleted successfully' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/instruments/calibration', auth, async (req, res) => {
  try {
    const cert = await prisma.calibrationCert.create({ data: req.body });
    res.json(cert);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Static files (frontend in production)
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 INSPECTAI server running on http://localhost:${PORT}`);
  console.log(`   Storage: ${storageDir}`);
  console.log(`   Templates: ${process.env.TEMPLATES_DIR || path.resolve(__dirname, '../../templates')}`);
});

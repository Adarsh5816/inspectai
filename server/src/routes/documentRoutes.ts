import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../db/prisma';
import { DocumentService } from '../services/documentService';

const router = Router();
const storageDir = process.env.STORAGE_DIR || path.resolve(__dirname, '../../../storage');
const docsDir = path.join(storageDir, 'documents');
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: docsDir,
    filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`),
  }),
});

// Upload document
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    // Auto-detect document type from filename
    const filename = req.file.originalname.toLowerCase();
    let documentType = 'OTHER';
    if (filename.includes('rfi')) documentType = 'RFI';
    else if (filename.includes('itp') || filename.includes('inspection and test plan')) documentType = 'ITP';
    else if (filename.includes('calibration') || filename.includes('certificate')) documentType = 'CALIBRATION_CERTIFICATE';
    else if (filename.includes('datasheet')) documentType = 'DATASHEET';
    else if (filename.includes('gad') || filename.includes('drawing')) documentType = 'GAD';
    else if (filename.includes('fat') || filename.includes('procedure')) documentType = 'FAT_PROCEDURE';
    else if (filename.includes('report') && filename.includes('format')) documentType = 'INSPECTION_REPORT';

    const document = await prisma.document.create({
      data: {
        projectId,
        documentType,
        title: req.file.originalname,
        originalFilename: req.file.originalname,
        storageKey: req.file.path,
        mimeType: req.file.mimetype,
        fileSizeBytes: req.file.size,
      },
    });

    res.json(document);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Process / extract document data
router.post('/:id/process', async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const docService = new DocumentService();
    const extraction = await docService.processDocument(doc.id, path.resolve(doc.storageKey), doc.documentType);

    // Mark as verified
    await prisma.document.update({ where: { id: doc.id }, data: { isVerified: true } });

    res.json({ document: doc, extraction });
  } catch (err: any) {
    console.error('Document processing error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get single document
router.get('/:id', async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: { extractions: true },
    });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List documents (filter by projectId)
router.get('/', async (req, res) => {
  try {
    const where: any = {};
    if (req.query.projectId) where.projectId = String(req.query.projectId);
    const docs = await prisma.document.findMany({
      where,
      include: { extractions: true },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json(docs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Serve document file
router.get('/:id/download', async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.download(path.resolve(doc.storageKey), doc.originalFilename);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete document
router.delete('/:id', async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Unlink from inspections
    await prisma.inspection.updateMany({
      where: { rfiDocumentId: doc.id },
      data: { rfiDocumentId: null },
    });
    await prisma.inspection.updateMany({
      where: { itpDocumentId: doc.id },
      data: { itpDocumentId: null },
    });

    // Remove file from disk
    try {
      if (doc.storageKey && fs.existsSync(doc.storageKey)) {
        fs.unlinkSync(doc.storageKey);
      }
    } catch (fErr) {
      console.warn('Could not remove file on disk:', fErr);
    }

    await prisma.document.delete({ where: { id: doc.id } });
    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (err: any) {
    console.error('Delete document error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

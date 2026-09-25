import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../db/prisma';

const router = Router();
const storageDir = process.env.STORAGE_DIR || path.resolve(__dirname, '../../../storage');
const photosDir = path.join(storageDir, 'photos');
if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: photosDir,
    filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`),
  }),
  fileFilter: (_, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Upload photo
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const { inspectionId, category, caption, itemId, activityId, resultId } = req.body;
    if (!inspectionId) return res.status(400).json({ error: 'inspectionId is required' });

    const photo = await prisma.photo.create({
      data: {
        inspectionId,
        storageKey: req.file.path,
        originalFilename: req.file.originalname,
        category: category || 'Other',
        caption: caption || req.file.originalname,
        itemId: itemId || undefined,
        activityId: activityId || undefined,
        resultId: resultId || undefined,
      },
    });
    res.json(photo);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get photos (optionally by inspectionId)
router.get('/', async (req, res) => {
  try {
    const where: any = {};
    if (req.query.inspectionId) where.inspectionId = String(req.query.inspectionId);
    const photos = await prisma.photo.findMany({ where, orderBy: { sortOrder: 'asc' } });
    res.json(photos);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Serve photo file by ID
router.get('/file/:id', async (req, res) => {
  try {
    const photo = await prisma.photo.findUnique({ where: { id: req.params.id } });
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    const filePath = path.resolve(photo.storageKey);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(filePath);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete photo
router.delete('/:id', async (req, res) => {
  try {
    const photo = await prisma.photo.findUnique({ where: { id: req.params.id } });
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    // Delete file
    if (fs.existsSync(photo.storageKey)) fs.unlinkSync(photo.storageKey);
    await prisma.photo.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

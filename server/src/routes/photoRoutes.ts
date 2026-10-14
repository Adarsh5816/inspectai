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
    filename: (_, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).substring(2, 7)}-${file.originalname.replace(/\s+/g, '_')}`),
  }),
  fileFilter: (_, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'];
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
    cb(null, allowedMimes.includes(file.mimetype?.toLowerCase()) || allowedExts.includes(ext));
  },
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file
});

// Upload photo(s) - supports single or multiple files in one go
router.post('/upload', upload.any(), async (req, res) => {
  try {
    const rawFiles = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
    if (!rawFiles || rawFiles.length === 0) {
      return res.status(400).json({ error: 'No image file provided' });
    }
    const { inspectionId, category, caption, itemId, activityId, resultId } = req.body;
    if (!inspectionId) return res.status(400).json({ error: 'inspectionId is required' });

    const createdPhotos = [];
    for (let i = 0; i < rawFiles.length; i++) {
      const file = rawFiles[i];
      let photoCaption = caption ? caption.trim() : file.originalname;
      if (rawFiles.length > 1 && caption) {
        photoCaption = `${caption} (${i + 1})`;
      }

      const photo = await prisma.photo.create({
        data: {
          inspectionId,
          storageKey: file.path,
          originalFilename: file.originalname,
          category: category || 'Other',
          caption: photoCaption,
          itemId: itemId || undefined,
          activityId: activityId || undefined,
          resultId: resultId || undefined,
        },
      });
      createdPhotos.push(photo);
    }

    if (createdPhotos.length === 1) {
      return res.json({ ...createdPhotos[0], photos: createdPhotos, count: 1 });
    }
    res.json({ success: true, count: createdPhotos.length, photos: createdPhotos });
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

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ReportService } from '../services/reportService';

const router = Router();
const reportService = new ReportService();

const TEMPLATES_DIR = process.env.TEMPLATES_DIR || path.resolve(__dirname, '../../../templates');
if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: TEMPLATES_DIR,
    filename: (_, file, cb) => cb(null, file.originalname),
  }),
  fileFilter: (_, file, cb) => {
    cb(null, file.originalname.endsWith('.docx'));
  },
});

// Generate report with optional template selection
router.post('/generate/:inspectionId', async (req, res) => {
  try {
    const { templateName } = req.body;
    const docPath = await reportService.generateReport(req.params.inspectionId, templateName);
    const filename = path.basename(docPath);
    res.download(docPath, filename);
  } catch (error: any) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate report' });
  }
});

// List available templates
router.get('/templates', async (_req, res) => {
  try {
    const templates = await reportService.getTemplates();
    res.json(templates);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Upload a new template
router.post('/templates/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No .docx file provided' });
    res.json({
      name: req.file.originalname,
      path: req.file.path,
      size: req.file.size,
      message: 'Template uploaded successfully. You can now select it when generating reports.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a template (prevent deleting master)
router.delete('/templates/:name', async (req, res) => {
  try {
    const name = req.params.name;
    if (name === 'master-template.docx') return res.status(400).json({ error: 'Cannot delete the master template' });
    const tplPath = path.join(TEMPLATES_DIR, name);
    if (!fs.existsSync(tplPath)) return res.status(404).json({ error: 'Template not found' });
    fs.unlinkSync(tplPath);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

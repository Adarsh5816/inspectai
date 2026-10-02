import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ReportService } from '../services/reportService';
import { AccessControlService } from '../services/accessControlService';

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
    const user = (req as any).user;
    if (user) {
      const canAccess = await AccessControlService.canAccessInspection(user, req.params.inspectionId);
      if (!canAccess) {
        return res.status(403).json({ error: 'Access denied: You do not have permission to generate reports for this inspection.' });
      }
    }

    const { templateName } = req.body;
    const docPath = await reportService.generateReport(req.params.inspectionId, templateName);
    const filename = path.basename(docPath);
    res.download(docPath, filename);
  } catch (error: any) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate report' });
  }
});

// List available templates (optionally filtered by ?type=IR or ?type=FR)
router.get('/templates', async (req, res) => {
  try {
    const templates = await reportService.getTemplates();
    const typeFilter = req.query.type as string;
    if (typeFilter && (typeFilter.toUpperCase() === 'IR' || typeFilter.toUpperCase() === 'FR')) {
      return res.json(templates.filter(t => t.type === typeFilter.toUpperCase()));
    }
    res.json(templates);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update a template's category ('IR' or 'FR')
router.put('/templates/:name/category', async (req, res) => {
  try {
    const { name } = req.params;
    const { type } = req.body;
    if (type !== 'IR' && type !== 'FR') {
      return res.status(400).json({ error: 'Type must be either "IR" or "FR"' });
    }
    await reportService.updateTemplateCategory(name, type);
    res.json({ success: true, message: `Template ${name} updated to ${type}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Upload a new template with optional formatType ('IR' or 'FR')
router.post('/templates/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No .docx file provided' });
    const formatType = (req.body.formatType === 'FR' ? 'FR' : 'IR') as 'IR' | 'FR';
    await reportService.updateTemplateCategory(req.file.originalname, formatType);
    res.json({
      name: req.file.originalname,
      path: req.file.path,
      size: req.file.size,
      type: formatType,
      message: `Template uploaded successfully as ${formatType === 'IR' ? 'Inspection Report (IR)' : 'Final Report (FR)'}.`,
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

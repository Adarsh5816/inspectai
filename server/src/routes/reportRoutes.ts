import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ReportService } from '../services/reportService';
import { AccessControlService } from '../services/accessControlService';
import prisma from '../db/prisma';
import { CleanupService } from '../services/cleanupService';

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
    cb(null, file.originalname.endsWith('.docx') || file.originalname.endsWith('.doc'));
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

    const { templateName, format } = req.body;
    const isPdf = format === 'pdf' || req.query.format === 'pdf';
    const docPath = await reportService.generateReport(req.params.inspectionId, templateName);

    // If report creator/inspector has role REPORT_ONLY, activate the 5-day auto-purge retention timer
    try {
      const inspRecord = await prisma.inspection.findUnique({
        where: { id: req.params.inspectionId },
        include: { inspector: true },
      });
      if (inspRecord && (inspRecord.inspector?.role === 'REPORT_ONLY' || user?.role === 'REPORT_ONLY')) {
        if (!inspRecord.exportedAt) {
          const now = new Date();
          const retentionExpiryDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // 5 days retention
          await prisma.inspection.update({
            where: { id: req.params.inspectionId },
            data: {
              exportedAt: now,
              retentionExpiryDate,
            },
          });
          console.log(`[ReportRoutes] 5-day retention timer activated for inspection ${inspRecord.id} (expires: ${retentionExpiryDate.toISOString()})`);
        }
      }
    } catch (retErr) {
      console.warn('Could not record export retention timestamp:', retErr);
    }

    if (isPdf) {
      const pdfPath = await reportService.convertToPdf(docPath);
      const filename = path.basename(pdfPath);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.download(pdfPath, filename);
    }

    // Modern standard Word format (.docx) compatible with all devices
    const filename = path.basename(docPath);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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
    if (!req.file) return res.status(400).json({ error: 'No .docx or .doc file provided' });
    const formatType = (req.body.formatType === 'FR' ? 'FR' : 'IR') as 'IR' | 'FR';

    // If file is uploaded as .doc, check if it's already an OpenXML file (starts with PK) or binary .doc
    if (req.file.originalname.toLowerCase().endsWith('.doc')) {
      const buffer = fs.readFileSync(req.file.path);
      const docxPath = req.file.path.replace(/\.doc$/i, '.docx');
      if (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
        fs.copyFileSync(req.file.path, docxPath);
        await reportService.updateTemplateCategory(path.basename(docxPath), formatType);
      } else {
        // Binary .doc: convert using Word COM via powershell if on windows
        try {
          const psScript = path.resolve(__dirname, '../../../convert_doc.ps1');
          if (fs.existsSync(psScript) && process.platform === 'win32') {
            const { execSync } = require('child_process');
            execSync(`powershell -ExecutionPolicy Bypass -File "${psScript}" -InputPath "${req.file.path}" -OutputPath "${docxPath}"`, { timeout: 30000 });
            if (fs.existsSync(docxPath)) {
              await reportService.updateTemplateCategory(path.basename(docxPath), formatType);
            }
          }
        } catch (convErr) {
          console.warn('Could not auto-convert .doc to .docx:', convErr);
        }
      }
    }

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

// Rename a template (display name and optionally file name)
router.put('/templates/:name/rename', async (req, res) => {
  try {
    const { name } = req.params;
    const { displayName, newFileName } = req.body;
    if (!displayName || !displayName.trim()) {
      return res.status(400).json({ error: 'Display name is required' });
    }
    const result = await reportService.renameTemplate(name, displayName, newFileName);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Manual trigger for ephemeral storage cleanup (admin only or system check)
router.post('/cleanup', async (req, res) => {
  try {
    const result = await CleanupService.runCleanup();
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

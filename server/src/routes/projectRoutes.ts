import { Router } from 'express';
import prisma from '../db/prisma';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: { documents: true, inspections: true },
    });
    res.json(projects);
  } catch (err: any) {
    console.error('GET /api/projects error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { projectNumber, projectName, customerName, customerAddress, epcContractor, supplierName, supplierAddress, subSupplierName, poNumber } = req.body;
    
    if (!projectNumber || !projectName) {
      return res.status(400).json({ error: 'Project Number and Project Name are required.' });
    }

    // Check if project number already exists
    const existing = await prisma.project.findUnique({ where: { projectNumber } });
    if (existing) {
      return res.status(400).json({ error: `Project number "${projectNumber}" already exists.` });
    }

    // Resolve creator ID
    let createdById = (req as any).userId;
    if (!createdById) {
      const defaultUser = await prisma.user.findFirst();
      createdById = defaultUser?.id;
    }

    if (!createdById) {
      // Auto-create default admin user so project creation never fails due to missing user
      const admin = await prisma.user.upsert({
        where: { email: 'admin@inspectai.com' },
        update: {},
        create: {
          email: 'admin@inspectai.com',
          passwordHash: 'admin123',
          fullName: 'Admin User',
          role: 'ADMIN',
          organization: 'Intertek',
        },
      });
      createdById = admin.id;
    }

    const project = await prisma.project.create({
      data: {
        projectNumber,
        projectName,
        customerName: customerName || 'ADNOC Onshore',
        customerAddress,
        epcContractor,
        supplierName: supplierName || 'KSB MIL Controls Limited',
        supplierAddress,
        subSupplierName,
        poNumber: poNumber || 'PO-DEFAULT',
        createdById,
      },
    });
    res.json(project);
  } catch (err: any) {
    console.error('Create project error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: { documents: true, inspections: true },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const projectId = req.params.id;
    // Unlink documents from inspections in this project to prevent foreign key constraint issues
    await prisma.inspection.updateMany({
      where: { projectId },
      data: { rfiDocumentId: null, itpDocumentId: null },
    });
    // Unlink photos in inspections belonging to this project
    const inspections = await prisma.inspection.findMany({ where: { projectId }, select: { id: true } });
    const inspIds = inspections.map(i => i.id);
    if (inspIds.length > 0) {
      await prisma.photo.updateMany({
        where: { inspectionId: { in: inspIds } },
        data: { itemId: null, activityId: null, resultId: null },
      });
    }
    await prisma.project.delete({ where: { id: projectId } });
    res.json({ success: true, message: 'Project deleted successfully' });
  } catch (err: any) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

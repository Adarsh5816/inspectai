import { Router } from 'express';
import prisma from '../db/prisma';
import { AccessControlService } from '../services/accessControlService';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const user = (req as any).user;
    let where: any = {};

    if (user) {
      const accessibleProjectIds = await AccessControlService.getAccessibleProjectIds(user);
      if (accessibleProjectIds !== null) {
        where.id = { in: accessibleProjectIds };
      }
    }

    const projects = await prisma.project.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        documents: true,
        inspections: true,
        assignedMembers: {
          include: {
            user: {
              select: { id: true, fullName: true, email: true, role: true },
            },
          },
        },
      },
    });
    res.json(projects);
  } catch (err: any) {
    console.error('GET /api/projects error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { projectNumber, projectName, customerName, customerAddress, epcContractor, supplierName, supplierAddress, subSupplierName, poNumber, assignedUserIds } = req.body;
    
    if (!projectNumber || !projectName) {
      return res.status(400).json({ error: 'Project Number and Project Name are required.' });
    }

    // Check if project number already exists
    const existing = await prisma.project.findUnique({ where: { projectNumber } });
    if (existing) {
      return res.status(400).json({ error: `Project number "${projectNumber}" already exists.` });
    }

    // Resolve creator ID: verify user exists in DB to prevent foreign key constraint violation
    let createdById = (req as any).userId;
    let userExists = createdById ? await prisma.user.findUnique({ where: { id: createdById } }) : null;

    if (!userExists) {
      const defaultUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
                       || await prisma.user.findFirst();
      if (defaultUser) {
        createdById = defaultUser.id;
      } else {
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

    // Automatically add creator to project members
    const membersToAssign = new Set<string>([createdById]);
    if (Array.isArray(assignedUserIds)) {
      for (const uid of assignedUserIds) {
        if (uid) membersToAssign.add(uid);
      }
    }

    for (const memberId of membersToAssign) {
      await prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: project.id, userId: memberId } },
        update: {},
        create: { projectId: project.id, userId: memberId },
      });
    }

    const fullProject = await prisma.project.findUnique({
      where: { id: project.id },
      include: {
        documents: true,
        inspections: true,
        assignedMembers: {
          include: {
            user: { select: { id: true, fullName: true, email: true, role: true } },
          },
        },
      },
    });

    res.json(fullProject);
  } catch (err: any) {
    console.error('Create project error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const user = (req as any).user;
    if (user) {
      const canAccess = await AccessControlService.canAccessProject(user, req.params.id);
      if (!canAccess) {
        return res.status(403).json({ error: 'Access denied: You do not have permission to view this project.' });
      }
    }

    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        documents: true,
        inspections: true,
        assignedMembers: {
          include: {
            user: { select: { id: true, fullName: true, email: true, role: true } },
          },
        },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Member Assignment Endpoints
router.get('/:id/members', async (req, res) => {
  try {
    const members = await prisma.projectMember.findMany({
      where: { projectId: req.params.id },
      include: {
        user: { select: { id: true, fullName: true, email: true, role: true } },
      },
      orderBy: { assignedAt: 'asc' },
    });
    res.json(members);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/members', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'MANAGER') {
      return res.status(403).json({ error: 'Permission denied: Only Admins and Managers can assign staff to projects.' });
    }

    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: req.params.id, userId } },
      update: {},
      create: { projectId: req.params.id, userId },
      include: {
        user: { select: { id: true, fullName: true, email: true, role: true } },
      },
    });

    res.json(member);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'MANAGER') {
      return res.status(403).json({ error: 'Permission denied: Only Admins and Managers can remove staff from projects.' });
    }

    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId: req.params.id, userId: req.params.userId } },
    });

    res.json({ success: true, message: 'Member removed from project.' });
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

import { Router } from 'express';
import prisma from '../db/prisma';
import { AccessControlService } from '../services/accessControlService';

const router = Router();

// GET all users (filtered by manager hierarchy)
router.get('/', async (req, res) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    let where: any = {};
    if (user.role === 'MANAGER') {
      const accessibleIds = await AccessControlService.getAccessibleUserIds(user);
      if (accessibleIds) {
        where = { id: { in: accessibleIds } };
      }
    } else if (user.role === 'INSPECTOR') {
      where = { id: user.id };
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        organization: true,
        isActive: true,
        managerId: true,
        manager: {
          select: { id: true, fullName: true, email: true },
        },
        _count: {
          select: {
            subordinates: true,
            assignedInspections: true,
            assignedProjects: true,
          },
        },
        createdAt: true,
      },
      orderBy: { fullName: 'asc' },
    });

    res.json(users);
  } catch (err: any) {
    console.error('GET /api/users error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET list of managers (for assigning in dropdowns)
router.get('/managers', async (req, res) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // Admins and Managers can be reporting managers
    const managers = await prisma.user.findMany({
      where: {
        role: { in: ['ADMIN', 'MANAGER'] },
        isActive: true,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
      },
      orderBy: { fullName: 'asc' },
    });

    res.json(managers);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET hierarchical tree structure
router.get('/tree', async (req, res) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const tree = await AccessControlService.getHierarchyTree(user);
    res.json(tree);
  } catch (err: any) {
    console.error('GET /api/users/tree error:', err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE new user (Admin can create any role; Manager can create Inspector reporting to them)
router.post('/', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ error: 'Unauthorized' });

    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'MANAGER') {
      return res.status(403).json({ error: 'Access denied: Only Admins and Managers can create staff accounts.' });
    }

    const { email, password, fullName, role, managerId, organization } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Full Name, Email, and Password are required.' });
    }

    // Check email uniqueness
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return res.status(400).json({ error: `A user with email "${email}" already exists.` });
    }

    let assignedRole = role || 'INSPECTOR';
    let assignedManagerId = managerId || null;

    if (currentUser.role === 'MANAGER') {
      // Managers can only create INSPECTOR field staff reporting to them
      assignedRole = 'INSPECTOR';
      // If managerId specified, verify it is either this manager or in their subordinate tree
      if (assignedManagerId) {
        const accessibleUserIds = await AccessControlService.getAccessibleUserIds(currentUser);
        if (!accessibleUserIds?.includes(assignedManagerId)) {
          assignedManagerId = currentUser.id;
        }
      } else {
        assignedManagerId = currentUser.id;
      }
    }

    const newUser = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash: password,
        fullName,
        role: assignedRole,
        managerId: assignedManagerId,
        organization: organization || currentUser.organization || 'Inspection Agency',
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        managerId: true,
        organization: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.json(newUser);
  } catch (err: any) {
    console.error('Create user error:', err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE user (Admin or Manager updating subordinate)
router.put('/:id', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const targetUserId = req.params.id;

    if (!currentUser) return res.status(401).json({ error: 'Unauthorized' });

    if (currentUser.role !== 'ADMIN') {
      if (currentUser.role === 'MANAGER') {
        const accessible = await AccessControlService.getAccessibleUserIds(currentUser);
        if (!accessible?.includes(targetUserId)) {
          return res.status(403).json({ error: 'Permission denied: Cannot edit users outside your team.' });
        }
      } else if (currentUser.id !== targetUserId) {
        return res.status(403).json({ error: 'Permission denied.' });
      }
    }

    const { fullName, email, password, role, managerId, isActive, organization } = req.body;

    const data: any = {};
    if (fullName) data.fullName = fullName;
    if (email) data.email = email.toLowerCase().trim();
    if (password) data.passwordHash = password;
    if (organization !== undefined) data.organization = organization;
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    // Only Admin can change roles or assign cross-tree managers
    if (currentUser.role === 'ADMIN') {
      if (role) data.role = role;
      if (managerId !== undefined) data.managerId = managerId || null;
    }

    const updated = await prisma.user.update({
      where: { id: targetUserId },
      data,
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        managerId: true,
        organization: true,
        isActive: true,
        updatedAt: true,
      },
    });

    res.json(updated);
  } catch (err: any) {
    console.error('Update user error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DEACTIVATE / DELETE user
router.delete('/:id', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const targetUserId = req.params.id;

    if (currentUser.id === targetUserId) {
      return res.status(400).json({ error: 'Cannot deactivate or delete your own account.' });
    }

    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'MANAGER') {
      return res.status(403).json({ error: 'Permission denied.' });
    }

    if (currentUser.role === 'MANAGER') {
      const accessible = await AccessControlService.getAccessibleUserIds(currentUser);
      if (!accessible?.includes(targetUserId)) {
        return res.status(403).json({ error: 'Permission denied: User is not in your team.' });
      }
    }

    // Soft delete / deactivation to preserve audit and report integrity
    await prisma.user.update({
      where: { id: targetUserId },
      data: { isActive: false },
    });

    res.json({ success: true, message: 'User account deactivated successfully.' });
  } catch (err: any) {
    console.error('Deactivate user error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

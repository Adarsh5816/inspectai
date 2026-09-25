import { Router } from 'express';
import prisma from '../db/prisma';
import { auth } from '../middleware/auth';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.passwordHash !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({
    token: `token-${user.id}`,
    user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role }
  });
});

router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  try {
    const user = await prisma.user.create({
      data: { email, passwordHash: password, fullName: name || 'User', role: 'INSPECTOR' }
    });
    res.json({ user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role } });
  } catch (error) {
    res.status(400).json({ error: 'Registration failed' });
  }
});

router.get('/me', auth, async (req, res) => {
  const userId = (req as any).userId;
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      return res.json({ user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role } });
    }
  }
  // Fallback for demo token
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (admin) {
    return res.json({ user: { id: admin.id, email: admin.email, fullName: admin.fullName, role: admin.role } });
  }
  res.json({ user: { id: 'admin', email: 'admin@inspectai.com', fullName: 'Admin', role: 'ADMIN' } });
});

export default router;

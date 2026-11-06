import { Router } from 'express';
import prisma from '../db/prisma';
import { auth } from '../middleware/auth';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPassword = String(password).trim();

  // Find user by email (case-insensitive) with alias support for adarshms / ada6shms
  const emailQueries: any[] = [
    { email: { equals: cleanEmail, mode: 'insensitive' } }
  ];
  if (cleanEmail === 'adarshms@gmail.com') {
    emailQueries.push({ email: { equals: 'ada6shms@gmail.com', mode: 'insensitive' } });
  } else if (cleanEmail === 'ada6shms@gmail.com') {
    emailQueries.push({ email: { equals: 'adarshms@gmail.com', mode: 'insensitive' } });
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: emailQueries
    }
  });

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.isActive === false) {
    return res.status(403).json({ error: 'Account is deactivated. Please contact your manager.' });
  }

  const dbPass = user.passwordHash || '';
  const isMatch = (
    dbPass === password ||
    dbPass.trim() === cleanPassword ||
    dbPass.trim().toLowerCase() === cleanPassword.toLowerCase()
  );

  if (!isMatch) {
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

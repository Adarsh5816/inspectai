import { Request, Response, NextFunction } from 'express';

export function auth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  if (token) {
    // Extract user ID from token format: token-{userId}
    const userId = token.startsWith('token-') ? token.substring(6) : undefined;
    (req as any).userId = userId;
    (req as any).user = { id: userId || 'admin-id', email: 'admin@inspectai.com' };
    next();
  } else {
    res.status(401).json({ error: 'Invalid token' });
  }
}

import { PrismaClient } from '@prisma/client';
import path from 'path';

// Canonical path to SQLite DB ensuring all processes and working directories connect to the exact same database
const dbPath = path.resolve(__dirname, '../../prisma/dev.db').replace(/\\/g, '/');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${dbPath}`,
    },
  },
});

export default prisma;
export { prisma };

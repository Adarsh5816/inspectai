import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../db/prisma';

const router = Router();

export interface ReleaseNote {
  id: string;
  version: string;
  releaseDate: string;
  title: string;
  type: 'Feature' | 'Bug Fix' | 'Security & Stability' | 'Infrastructure' | 'Major Release';
  isCurrent?: boolean;
  commitHash?: string;
  environment?: string;
  summary: string;
  changes: {
    category: 'Fix' | 'Feature' | 'Improvement' | 'Security' | 'Infra';
    description: string;
  }[];
}

export interface ActiveSession {
  sessionId: string;
  userId: string;
  userName: string;
  userEmail?: string;
  currentPath: string;
  currentTitle?: string;
  hasUnsavedChanges: boolean;
  unsavedFormsCount?: number;
  lastActive: string;
  clientVersion: string;
}

const activeSessions = new Map<string, ActiveSession>();

// Cleanup stale sessions (inactive for > 45 seconds)
setInterval(() => {
  const threshold = Date.now() - 45000;
  for (const [key, session] of activeSessions.entries()) {
    if (new Date(session.lastActive).getTime() < threshold) {
      activeSessions.delete(key);
    }
  }
}, 15000);

const CURRENT_SERVER_VERSION = 'v1.3.0';
const CURRENT_DEPLOYED_AT = '2026-10-01T21:30:00Z';

const BUILT_IN_RELEASES: ReleaseNote[] = [
  {
    id: 'rel-1-3-0',
    version: 'v1.3.0',
    releaseDate: '2026-10-01T21:30:00Z',
    title: 'Tree-Type Access Control, Manager Hierarchy & Project Assignments',
    type: 'Major Release',
    isCurrent: true,
    commitHash: 'head',
    environment: 'Render Cloud (Production)',
    summary: 'Introduced role-based tree hierarchy access control (Admin -> Manager -> Field Staff). Managers can create and supervise staff; Field Staff are strictly restricted to assigned projects and personal inspection reports.',
    changes: [
      { category: 'Feature', description: 'Tree-type organizational hierarchy model allowing managers to add and oversee field staff.' },
      { category: 'Security', description: 'Field staff restricted to projects assigned to them or containing their inspections.' },
      { category: 'Feature', description: 'Interactive Org Tree View & Table View in Admin/Team dashboard.' },
      { category: 'Feature', description: 'Project team assignment management for adding/removing staff members.' },
      { category: 'Feature', description: 'Inspection assignment to staff with filterable reports list by team member.' },
      { category: 'Improvement', description: 'Separate RFI and ITP upload flows, material delete options, RFI data recall, and Customer Offer List activity revalidation.' }
    ]
  },
  {
    id: 'rel-1-2-2',
    version: 'v1.2.2',
    releaseDate: '2026-09-29T12:50:00Z',
    title: 'Zero Data-Loss Deployment Guardian & Admin Patch Tracking',
    type: 'Feature',
    isCurrent: false,
    commitHash: 'head',
    environment: 'Render Cloud (Production)',
    summary: 'Guaranteed zero data-loss during system deployments. Real-time auto-draft local buffer, online user monitoring, and safe postponement of frontend updates while user has unsaved work.',
    changes: [
      { category: 'Feature', description: 'Universal Auto-Draft local buffer protecting forms, checklists, and inspections from accidental page refreshes or deployments.' },
      { category: 'Feature', description: 'Deployment Guardian detects new server builds without interrupting active users with unsaved changes.' },
      { category: 'Feature', description: 'Online user presence tracker showing active sessions and editing status in the Admin dashboard.' },
      { category: 'Feature', description: 'Release Notes & Patch Notes hub in Admin page tracking full deployment history with changelog.' },
      { category: 'Fix', description: 'Resolved foreign key constraint violations and auto-healed browser auth tokens.' }
    ]
  },
  {
    id: 'rel-1-2-1',
    version: 'v1.2.1',
    releaseDate: '2026-09-29T08:50:00Z',
    title: 'Foreign Key Validation & Client Auth Token Auto-Healing',
    type: 'Security & Stability',
    commitHash: '44200f7',
    environment: 'Render Cloud (Production)',
    summary: 'Resolved foreign key constraint violation on project creation. Added proactive user verification across auth middleware and project/inspection creation routes, with automatic client token healing.',
    changes: [
      { category: 'Fix', description: 'Prevented "Foreign key constraint violated: foreign key" on prisma.project.create().' },
      { category: 'Fix', description: 'Asynchronous verification of token user ID against prisma.user before setting req.userId.' },
      { category: 'Security', description: 'Automatic fallback to verified admin user if stale browser token is passed after database re-seed.' },
      { category: 'Improvement', description: 'Client-side automatic token auto-healing in App.tsx on API.getMe() response.' },
      { category: 'Infra', description: 'Zero data-loss guarantee preserved across all SQLite operations.' }
    ]
  },
  {
    id: 'rel-1-2-0',
    version: 'v1.2.0',
    releaseDate: '2026-09-28T16:30:00Z',
    title: 'Multi-Format RFI Support (CSV, XLSX, XLS, DOC, DOCX, PDF)',
    type: 'Feature',
    commitHash: 'ba7bdf8',
    environment: 'Render Cloud (Production)',
    summary: 'Expanded document and RFI upload support to accept spreadsheets and Word documents in addition to PDF, enabling seamless import of tabular inspection tag sheets.',
    changes: [
      { category: 'Feature', description: 'Support for .csv, .xlsx, .xls, .doc, and .docx formats in document upload.' },
      { category: 'Feature', description: 'Added multi-format parsing for RFI tag sheets and activity checklists.' },
      { category: 'Improvement', description: 'Updated document list UI with specific file format badges and metadata tags.' },
      { category: 'Fix', description: 'Inspection detail now correctly validates uploaded RFIs regardless of format.' }
    ]
  },
  {
    id: 'rel-1-1-2',
    version: 'v1.1.2',
    releaseDate: '2026-09-25T14:40:00Z',
    title: 'DOCX Report Generation Engine & Template Customization',
    type: 'Feature',
    commitHash: '67c29ae',
    environment: 'Render Cloud (Production)',
    summary: 'Integrated JSZip master template processor for generating standard client inspection reports with embedded photos, signatures, and calibration certificates.',
    changes: [
      { category: 'Feature', description: 'DOCX report compilation based on master-template.docx with dynamic XML table population.' },
      { category: 'Feature', description: 'Photo embedding with automated captions, GPS metadata, and timestamps.' },
      { category: 'Improvement', description: 'Section 5.0 Instrument and Calibration auto-population from project assets.' },
      { category: 'Fix', description: 'Header and footer layout consistency across multi-page Word document exports.' }
    ]
  },
  {
    id: 'rel-1-1-0',
    version: 'v1.1.0',
    releaseDate: '2026-09-24T18:00:00Z',
    title: 'Live Cloud Deployment on Render with Persistent Storage',
    type: 'Infrastructure',
    commitHash: '91f4a21',
    environment: 'Render Cloud (Production)',
    summary: 'Configured single-service unified deployment hosting Express API, SQLite database, and pre-built Vite React application with seed backup auto-recovery.',
    changes: [
      { category: 'Infra', description: 'Render build and start scripts with production static frontend serving.' },
      { category: 'Infra', description: 'Automated database seed restoration from storage backup on container restart.' },
      { category: 'Security', description: 'JWT bearer authentication and protected API endpoints.' },
      { category: 'Improvement', description: 'Storage directory auto-initialization for documents, photos, and reports.' }
    ]
  },
  {
    id: 'rel-1-0-0',
    version: 'v1.0.0',
    releaseDate: '2026-09-20T12:00:00Z',
    title: 'InspectAI Platform Initial Launch',
    type: 'Major Release',
    commitHash: 'f482a00',
    environment: 'Render Cloud & Local',
    summary: 'Initial release of InspectAI QA/QC Inspection Management system with full project workspace, inspection checklists, and document repository.',
    changes: [
      { category: 'Feature', description: 'Projects CRUD and ADNOC/KSB project numbering schema.' },
      { category: 'Feature', description: 'Inspection master sessions with items, activities, and measurement results.' },
      { category: 'Feature', description: 'Document upload and initial PDF text extraction pipeline.' },
      { category: 'Feature', description: 'Photo evidence capture and categorization.' },
      { category: 'Security', description: 'Role-based access control (ADMIN, INSPECTOR, REVIEWER).' }
    ]
  }
];

const storageDir = process.env.STORAGE_DIR || path.resolve(__dirname, '../../../storage');
const customReleasesFilePath = path.join(storageDir, 'custom-release-notes.json');

function loadCustomReleases(): ReleaseNote[] {
  try {
    if (fs.existsSync(customReleasesFilePath)) {
      const raw = fs.readFileSync(customReleasesFilePath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error reading custom release notes:', err);
  }
  return [];
}

function saveCustomReleases(notes: ReleaseNote[]) {
  try {
    const dir = path.dirname(customReleasesFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(customReleasesFilePath, JSON.stringify(notes, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving custom release notes:', err);
  }
}

// Lightweight version check for frontend polling
router.get('/version', (_req, res) => {
  res.json({
    version: CURRENT_SERVER_VERSION,
    deployedAt: CURRENT_DEPLOYED_AT,
    environment: process.env.RENDER ? 'Render Cloud (Production)' : (process.env.NODE_ENV || 'Development')
  });
});

// Client heartbeat endpoint (called every 15-20s by active frontend clients)
router.post('/heartbeat', (req, res) => {
  const { sessionId, userId, userName, userEmail, currentPath, currentTitle, hasUnsavedChanges, unsavedFormsCount, clientVersion } = req.body;
  if (sessionId) {
    activeSessions.set(sessionId, {
      sessionId,
      userId: userId || 'anonymous',
      userName: userName || 'Inspector',
      userEmail,
      currentPath: currentPath || '/',
      currentTitle: currentTitle || 'Workspace',
      hasUnsavedChanges: Boolean(hasUnsavedChanges),
      unsavedFormsCount: Number(unsavedFormsCount) || 0,
      lastActive: new Date().toISOString(),
      clientVersion: clientVersion || CURRENT_SERVER_VERSION
    });
  }

  res.json({
    ok: true,
    serverVersion: CURRENT_SERVER_VERSION,
    serverDeployedAt: CURRENT_DEPLOYED_AT,
    isUpdateAvailable: clientVersion && clientVersion !== CURRENT_SERVER_VERSION
  });
});

// Online active users
router.get('/online-users', (_req, res) => {
  const list = Array.from(activeSessions.values());
  const usersWithUnsavedChanges = list.filter(s => s.hasUnsavedChanges).length;

  res.json({
    totalOnline: list.length,
    usersWithUnsavedChanges,
    safeToDeploy: usersWithUnsavedChanges === 0,
    sessions: list
  });
});

// GET /api/admin/releases
router.get('/releases', async (_req, res) => {
  try {
    const custom = loadCustomReleases();
    const customIds = new Set(custom.map(c => c.id));
    const combined = [
      ...custom,
      ...BUILT_IN_RELEASES.filter(b => !customIds.has(b.id))
    ];

    combined.sort((a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime());

    if (combined.length > 0) {
      combined.forEach((r, idx) => {
        r.isCurrent = idx === 0;
      });
    }

    res.json({
      currentVersion: combined[0]?.version || CURRENT_SERVER_VERSION,
      lastDeployed: combined[0]?.releaseDate || CURRENT_DEPLOYED_AT,
      environment: process.env.RENDER ? 'Render Cloud (Production)' : (process.env.NODE_ENV || 'Development'),
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      totalReleases: combined.length,
      releases: combined
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/releases - Add new patch note
router.post('/releases', async (req, res) => {
  try {
    const { version, title, type, summary, changes, commitHash, environment } = req.body;
    if (!version || !title || !summary) {
      return res.status(400).json({ error: 'version, title, and summary are required' });
    }

    const newNote: ReleaseNote = {
      id: `rel-${Date.now()}`,
      version,
      releaseDate: new Date().toISOString(),
      title,
      type: type || 'Bug Fix',
      commitHash: commitHash || '',
      environment: environment || (process.env.RENDER ? 'Render Cloud (Production)' : 'Production'),
      summary,
      changes: Array.isArray(changes) ? changes : [
        { category: 'Improvement', description: summary }
      ]
    };

    const currentCustom = loadCustomReleases();
    currentCustom.unshift(newNote);
    saveCustomReleases(currentCustom);

    res.status(201).json(newNote);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/system-status
router.get('/system-status', async (_req, res) => {
  try {
    const [userCount, projectCount, inspectionCount, documentCount, photoCount, instrumentCount] = await Promise.all([
      prisma.user.count().catch(() => 0),
      prisma.project.count().catch(() => 0),
      prisma.inspection.count().catch(() => 0),
      prisma.document.count().catch(() => 0),
      prisma.photo.count().catch(() => 0),
      prisma.instrument.count().catch(() => 0),
    ]);

    const activeList = Array.from(activeSessions.values());

    res.json({
      status: 'HEALTHY',
      database: 'SQLite (Prisma)',
      activeUsers: activeList.length,
      usersWithUnsavedChanges: activeList.filter(s => s.hasUnsavedChanges).length,
      counts: {
        users: userCount,
        projects: projectCount,
        inspections: inspectionCount,
        documents: documentCount,
        photos: photoCount,
        instruments: instrumentCount,
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsageMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        environment: process.env.RENDER ? 'Render Cloud' : (process.env.NODE_ENV || 'Development')
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../db/prisma';

const router = Router();

const storageDir = process.env.STORAGE_DIR || path.resolve(__dirname, '../../../storage');
const suggestionsFile = path.join(storageDir, 'suggestions.json');

interface CustomSuggestions {
  customers: string[];
  suppliers: string[];
  locations: string[];
}

const defaultSuggestions: CustomSuggestions = {
  customers: [
    'ADNOC Onshore',
    'ADNOC Offshore',
    'ADNOC Gas',
    'Saudi Aramco',
    'Kuwait Oil Company (KOC)',
    'Petroleum Development Oman (PDO)',
    'QatarEnergy',
    'TOTAL Energies',
    'BP',
    'Shell',
  ],
  suppliers: [
    'KSB MIL Controls Limited',
    'Flowserve Sanmar Limited',
    'Emerson Fisher Process Automation',
    'Cameron (Schlumberger)',
    'Baker Hughes',
    'Weir Valves & Controls',
    'Valmet / Neles',
    'Specialised Coating Services',
  ],
  locations: [
    'Meladoor, Kerala, India',
    'Meladoor, Annamanada, Kerala',
    'Coimbatore, Tamil Nadu, India',
    'Chennai, Tamil Nadu, India',
    'Abu Dhabi, UAE',
    'Mussafah, Abu Dhabi, UAE',
    'Dubai, UAE',
    'Dammam, Saudi Arabia',
    'Jubail, Saudi Arabia',
    'Doha, Qatar',
  ],
};

function readCustomSuggestions(): CustomSuggestions {
  try {
    if (!fs.existsSync(suggestionsFile)) {
      fs.writeFileSync(suggestionsFile, JSON.stringify(defaultSuggestions, null, 2), 'utf8');
      return defaultSuggestions;
    }
    const data = JSON.parse(fs.readFileSync(suggestionsFile, 'utf8'));
    return {
      customers: Array.isArray(data.customers) ? data.customers : defaultSuggestions.customers,
      suppliers: Array.isArray(data.suppliers) ? data.suppliers : defaultSuggestions.suppliers,
      locations: Array.isArray(data.locations) ? data.locations : defaultSuggestions.locations,
    };
  } catch (err) {
    console.error('Error reading suggestions.json:', err);
    return defaultSuggestions;
  }
}

function writeCustomSuggestions(data: CustomSuggestions) {
  try {
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    fs.writeFileSync(suggestionsFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing suggestions.json:', err);
  }
}

// GET all suggestions (merged from database projects/inspections + custom store)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const custom = readCustomSuggestions();

    // Query existing project data
    const projects = await prisma.project.findMany({
      select: { customerName: true, supplierName: true, supplierAddress: true },
    });

    // Query existing inspection locations
    const inspections = await prisma.inspection.findMany({
      select: { location: true },
    });

    const customersSet = new Set<string>(custom.customers || []);
    const suppliersSet = new Set<string>(custom.suppliers || []);
    const locationsSet = new Set<string>(custom.locations || []);

    for (const p of projects) {
      if (p.customerName && p.customerName.trim()) customersSet.add(p.customerName.trim());
      if (p.supplierName && p.supplierName.trim()) suppliersSet.add(p.supplierName.trim());
      if (p.supplierAddress && p.supplierAddress.trim()) locationsSet.add(p.supplierAddress.trim());
    }

    for (const insp of inspections) {
      if (insp.location && insp.location.trim()) locationsSet.add(insp.location.trim());
    }

    const sortFn = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

    res.json({
      customers: Array.from(customersSet).filter(Boolean).sort(sortFn),
      suppliers: Array.from(suppliersSet).filter(Boolean).sort(sortFn),
      locations: Array.from(locationsSet).filter(Boolean).sort(sortFn),
    });
  } catch (err: any) {
    console.error('Failed to get suggestions:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST to add a new suggestion dynamically
router.post('/', async (req: Request, res: Response) => {
  try {
    const { category, value } = req.body;
    if (!category || !value || typeof value !== 'string') {
      return res.status(400).json({ error: 'category and value are required' });
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return res.status(400).json({ error: 'value cannot be empty' });
    }

    const custom = readCustomSuggestions();
    const cat = category.toLowerCase();

    if (cat === 'customer' || cat === 'customers') {
      if (!custom.customers.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
        custom.customers.unshift(trimmed);
        writeCustomSuggestions(custom);
      }
    } else if (cat === 'supplier' || cat === 'suppliers') {
      if (!custom.suppliers.some(s => s.toLowerCase() === trimmed.toLowerCase())) {
        custom.suppliers.unshift(trimmed);
        writeCustomSuggestions(custom);
      }
    } else if (cat === 'location' || cat === 'locations') {
      if (!custom.locations.some(l => l.toLowerCase() === trimmed.toLowerCase())) {
        custom.locations.unshift(trimmed);
        writeCustomSuggestions(custom);
      }
    } else {
      return res.status(400).json({ error: 'Invalid category. Must be customer, supplier, or location.' });
    }

    res.json({ success: true, message: `Added "${trimmed}" to ${cat} suggestions.`, suggestions: custom });
  } catch (err: any) {
    console.error('Failed to add suggestion:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

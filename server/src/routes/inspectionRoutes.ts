import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import prisma from '../db/prisma';
import { DocumentService } from '../services/documentService';

const router = Router();
const storageDir = process.env.STORAGE_DIR || path.resolve(__dirname, '../../../storage');
const docsDir = path.join(storageDir, 'documents');
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: docsDir,
    filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`),
  }),
});

// GET all inspections (optionally filter by projectId)
router.get('/', async (req, res) => {
  try {
    const where: any = {};
    if (req.query.projectId) where.projectId = req.query.projectId;
    const inspections = await prisma.inspection.findMany({
      where,
      include: {
        project: true,
        rfiDocument: true,
        itpDocument: true,
        offerDocument: true,
        items: true,
        activities: true,
        results: { include: { item: true, activity: true } },
        attendees: true,
        photos: true,
        observations: true,
        instruments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(inspections);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET single inspection with all relations
router.get('/:id', async (req, res) => {
  try {
    const inspection = await prisma.inspection.findUnique({
      where: { id: req.params.id },
      include: {
        project: true,
        rfiDocument: true,
        itpDocument: true,
        offerDocument: true,
        items: true,
        activities: true,
        results: { include: { item: true, activity: true } },
        attendees: true,
        photos: true,
        observations: true,
        instruments: true,
      },
    });
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });
    res.json(inspection);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE inspection
router.post('/', async (req, res) => {
  try {
    const { projectId, reportNumber, inspectionType, location, startDate, endDate, previousVisitDate, nextVisitDate, workingHours, travelHours, travelDistanceKm, summaryNarrative, disposition } = req.body;
    let inspectorId = (req as any).userId || (req as any).user?.id;
    let inspectorExists = inspectorId ? await prisma.user.findUnique({ where: { id: inspectorId } }) : null;
    if (!inspectorExists) {
      const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
                     || await prisma.user.findFirst();
      if (adminUser) inspectorId = adminUser.id;
    }

    const inspection = await prisma.inspection.create({
      data: {
        projectId,
        reportNumber: reportNumber || `IR-${Date.now()}`,
        inspectionType: inspectionType || 'FAT',
        location: location || '',
        startDate: new Date(startDate || Date.now()),
        endDate: endDate ? new Date(endDate) : undefined,
        previousVisitDate: previousVisitDate ? new Date(previousVisitDate) : undefined,
        nextVisitDate: nextVisitDate ? new Date(nextVisitDate) : undefined,
        workingHours: workingHours || 8,
        travelHours: travelHours || 0,
        travelDistanceKm: travelDistanceKm || 0,
        inspectorId,
        summaryNarrative,
        disposition,
      },
      include: { project: true },
    });
    res.json(inspection);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE inspection
router.put('/:id', async (req, res) => {
  try {
    const inspection = await prisma.inspection.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(inspection);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Inspection Items ----
router.post('/items', async (req, res) => {
  try {
    const item = await prisma.inspectionItem.create({ data: req.body });
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/items/:id', async (req, res) => {
  try {
    const item = await prisma.inspectionItem.update({ where: { id: req.params.id }, data: req.body });
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/items/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await prisma.photo.updateMany({
      where: { itemId: id },
      data: { itemId: null },
    });
    await prisma.inspectionResult.deleteMany({
      where: { itemId: id },
    });
    await prisma.inspectionItem.delete({ where: { id } });
    res.json({ success: true, message: 'Item deleted successfully' });
  } catch (err: any) {
    console.error('Delete item error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Batch Delete Items (Delete Selected Materials) ----
router.post('/items/delete-batch', async (req, res) => {
  try {
    const { itemIds } = req.body;
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds array is required' });
    }

    await prisma.photo.updateMany({
      where: { itemId: { in: itemIds } },
      data: { itemId: null },
    });
    await prisma.inspectionResult.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    const result = await prisma.inspectionItem.deleteMany({
      where: { id: { in: itemIds } },
    });

    res.json({
      success: true,
      message: `Successfully deleted ${result.count} selected material(s).`,
      count: result.count,
    });
  } catch (err: any) {
    console.error('Batch delete items error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Inspection Activities ----
router.post('/activities', async (req, res) => {
  try {
    const activity = await prisma.inspectionActivity.create({ data: req.body });
    res.json(activity);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/activities/:id', async (req, res) => {
  try {
    const activity = await prisma.inspectionActivity.update({ where: { id: req.params.id }, data: req.body });
    res.json(activity);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/activities/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await prisma.photo.updateMany({
      where: { activityId: id },
      data: { activityId: null },
    });
    await prisma.inspectionResult.deleteMany({
      where: { activityId: id },
    });
    await prisma.inspectionActivity.delete({ where: { id } });
    res.json({ success: true, message: 'Activity deleted successfully' });
  } catch (err: any) {
    console.error('Delete activity error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Attendees ----
router.post('/attendees', async (req, res) => {
  try {
    const attendee = await prisma.attendee.create({ data: req.body });
    res.json(attendee);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/attendees/:id', async (req, res) => {
  try {
    await prisma.attendee.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Attendee deleted successfully' });
  } catch (err: any) {
    console.error('Delete attendee error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Observations ----
router.post('/observations', async (req, res) => {
  try {
    const obs = await prisma.observation.create({ data: req.body });
    res.json(obs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/observations/:id', async (req, res) => {
  try {
    await prisma.observation.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Observation deleted successfully' });
  } catch (err: any) {
    console.error('Delete observation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- AUTOMATIC IMPORT FROM RFI ----
router.post('/:id/import-rfi', async (req, res) => {
  try {
    const { documentId } = req.body;
    const inspectionId = req.params.id;

    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: { items: true, activities: true },
    });
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { extractions: true },
    });
    if (!document) return res.status(404).json({ error: 'Document not found' });

    // Always process with latest parser to guarantee fresh, clean extraction
    const docSvc = new DocumentService();
    const result = await docSvc.processDocument(document.id, path.resolve(document.storageKey), 'RFI');
    const extractedData = result.extractedData;

    let itemsAdded = 0;
    let activitiesAdded = 0;

    // 1. Add Items (strictly from RFI)
    if (extractedData.items && Array.isArray(extractedData.items)) {
      // Remove any previously existing items that do not belong to this RFI
      const validTags = new Set(extractedData.items.map((i: any) => i.tagNumber));
      const invalidItems = (inspection.items || []).filter(i => !validTags.has(i.tagNumber));
      if (invalidItems.length > 0) {
        const invalidItemIds = invalidItems.map(i => i.id);
        await prisma.photo.updateMany({
          where: { itemId: { in: invalidItemIds } },
          data: { itemId: null },
        });
        await prisma.inspectionResult.deleteMany({
          where: { itemId: { in: invalidItemIds } },
        });
        await prisma.inspectionItem.deleteMany({
          where: { id: { in: invalidItemIds } },
        });
      }

      for (const item of extractedData.items) {
        const existing = inspection.items.find(i => i.tagNumber === item.tagNumber || (item.serialNumber && i.serialNumber === item.serialNumber));
        if (!existing) {
          await prisma.inspectionItem.create({
            data: {
              inspectionId,
              poItemNo: item.poItemNo || "'1",
              tagNumber: item.tagNumber,
              serialNumber: item.serialNumber || '',
              jobNo: item.jobNo || '',
              itemName: item.itemName || 'Control Valve',
              sizeInch: item.sizeInch || "24''",
              rating: item.rating || 'ASME #600 RF',
              bodyMaterial: item.bodyMaterial || 'Gr WCC',
              valveSeries: item.valveSeries || '',
              orderedQty: item.orderedQty || 1,
              presentedQty: item.presentedQty || 1,
              acceptedThisVisit: item.acceptedThisVisit || 1,
              acceptedToDate: item.acceptedToDate || 1,
            },
          });
          itemsAdded++;
        }
      }
    }

    // 2. Add Activities
    if (extractedData.activities && Array.isArray(extractedData.activities)) {
      for (const act of extractedData.activities) {
        const clause = act.clauseNumber || act.clause || '';
        const name = act.activityName || act.desc || act.name || '';
        if (!clause) continue;

        const existing = inspection.activities.find(a => a.clauseNumber === clause);
        if (!existing) {
          await prisma.inspectionActivity.create({
            data: {
              inspectionId,
              clauseNumber: clause,
              activityName: name,
              acceptanceCriteria: act.acceptanceCriteria || 'Conform to approved ITP & project specifications',
              interventionTPIA: act.interventionTPIA || 'W',
              status: 'PENDING',
            },
          });
          activitiesAdded++;
        }
      }
    }

    // Link RFI document and update Inspection metadata
    await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        rfiDocumentId: document.id,
        location: extractedData.inspectionLocation || inspection.location,
        ...(extractedData.itpReference && { itpNumber: extractedData.itpReference }),
        ...(extractedData.materialDescription && { materialDescription: extractedData.materialDescription }),
      },
    });

    // Update parent Project details from RFI
    if (extractedData.projectName || extractedData.projectNumber || extractedData.poNumber) {
      try {
        await prisma.project.update({
          where: { id: inspection.projectId },
          data: {
            ...(extractedData.projectName && { projectName: extractedData.projectName }),
            ...(extractedData.projectNumber && { projectNumber: extractedData.projectNumber }),
            ...(extractedData.poNumber && { poNumber: extractedData.poNumber }),
          },
        });
      } catch (e) {
        console.warn('Could not update project details:', e);
      }
    }

    const updated = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        project: true,
        items: true,
        activities: true,
        results: { include: { item: true, activity: true } },
        attendees: true,
        photos: true,
      },
    });

    res.json({
      success: true,
      message: `Successfully imported ${activitiesAdded} activities and ${itemsAdded} items from RFI.`,
      itemsAdded,
      activitiesAdded,
      inspection: updated,
    });
  } catch (err: any) {
    console.error('Import RFI error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- AUTOMATIC IMPORT FROM ITP ----
router.post('/:id/import-itp', async (req, res) => {
  try {
    const { documentId } = req.body;
    const inspectionId = req.params.id;

    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: { activities: true },
    });
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { extractions: true },
    });
    if (!document) return res.status(404).json({ error: 'ITP Document not found' });

    let extractedData: any = {};
    if (document.extractions && document.extractions.length > 0) {
      try {
        extractedData = JSON.parse(document.extractions[0].extractedData);
      } catch {
        extractedData = {};
      }
    }

    if (!extractedData.clauses || extractedData.clauses.length === 0) {
      const docSvc = new DocumentService();
      const result = await docSvc.processDocument(document.id, path.resolve(document.storageKey), 'ITP');
      extractedData = result.extractedData;
    }

    let activitiesAdded = 0;
    const clauses = extractedData.clauses || extractedData.activities || [];
    if (Array.isArray(clauses)) {
      for (const c of clauses) {
        const clauseNum = c.clauseNumber || c.clause || '';
        const name = c.activityDescription || c.activityName || c.name || '';
        if (!clauseNum) continue;

        const existing = inspection.activities.find(a => a.clauseNumber === clauseNum);
        if (!existing) {
          await prisma.inspectionActivity.create({
            data: {
              inspectionId,
              clauseNumber: clauseNum,
              activityName: name || `Clause ${clauseNum}`,
              acceptanceCriteria: c.acceptanceCriteria || 'Conform to approved ITP & project specifications',
              interventionTPIA: c.interventionTPIA || 'W',
              status: 'PENDING',
            },
          });
          activitiesAdded++;
        }
      }
    }

    // Link ITP document and update itpNumber
    await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        itpDocumentId: document.id,
        ...(extractedData.itpNumber && { itpNumber: extractedData.itpNumber }),
      },
    });

    const updated = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        activities: true,
        itpDocument: true,
      },
    });

    res.json({
      success: true,
      message: `Successfully imported ${activitiesAdded} activities from ITP.`,
      activitiesAdded,
      itpNumber: extractedData.itpNumber || inspection.itpNumber,
      inspection: updated,
    });
  } catch (err: any) {
    console.error('Import ITP error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- RECALL MATERIALS & DATA FROM RFI ----
router.post('/:id/recall-rfi', async (req, res) => {
  try {
    const inspectionId = req.params.id;
    const { documentId, clearFirst } = req.body;

    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: { items: true, rfiDocument: { include: { extractions: true } } },
    });
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });

    const targetDocId = documentId || inspection.rfiDocumentId;
    if (!targetDocId) {
      return res.status(400).json({ error: 'No RFI document is linked to this inspection. Please upload or link an RFI first.' });
    }

    const document = await prisma.document.findUnique({
      where: { id: targetDocId },
      include: { extractions: true },
    });
    if (!document) return res.status(404).json({ error: 'RFI Document not found' });

    // Always re-process with latest parser to guarantee fresh, clean extraction
    const docSvc = new DocumentService();
    const result = await docSvc.processDocument(document.id, path.resolve(document.storageKey), 'RFI');
    const extractedData = result.extractedData;

    const rfiItems = extractedData.items || [];
    if (!Array.isArray(rfiItems) || rfiItems.length === 0) {
      return res.status(400).json({ error: 'No materials or equipment items found in this RFI.' });
    }

    // Clean up any items that do not exist in the RFI (e.g. previously mis-parsed tags)
    // to strictly enforce: "Only consider materials from RFI"
    const validTags = new Set(rfiItems.map((i: any) => i.tagNumber));
    const invalidItems = (inspection.items || []).filter(i => !validTags.has(i.tagNumber));
    if (invalidItems.length > 0 || clearFirst) {
      const targetItems = clearFirst ? inspection.items : invalidItems;
      const targetIds = targetItems.map(i => i.id);
      if (targetIds.length > 0) {
        await prisma.photo.updateMany({
          where: { itemId: { in: targetIds } },
          data: { itemId: null },
        });
        await prisma.inspectionResult.deleteMany({
          where: { itemId: { in: targetIds } },
        });
        await prisma.inspectionItem.deleteMany({
          where: { id: { in: targetIds } },
        });
        if (clearFirst) {
          inspection.items = [];
        } else {
          inspection.items = inspection.items.filter(i => validTags.has(i.tagNumber));
        }
      }
    }

    let recalledCount = 0;
    for (const item of rfiItems) {
      const existing = inspection.items.find(i => i.tagNumber === item.tagNumber || (item.serialNumber && i.serialNumber === item.serialNumber));
      if (existing) {
        await prisma.inspectionItem.update({
          where: { id: existing.id },
          data: {
            poItemNo: item.poItemNo || existing.poItemNo,
            serialNumber: item.serialNumber || existing.serialNumber,
            jobNo: item.jobNo || existing.jobNo,
            itemName: item.itemName || existing.itemName,
            sizeInch: item.sizeInch || existing.sizeInch,
            rating: item.rating || existing.rating,
            bodyMaterial: item.bodyMaterial || existing.bodyMaterial,
            valveSeries: item.valveSeries || existing.valveSeries,
            presentedQty: item.presentedQty || existing.presentedQty || 1,
          },
        });
        recalledCount++;
      } else {
        await prisma.inspectionItem.create({
          data: {
            inspectionId,
            poItemNo: item.poItemNo || "'1",
            tagNumber: item.tagNumber,
            serialNumber: item.serialNumber || '',
            jobNo: item.jobNo || '',
            itemName: item.itemName || 'Control Valve',
            sizeInch: item.sizeInch || "24''",
            rating: item.rating || 'ASME #600 RF',
            bodyMaterial: item.bodyMaterial || 'Gr WCC',
            valveSeries: item.valveSeries || '',
            orderedQty: item.orderedQty || 1,
            presentedQty: item.presentedQty || 1,
            acceptedThisVisit: item.acceptedThisVisit || 1,
            acceptedToDate: item.acceptedToDate || 1,
          },
        });
        recalledCount++;
      }
    }

    // Update inspection metadata from RFI
    await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        rfiDocumentId: document.id,
        ...(extractedData.inspectionLocation && { location: extractedData.inspectionLocation }),
        ...(extractedData.materialDescription && { materialDescription: extractedData.materialDescription }),
        ...(extractedData.itpReference && { itpNumber: extractedData.itpReference }),
      },
    });

    const updated = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: { items: true, rfiDocument: true },
    });

    res.json({
      success: true,
      message: `Successfully recalled ${recalledCount} materials from RFI (${document.originalFilename}).`,
      recalledCount,
      totalItems: updated?.items.length,
      inspection: updated,
    });
  } catch (err: any) {
    console.error('Recall RFI error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- DAILY CHECKLIST BATCH UPDATE ----
router.post('/:id/daily-checklist', async (req, res) => {
  try {
    const inspectionId = req.params.id;
    const { entries } = req.body; // Array of { activityId, isDone, testDate, status, remarks, testMedium, testPressure, holdingTimeMin, leakageObserved }

    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: 'entries must be an array' });
    }

    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: { items: true, activities: true, results: true },
    });
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });

    const defaultItem = inspection.items[0];

    for (const entry of entries) {
      const { activityId, isDone, testDate, status, remarks, testMedium, testPressure, pressureUnit, holdingTimeMin, leakageObserved } = entry;
      if (!activityId) continue;

      if (isDone) {
        // Mark activity status
        const finalStatus = status || 'ACCEPTABLE';
        await prisma.inspectionActivity.update({
          where: { id: activityId },
          data: { status: finalStatus },
        });

        // Find or create result
        const existingResult = inspection.results.find(r => r.activityId === activityId);
        if (existingResult) {
          await prisma.inspectionResult.update({
            where: { id: existingResult.id },
            data: {
              status: finalStatus,
              testDate: testDate ? new Date(testDate) : new Date(),
              remarks: remarks || existingResult.remarks,
              testMedium: testMedium || existingResult.testMedium,
              testPressure: testPressure != null ? parseFloat(testPressure) : existingResult.testPressure,
              pressureUnit: pressureUnit || existingResult.pressureUnit || 'kg/cm²',
              holdingTimeMin: holdingTimeMin != null ? parseFloat(holdingTimeMin) : existingResult.holdingTimeMin,
              leakageObserved: leakageObserved || existingResult.leakageObserved,
              confirmedByUser: true,
            },
          });
        } else if (defaultItem) {
          await prisma.inspectionResult.create({
            data: {
              inspectionId,
              activityId,
              itemId: defaultItem.id,
              status: finalStatus,
              testDate: testDate ? new Date(testDate) : new Date(),
              remarks: remarks || undefined,
              testMedium: testMedium || undefined,
              testPressure: testPressure != null ? parseFloat(testPressure) : undefined,
              pressureUnit: pressureUnit || 'kg/cm²',
              holdingTimeMin: holdingTimeMin != null ? parseFloat(holdingTimeMin) : undefined,
              leakageObserved: leakageObserved || 'None',
              confirmedByUser: true,
              enteredVia: 'WEB_UI_CHECKLIST',
            },
          });
        }
      } else {
        // Mark activity as pending
        await prisma.inspectionActivity.update({
          where: { id: activityId },
          data: { status: 'PENDING' },
        });

        // Remove existing result
        const existingResult = inspection.results.find(r => r.activityId === activityId);
        if (existingResult) {
          await prisma.inspectionResult.delete({ where: { id: existingResult.id } });
        }
      }
    }

    const updated = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        project: true,
        items: true,
        activities: true,
        results: { include: { item: true, activity: true } },
        attendees: true,
        photos: true,
        instruments: true,
      },
    });

    res.json({ success: true, inspection: updated });
  } catch (err: any) {
    console.error('Daily checklist error:', err);
    res.status(500).json({ error: err.message });
  }
});

// AUTO-POPULATE standard vendor instruments (Section 5.0)
router.post('/:id/auto-instruments', async (req, res) => {
  try {
    const inspectionId = req.params.id;
    const inspection = await prisma.inspection.findUnique({ where: { id: inspectionId } });
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });

    const standardTools = [
      { instrumentName: 'Stop Watch', serialNumber: 'MQC599', certificateNo: 'SLT/26/02/415/008', expiryDate: new Date('2027-02-27') },
      { instrumentName: 'FE Testing machine', serialNumber: 'FC25004354', certificateNo: 'SLT/26/02/415/009', expiryDate: new Date('2027-02-27') },
      { instrumentName: 'Measuring Tape', serialNumber: 'M509', certificateNo: 'SLT/26/02/415/010', expiryDate: new Date('2027-02-27') },
      { instrumentName: 'Vernier Caliper', serialNumber: 'VC102', certificateNo: 'SLT/26/02/415/011', expiryDate: new Date('2027-02-27') },
      { instrumentName: 'Pressure Gauge', serialNumber: 'PG7701', certificateNo: 'SLT/26/02/415/012', expiryDate: new Date('2027-02-27') },
    ];

    for (const tool of standardTools) {
      await prisma.instrument.create({
        data: {
          inspectionId,
          projectId: inspection.projectId,
          instrumentName: tool.instrumentName,
          serialNumber: tool.serialNumber,
          certificateNo: tool.certificateNo,
          expiryDate: tool.expiryDate,
        },
      });
    }

    const updated = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        project: true,
        items: true,
        activities: true,
        results: { include: { item: true, activity: true } },
        attendees: true,
        photos: true,
        observations: true,
        instruments: true,
      },
    });

    res.json({ success: true, inspection: updated });
  } catch (err: any) {
    console.error('Auto instruments error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- PARSE CUSTOMER OFFER LIST / LETTER ----
router.post('/:id/parse-offer-list', upload.single('file'), async (req, res) => {
  try {
    const inspectionId = req.params.id;
    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: { items: true, activities: true, project: true },
    });
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });

    let rawText = '';
    let documentId = req.body.documentId;

    const docService = new DocumentService();

    if (req.file) {
      // User uploaded a new offer list file
      const doc = await prisma.document.create({
        data: {
          projectId: inspection.projectId,
          documentType: 'OFFER_LIST',
          title: req.file.originalname,
          originalFilename: req.file.originalname,
          storageKey: req.file.path,
          mimeType: req.file.mimetype,
          fileSizeBytes: req.file.size,
        },
      });
      documentId = doc.id;
      const extracted = await docService.extractTextFromFile(req.file.path);
      rawText = extracted.rawText;
    } else if (documentId) {
      // User picked an existing document
      const doc = await prisma.document.findUnique({ where: { id: documentId } });
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      const extracted = await docService.extractTextFromFile(path.resolve(doc.storageKey));
      rawText = extracted.rawText;
    } else if (req.body.offerText) {
      // User pasted text directly
      rawText = String(req.body.offerText);
    } else {
      return res.status(400).json({ error: 'Please upload a file, select a document, or paste the offer text.' });
    }

    const parseResult = docService.parseOfferList(rawText, inspection.items, inspection.activities);

    res.json({
      success: true,
      documentId,
      ...parseResult,
      rawTextSnippet: rawText.substring(0, 1500),
    });
  } catch (err: any) {
    console.error('Parse offer list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- APPLY OFFER LIST (AUTO-SELECT ITEMS & ACTIVITIES) ----
router.post('/:id/apply-offer-list', async (req, res) => {
  try {
    const inspectionId = req.params.id;
    const {
      documentId,
      offerReference,
      selectedItemIds, // array of item IDs to mark offered (presentedQty: 1)
      selectedActivityIds, // array of activity IDs to mark active/offered
      newItems, // optional array of new items to add: [{ tagNumber, itemName, poItemNo, serialNumber }]
      newActivities, // optional array of new activities: [{ clauseNumber, activityName, acceptanceCriteria }]
    } = req.body;

    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: { items: true, activities: true },
    });
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });

    // 1. Update Existing Items: Auto-select offered vs omitted
    let offeredItemCount = 0;
    let omittedItemCount = 0;

    if (Array.isArray(selectedItemIds)) {
      const selectedSet = new Set(selectedItemIds);
      for (const item of inspection.items) {
        const isOffered = selectedSet.has(item.id);
        const newQty = isOffered ? 1 : 0;
        if (item.presentedQty !== newQty) {
          await prisma.inspectionItem.update({
            where: { id: item.id },
            data: { presentedQty: newQty },
          });
        }
        if (isOffered) offeredItemCount++;
        else omittedItemCount++;
      }
    }

    // 1b. Create New Items if specified
    if (Array.isArray(newItems) && newItems.length > 0) {
      for (const ni of newItems) {
        if (!ni.tagNumber) continue;
        const exists = inspection.items.some(i => i.tagNumber === ni.tagNumber);
        if (!exists) {
          await prisma.inspectionItem.create({
            data: {
              inspectionId,
              tagNumber: ni.tagNumber,
              itemName: ni.itemName || 'Control Valve',
              poItemNo: ni.poItemNo || "'1",
              serialNumber: ni.serialNumber || '',
              jobNo: ni.jobNo || '',
              sizeInch: ni.sizeInch || "24''",
              rating: ni.rating || 'ASME #600 RF',
              bodyMaterial: ni.bodyMaterial || 'Gr WCC',
              orderedQty: 1,
              presentedQty: 1,
              acceptedThisVisit: 1,
              acceptedToDate: 1,
            },
          });
          offeredItemCount++;
        }
      }
    }

    // 2. Update Activities: Auto-select offered activities
    let selectedActCount = 0;
    if (Array.isArray(selectedActivityIds)) {
      const actSet = new Set(selectedActivityIds);
      for (const act of inspection.activities) {
        const isSelected = actSet.has(act.id);
        if (isSelected) {
          await prisma.inspectionActivity.update({
            where: { id: act.id },
            data: {
              isMandatoryInRFI: true,
              status: act.status === 'PENDING' ? 'ACCEPTABLE' : act.status,
            },
          });
          selectedActCount++;
        }
      }
    }

    // 2b. Create New Activities if specified
    if (Array.isArray(newActivities) && newActivities.length > 0) {
      for (const na of newActivities) {
        if (!na.clauseNumber) continue;
        const exists = inspection.activities.some(a => a.clauseNumber === na.clauseNumber);
        if (!exists) {
          await prisma.inspectionActivity.create({
            data: {
              inspectionId,
              clauseNumber: na.clauseNumber,
              activityName: na.activityName || `Clause ${na.clauseNumber}`,
              acceptanceCriteria: na.acceptanceCriteria || 'Conform to approved ITP & project specifications',
              interventionTPIA: 'W',
              status: 'ACCEPTABLE',
              isMandatoryInRFI: true,
            },
          });
          selectedActCount++;
        }
      }
    }

    // 3. Update Inspection metadata with offer reference and document link
    await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        ...(documentId && { offerDocumentId: documentId }),
        ...(offerReference && { offerReference }),
      },
    });

    const updated = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        project: true,
        rfiDocument: true,
        itpDocument: true,
        offerDocument: true,
        items: true,
        activities: true,
        results: { include: { item: true, activity: true } },
        attendees: true,
        photos: true,
        observations: true,
        instruments: true,
      },
    });

    res.json({
      success: true,
      message: `Successfully applied customer offer list: ${offeredItemCount} items offered (${omittedItemCount} omitted), ${selectedActCount} activities auto-selected.`,
      offeredItemCount,
      omittedItemCount,
      selectedActCount,
      inspection: updated,
    });
  } catch (err: any) {
    console.error('Apply offer list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE inspection
router.delete('/:id', async (req, res) => {
  try {
    const inspectionId = req.params.id;
    // Unlink photos
    await prisma.photo.updateMany({
      where: { inspectionId },
      data: { itemId: null, activityId: null, resultId: null },
    });
    // Delete inspection (cascade deletes items, activities, results, attendees, observations, photos, instruments)
    await prisma.inspection.delete({ where: { id: inspectionId } });
    res.json({ success: true, message: 'Inspection deleted successfully' });
  } catch (err: any) {
    console.error('Delete inspection error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

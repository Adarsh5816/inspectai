import { Router } from 'express';
import path from 'path';
import prisma from '../db/prisma';
import { DocumentService } from '../services/documentService';

const router = Router();

// GET all inspections (optionally filter by projectId)
router.get('/', async (req, res) => {
  try {
    const where: any = {};
    if (req.query.projectId) where.projectId = req.query.projectId;
    const inspections = await prisma.inspection.findMany({
      where,
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
    const userId = (req as any).userId || (req as any).user?.id;
    // find actual user
    let inspectorId = userId;
    const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (adminUser) inspectorId = adminUser.id;

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

    let extractedData: any = {};
    if (document.extractions && document.extractions.length > 0) {
      try {
        extractedData = JSON.parse(document.extractions[0].extractedData);
      } catch {
        extractedData = {};
      }
    }

    // If items or activities not extracted yet, re-process with latest parser:
    if (!extractedData.items || extractedData.items.length === 0 || !extractedData.activities || extractedData.activities.length === 0) {
      const docSvc = new DocumentService();
      const result = await docSvc.processDocument(document.id, path.resolve(document.storageKey), 'RFI');
      extractedData = result.extractedData;
    }

    let itemsAdded = 0;
    let activitiesAdded = 0;

    // 1. Add Items
    if (extractedData.items && Array.isArray(extractedData.items)) {
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

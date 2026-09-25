import { Router } from 'express';
import prisma from '../db/prisma';

const router = Router();

// Create result
router.post('/', async (req, res) => {
  try {
    const { inspectionId, itemId, activityId, status, testMedium, testPressure, pressureUnit,
      holdingTimeMin, leakageObserved, strokeOpenSec, strokeCloseSec, ambientTempC,
      humidityPercent, luxLevel, remarks, confirmedByUser, enteredVia } = req.body;

    const result = await prisma.inspectionResult.create({
      data: {
        inspectionId, itemId, activityId,
        status: status || 'ACCEPTABLE',
        testMedium: testMedium || undefined,
        testPressure: testPressure != null ? parseFloat(testPressure) : undefined,
        pressureUnit: pressureUnit || undefined,
        holdingTimeMin: holdingTimeMin != null ? parseFloat(holdingTimeMin) : undefined,
        leakageObserved: leakageObserved || undefined,
        strokeOpenSec: strokeOpenSec != null ? parseFloat(strokeOpenSec) : undefined,
        strokeCloseSec: strokeCloseSec != null ? parseFloat(strokeCloseSec) : undefined,
        ambientTempC: ambientTempC != null ? parseFloat(ambientTempC) : undefined,
        humidityPercent: humidityPercent != null ? parseFloat(humidityPercent) : undefined,
        luxLevel: luxLevel != null ? parseFloat(luxLevel) : undefined,
        remarks: remarks || undefined,
        confirmedByUser: confirmedByUser ?? true,
        enteredVia: enteredVia || 'WEB_UI',
      },
      include: { item: true, activity: true },
    });

    // Also update the activity status
    if (activityId && status) {
      await prisma.inspectionActivity.update({
        where: { id: activityId },
        data: { status },
      });
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update result
router.put('/:id', async (req, res) => {
  try {
    const result = await prisma.inspectionResult.update({
      where: { id: req.params.id },
      data: req.body,
      include: { item: true, activity: true },
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get results for an inspection
router.get('/', async (req, res) => {
  try {
    const where: any = {};
    if (req.query.inspectionId) where.inspectionId = String(req.query.inspectionId);
    const results = await prisma.inspectionResult.findMany({
      where,
      include: { item: true, activity: true },
    });
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete result
router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    // Unlink photos referencing this result
    await prisma.photo.updateMany({
      where: { resultId: id },
      data: { resultId: null },
    });
    await prisma.inspectionResult.delete({ where: { id } });
    res.json({ success: true, message: 'Result deleted successfully' });
  } catch (err: any) {
    console.error('Delete result error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

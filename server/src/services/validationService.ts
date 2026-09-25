import prisma from '../db/prisma';

export class ValidationService {
  async validateInspection(inspectionId: string) {
    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        project: true,
        items: true,
        activities: true,
        results: { include: { item: true, activity: true } },
        attendees: true,
        photos: true,
        observations: true,
      },
    });

    if (!inspection) throw new Error('Inspection not found');

    const errors: string[] = [];
    const warnings: string[] = [];

    // VAL-ACT-001: Pending activities
    const pendingActivities = inspection.activities.filter(a => a.status === 'PENDING');
    if (pendingActivities.length > 0) {
      errors.push(`${pendingActivities.length} activities still PENDING: ${pendingActivities.map(a => a.clauseNumber).join(', ')}`);
    }

    // VAL-ACT-002: Witness activities without results
    const witnessActivities = inspection.activities.filter(a => a.interventionTPIA === 'W' || a.interventionTPIA === 'H');
    for (const act of witnessActivities) {
      const hasResult = inspection.results.some(r => r.activityId === act.id);
      if (!hasResult) {
        errors.push(`Witness/Hold activity ${act.clauseNumber} (${act.activityName}) has no recorded result.`);
      }
    }

    // VAL-ACT-003/004: Pressure tests missing medium/pressure
    const pressureClauses = ['6.1', '7.1', '7.2', '7.3'];
    for (const result of inspection.results) {
      const clause = result.activity?.clauseNumber || '';
      if (pressureClauses.some(c => clause.startsWith(c))) {
        if (!result.testMedium) {
          warnings.push(`Result for ${clause} is missing test medium.`);
        }
        if (result.testPressure == null || result.testPressure <= 0) {
          warnings.push(`Result for ${clause} is missing test pressure.`);
        }
      }
    }

    // VAL-ACT-006: Non-acceptable results need remarks
    for (const result of inspection.results) {
      if ((result.status === 'NOT_ACCEPTABLE' || result.status === 'ON_HOLD') && (!result.remarks || result.remarks.length < 5)) {
        errors.push(`Result for ${result.activity?.clauseNumber || 'unknown'} is ${result.status} but lacks a detailed remark/justification.`);
      }
    }

    // Missing items
    if (inspection.items.length === 0) {
      errors.push('No inspection items/equipment have been added.');
    }

    // Missing activities
    if (inspection.activities.length === 0) {
      errors.push('No inspection activities have been defined.');
    }

    // No results at all
    if (inspection.results.length === 0) {
      errors.push('No inspection results have been recorded.');
    }

    // VAL-REP-001: Missing attendees
    if (inspection.attendees.length === 0) {
      warnings.push('No attendees have been recorded.');
    } else if (inspection.attendees.length < 2) {
      warnings.push('Only 1 attendee recorded. Inspections typically require at least 2 (client/TPI + vendor).');
    }

    // VAL-PHT-001: Missing photos
    if (inspection.photos.length === 0) {
      warnings.push('No inspection photos have been uploaded.');
    } else {
      // Check for nameplate photos
      const hasNameplate = inspection.photos.some(p => p.category.toLowerCase().includes('name plate') || p.category.toLowerCase().includes('tag'));
      if (!hasNameplate) {
        warnings.push('No "Name Plate" or "Tag Verification" photo found.');
      }
    }

    // VAL-REP-002: Missing hours/distance
    if (!inspection.workingHours || inspection.workingHours <= 0) {
      warnings.push('Inspection working hours not recorded.');
    }

    // Summary narrative
    if (!inspection.summaryNarrative) {
      warnings.push('Inspection summary narrative is empty.');
    }

    // Disposition
    if (!inspection.disposition) {
      warnings.push('Inspection disposition not set.');
    }

    return {
      inspectionId,
      errors,
      warnings,
      isValidForDraft: true, // Drafts always allowed
      isValidForFinal: errors.length === 0,
      summary: {
        items: inspection.items.length,
        activities: inspection.activities.length,
        results: inspection.results.length,
        attendees: inspection.attendees.length,
        photos: inspection.photos.length,
        pendingActivities: pendingActivities.length,
        errorCount: errors.length,
        warningCount: warnings.length,
      },
    };
  }
}

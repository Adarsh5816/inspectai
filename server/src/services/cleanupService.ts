import fs from 'fs';
import path from 'path';
import prisma from '../db/prisma';

export class CleanupService {
  private static intervalTimer: NodeJS.Timeout | null = null;

  /**
   * Run cleanup of expired ephemeral inspections (retaining files for 5 days after export)
   */
  public static async runCleanup(): Promise<{ purgedCount: number; freedBytes: number }> {
    try {
      const now = new Date();
      const expiredInspections = await prisma.inspection.findMany({
        where: {
          isPurged: false,
          retentionExpiryDate: {
            lte: now,
          },
        },
        include: {
          photos: true,
          documents: true,
          reports: true,
        },
      });

      if (expiredInspections.length === 0) {
        return { purgedCount: 0, freedBytes: 0 };
      }

      console.log(`[CleanupService] Found ${expiredInspections.length} expired inspections to purge.`);
      let totalFreedBytes = 0;

      for (const insp of expiredInspections) {
        try {
          // 1. Delete generated report files from disk
          for (const rep of insp.reports) {
            if (rep.docxStorageKey && fs.existsSync(rep.docxStorageKey)) {
              try {
                totalFreedBytes += fs.statSync(rep.docxStorageKey).size;
                fs.unlinkSync(rep.docxStorageKey);
              } catch {}
            }
            if (rep.pdfStorageKey && fs.existsSync(rep.pdfStorageKey)) {
              try {
                totalFreedBytes += fs.statSync(rep.pdfStorageKey).size;
                fs.unlinkSync(rep.pdfStorageKey);
              } catch {}
            }
          }

          // 2. Delete photos from disk
          for (const photo of insp.photos) {
            if (photo.storageKey && fs.existsSync(photo.storageKey)) {
              try {
                totalFreedBytes += fs.statSync(photo.storageKey).size;
                fs.unlinkSync(photo.storageKey);
              } catch {}
            }
          }

          // 3. Delete uploaded documents from disk
          for (const doc of insp.documents) {
            if (doc.storageKey && fs.existsSync(doc.storageKey)) {
              try {
                totalFreedBytes += fs.statSync(doc.storageKey).size;
                fs.unlinkSync(doc.storageKey);
              } catch {}
            }
          }

          // 4. Mark inspection as purged and clear large payloads
          await prisma.inspection.update({
            where: { id: insp.id },
            data: {
              isPurged: true,
              summaryNarrative: '[PURGED: Expired 5 days after report export to save storage]',
            },
          });

          // Delete nested items, results, photos to free database space
          await prisma.photo.deleteMany({ where: { inspectionId: insp.id } });
          await prisma.inspectionResult.deleteMany({ where: { inspectionId: insp.id } });
          await prisma.inspectionActivity.deleteMany({ where: { inspectionId: insp.id } });
          await prisma.inspectionItem.deleteMany({ where: { inspectionId: insp.id } });
          await prisma.document.deleteMany({ where: { inspectionId: insp.id } });
          await prisma.reportVersion.deleteMany({ where: { inspectionId: insp.id } });

          console.log(`[CleanupService] Successfully purged expired inspection ${insp.reportNumber} (${insp.id}).`);
        } catch (itemErr) {
          console.error(`[CleanupService] Error purging inspection ${insp.id}:`, itemErr);
        }
      }

      console.log(`[CleanupService] Completed: Purged ${expiredInspections.length} inspections. Reclaimed ~${Math.round(totalFreedBytes / 1024)} KB.`);
      return { purgedCount: expiredInspections.length, freedBytes: totalFreedBytes };
    } catch (err) {
      console.error('[CleanupService] Cleanup cycle error:', err);
      return { purgedCount: 0, freedBytes: 0 };
    }
  }

  /**
   * Start recurring hourly background timer
   */
  public static startScheduler(intervalMs = 60 * 60 * 1000): void {
    if (this.intervalTimer) return;
    // Run once on startup after 10s
    setTimeout(() => {
      this.runCleanup().catch(() => {});
    }, 10000);

    // Then periodically
    this.intervalTimer = setInterval(() => {
      this.runCleanup().catch(() => {});
    }, intervalMs);
    console.log('[CleanupService] Auto-cleanup scheduler started (1h intervals).');
  }

  public static stopScheduler(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }
}

import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import prisma from '../db/prisma';

const TEMPLATES_DIR = process.env.TEMPLATES_DIR || path.resolve(__dirname, '../../../templates');
const STORAGE_DIR = process.env.STORAGE_DIR || path.resolve(__dirname, '../../../storage');
const REPORTS_DIR = path.join(STORAGE_DIR, 'reports');

if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface ReportOptions {
  templateName?: string;
  reportDate?: string;
  filterDate?: string;
  onlyCompleted?: boolean;
}

export class ReportService {

  async getTemplates(): Promise<{ name: string; path: string; size: number; type: 'IR' | 'FR'; displayName: string; description?: string }[]> {
    if (!fs.existsSync(TEMPLATES_DIR)) return [];
    const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.docx'));
    const metaPath = path.join(TEMPLATES_DIR, 'templates.json');
    let meta: any[] = [];
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {}
    }

    return files.map(f => {
      const match = meta.find(m => m.name === f);
      const isFR = f.toLowerCase().includes('22sept') || f.toLowerCase().includes('final') || f.toLowerCase().includes('fr');
      const defaultType: 'IR' | 'FR' = isFR ? 'FR' : 'IR';
      return {
        name: f,
        path: path.join(TEMPLATES_DIR, f),
        size: fs.statSync(path.join(TEMPLATES_DIR, f)).size,
        type: match?.type || defaultType,
        displayName: match?.displayName || (f.replace('.docx', '') + (defaultType === 'FR' ? ' (FR)' : ' (IR)')),
        description: match?.description || (defaultType === 'FR' ? 'Final inspection report format' : 'Inspection report format'),
      };
    });
  }

  async updateTemplateCategory(name: string, type: 'IR' | 'FR'): Promise<void> {
    const metaPath = path.join(TEMPLATES_DIR, 'templates.json');
    let meta: any[] = [];
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {}
    }
    const idx = meta.findIndex(m => m.name === name);
    if (idx !== -1) {
      meta[idx].type = type;
    } else {
      meta.push({
        name,
        type,
        displayName: name.replace('.docx', '') + (type === 'FR' ? ' (FR)' : ' (IR)'),
        description: `${type === 'FR' ? 'Final' : 'Inspection'} report format`,
      });
    }
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }

  async uploadTemplate(filePath: string, name: string, type: 'IR' | 'FR' = 'IR'): Promise<string> {
    const dest = path.join(TEMPLATES_DIR, name);
    fs.copyFileSync(filePath, dest);
    await this.updateTemplateCategory(name, type);
    return dest;
  }

  async generateReport(inspectionId: string, templateName?: string, options?: ReportOptions): Promise<string> {
    // 1. Load inspection with ALL related data
    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        project: true,
        inspector: true,
        items: true,
        activities: true,
        results: { include: { item: true, activity: true } },
        attendees: true,
        photos: true,
        observations: true,
        instruments: true,
        rfiDocument: { include: { extractions: true } },
        itpDocument: { include: { extractions: true } },
      },
    });

    if (!inspection) throw new Error('Inspection not found');

    // 2. Load DOCX template
    const tplName = templateName || options?.templateName || 'master-template.docx';
    const tplPath = path.join(TEMPLATES_DIR, tplName);
    if (!fs.existsSync(tplPath)) throw new Error(`Template not found: ${tplName}`);

    const tplBuffer = fs.readFileSync(tplPath);
    const zip = await JSZip.loadAsync(tplBuffer);

    // 3. Parse and modify document.xml
    const docXmlPath = 'word/document.xml';
    let docXml = await zip.file(docXmlPath)!.async('string');

    // Active inspection date
    const activeDate = options?.reportDate ? new Date(options.reportDate) : new Date(inspection.startDate);
    const dateStr = `${String(activeDate.getDate()).padStart(2, '0')}/${String(activeDate.getMonth() + 1).padStart(2, '0')}/${activeDate.getFullYear()}`;
    const dateLong = activeDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    const project = inspection.project!;

    // === 1. METADATA REPLACEMENTS ===
    const replacements: [RegExp | string, string][] = [
      [/ADNOC Onshore/g, escapeXml(project.customerName)],
      [/P\.O\. Box 270, Abu Dhabi, UAE/g, escapeXml(project.customerAddress || 'P.O. Box 270, Abu Dhabi, UAE')],
      [/KSB MIL CONTROLS LIMITED/g, escapeXml(project.supplierName)],
      [/P30339B-RFI-INST-008-ARC-INT-KSB-010\s*9/g, escapeXml(inspection.reportNumber)],
      [/15\s*\/\s*0\s*9\s*\/\s*2026/g, dateStr],
      [/04108-PM-INST-008/g, escapeXml(project.poNumber)],
      [/EPC for SE AiP5 Project \(On plot\) - ASAB\/SAHIL \(Package 1\)/g, escapeXml(project.projectName)],
      [/Meladoor\s*,\s*Annamanada\s*-\s*680741,\s*Kerala,\s*India\./g, escapeXml(inspection.location || project.supplierAddress || '')],
      [/Report No:\s*001/g, `Report No: ${escapeXml(inspection.reportNumber)}`],
      [/15 Sept 2026/g, dateLong],
      [/15\s*\/0\s*9\s*\/2026/g, dateStr],
    ];

    for (const [pattern, replacement] of replacements) {
      docXml = docXml.replace(pattern, replacement);
    }

    // === 2. DYNAMIC ITP & MATERIAL EXTRACTION ===
    let rfiExtracted: any = {};
    if (inspection.rfiDocument?.extractions?.[0]?.extractedData) {
      try {
        rfiExtracted = JSON.parse(inspection.rfiDocument.extractions[0].extractedData);
      } catch {}
    }

    let itpExtracted: any = {};
    if (inspection.itpDocument?.extractions?.[0]?.extractedData) {
      try {
        itpExtracted = JSON.parse(inspection.itpDocument.extractions[0].extractedData);
      } catch {}
    }

    const itpNo = inspection.itpNumber || itpExtracted.itpNumber || rfiExtracted.itpReference || (project as any).itpNumber || 'P30339B-30-99-52-4607';
    const itpRev = inspection.itpRevision || itpExtracted.revision || rfiExtracted.itpRevision || (project as any).itpRevision || 'C';
    let itpFullRef = itpNo;
    if (itpRev && !new RegExp(`Rev\\.?\\s*${itpRev}`, 'i').test(itpNo) && !itpNo.includes(itpRev)) {
      itpFullRef = `${itpNo} Rev ${itpRev}`;
    }

    let materialSummary = inspection.materialDescription || rfiExtracted.materialDescription || 'CONTROL VALVES AND ITS COMPONENTS';
    if (/Certification 3\.2/i.test(materialSummary)) {
      materialSummary = 'CONTROL VALVES AND ITS COMPONENTS';
    }
    const effectiveProjectName = project.projectName || rfiExtracted.projectName || 'EPC for SE AiP5 Project (On plot) - ASAB/SAHIL (Package 1)';

    // === 2.1 PAGE 1 FORM FIELD UPDATES ===
    const offeredItems = (inspection.items || []).filter((i: any) => i.presentedQty > 0 || i.presentedQty === undefined);
    const listToRender = offeredItems.length > 0 ? offeredItems : (inspection.items || []);
    const supplierJobs = listToRender.map((i: any) => i.jobNo).filter(Boolean).join(', ') || 'CD77E001-1';

    docXml = this.setCellValueAfterLabel(docXml, 'Requisition No:', inspection.reportNumber);
    docXml = this.setCellValueAfterLabel(docXml, 'Date of Order:', dateLong);
    docXml = this.setCellValueAfterLabel(docXml, 'Date(s) of Visit(s):', dateStr);
    docXml = this.setCellValueAfterLabel(docXml, 'Date of Previous Visit:', inspection.previousVisitDate ? new Date(inspection.previousVisitDate).toLocaleDateString('en-GB') : 'NA');
    docXml = this.setCellValueAfterLabel(docXml, 'Date of Next Scheduled Visit:', inspection.nextVisitDate ? new Date(inspection.nextVisitDate).toLocaleDateString('en-GB') : '16/09/2026');
    docXml = this.setCellValueAfterLabel(docXml, 'Supplier Job No:', supplierJobs);
    docXml = this.setCellValueAfterLabel(docXml, 'Project Name:', effectiveProjectName);

    // Populate Supplier and Location cleanly
    const supplierFull = [project.supplierName, project.supplierAddress].filter(Boolean).join('\n') || project.supplierName || 'KSB MIL Controls Limited';
    docXml = this.setCellValueAfterLabel(docXml, 'Supplier:', supplierFull);
    docXml = this.setCellValueAfterLabel(docXml, 'Location:', inspection.location || project.supplierAddress || 'Meladoor, Annamanada, Kerala, India');
    if (project.customerName) {
      docXml = this.setCellValueAfterLabel(docXml, 'Name:', project.customerName);
    }
    if (project.customerAddress) {
      docXml = this.setCellValueAfterLabel(docXml, 'Address:', project.customerAddress);
    }

    // Update Materials/Items Inspected on Page 1 (lives inside the same cell in template)
    const matLabelIdx = docXml.indexOf('Materials/Items Inspected:');
    if (matLabelIdx !== -1) {
      const tcStart = docXml.lastIndexOf('<w:tc', matLabelIdx);
      const tcEnd = docXml.indexOf('</w:tc>', matLabelIdx) + 7;
      if (tcStart !== -1 && tcEnd !== -1 && tcEnd > tcStart) {
        const cellXml = docXml.substring(tcStart, tcEnd);
        const p1Start = cellXml.indexOf('<w:p');
        const p1End = cellXml.indexOf('</w:p>', p1Start) + 6;
        if (p1Start !== -1 && p1End !== -1) {
          const newMaterialP = `<w:p><w:pPr><w:contextualSpacing/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${escapeXml(materialSummary)}</w:t></w:r></w:p>`;
          const updatedCell = cellXml.substring(0, p1End) + newMaterialP + '</w:tc>';
          docXml = docXml.substring(0, tcStart) + updatedCell + docXml.substring(tcEnd);
        }
      }
    }
    docXml = this.setCellValueAfterLabel(docXml, 'RECOMMENDED ACTION:', inspection.recommendedAction || 'NA');

    // Yellow highlights: Inspector Name & Signature Date
    const inspectorName = inspection.inspector?.fullName || 'Inspection Engineer';
    docXml = docXml.replace(/<w:highlight w:val="yellow"\/>\s*<w:t>XXXXXXX<\/w:t>/g, `<w:t>${escapeXml(inspectorName)}</w:t>`);
    docXml = docXml.replace(/<w:t>XXXXXXX<\/w:t>/g, `<w:t>${escapeXml(inspectorName)}</w:t>`);
    docXml = docXml.replace(/<w:highlight w:val="yellow"\/>\s*<w:t>XXXXXXXX<\/w:t>/g, `<w:t>${escapeXml(dateLong)}</w:t>`);
    docXml = docXml.replace(/<w:t>XXXXXXXX<\/w:t>/g, `<w:t>${escapeXml(dateLong)}</w:t>`);

    // === 2.2 SUMMARY NARRATIVE (Page 1) ===
    // Cleanly replace Row 2 containing the summary text and conclusion to avoid fragmented template leftover text
    const summaryHeaderIdx = docXml.indexOf('INSPECTION SUMMARY AND CONCLUSION:');
    if (summaryHeaderIdx !== -1) {
      const row1End = docXml.indexOf('</w:tr>', summaryHeaderIdx) + 7;
      const row2Start = docXml.indexOf('<w:tr', row1End);
      const row2End = docXml.indexOf('</w:tr>', row2Start) + 7;
      if (row2Start !== -1 && row2End !== -1 && row2End > row2Start) {
        let summaryBody = '';
        if (inspection.summaryNarrative && inspection.summaryNarrative.trim().length > 15) {
          summaryBody = inspection.summaryNarrative.replace(/\s*Result\s*:\s*(Acceptable|Nonconformance|Hold)[^\r\n]*/gi, '').trim();
        } else {
          const clausesList = (inspection.activities || [])
            .filter((a: any) => a.status === 'ACCEPTABLE' || a.status === 'NOT_ACCEPTABLE')
            .map((a: any) => a.clauseNumber).filter(Boolean).join(', ');
          summaryBody = `The inspection was conducted in accordance with ITP No. ${itpFullRef}, covering the inspection of ${materialSummary}. All inspection activities were carried out as per ITP Clause Nos ${clausesList || '7.3, 7.4(a), 7.5(b), 7.6(c), 7.7(d), 7.8(e), 7.9(e), 7.10(f), 7.12'}.`;
        }

        const disp = inspection.disposition || 'Acceptable';
        const newSummaryRow = `<w:tr w:rsidR="00844A3C" w:rsidRPr="007863FA" w:rsidTr="00ED04AD">
  <w:trPr><w:trHeight w:val="1153"/><w:jc w:val="center"/></w:trPr>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="10926" w:type="dxa"/>
      <w:gridSpan w:val="24"/>
      <w:tcBorders>
        <w:left w:val="single" w:sz="18" w:space="0" w:color="auto"/>
        <w:right w:val="single" w:sz="18" w:space="0" w:color="auto"/>
        <w:bottom w:val="single" w:sz="18" w:space="0" w:color="auto"/>
      </w:tcBorders>
      <w:vAlign w:val="center"/>
    </w:tcPr>
    <w:p>
      <w:pPr>
        <w:spacing w:line="360" w:lineRule="auto"/>
        <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="19"/></w:rPr>
      </w:pPr>
      <w:r>
        <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="19"/></w:rPr>
        <w:t>${escapeXml(summaryBody)}</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:spacing w:line="360" w:lineRule="auto"/>
        <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="19"/></w:rPr>
      </w:pPr>
      <w:r>
        <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="19"/></w:rPr>
        <w:t>Result: ${escapeXml(disp)}</w:t>
      </w:r>
    </w:p>
  </w:tc>
</w:tr>`;
        docXml = docXml.substring(0, row2Start) + newSummaryRow + docXml.substring(row2End);
      }
    }

    // === 2.4 GENERIC MATERIALS TABLE (Table 6) ===
    // Wipe old template sample generic materials and populate ONLY offered items
    const gmHeaderIdx = docXml.indexOf('TAG / EQPT NO.');
    if (gmHeaderIdx !== -1) {
      const headerTrEnd = docXml.indexOf('</w:tr>', gmHeaderIdx) + 7;
      const innerTblEnd = docXml.indexOf('</w:tbl>', headerTrEnd);
      if (headerTrEnd !== -1 && innerTblEnd !== -1 && innerTblEnd > headerTrEnd) {
        const gmRows = this.buildGenericMaterialRowsXml(inspection.items || []);
        docXml = docXml.substring(0, headerTrEnd) + gmRows + docXml.substring(innerTblEnd);
      }
    }

    // === 2.5 MATERIALS / EQUIPMENT INSPECTED TABLE (Table 7) ===
    // Wipe old template sample materials and populate ONLY offered inspection items
    const matHeaderIdx = docXml.indexOf('PRODUCT / MATERIAL');
    if (matHeaderIdx !== -1) {
      const headerTrEnd = docXml.indexOf('</w:tr>', matHeaderIdx) + 7;
      const innerTableEnd = docXml.indexOf('</w:tbl>', headerTrEnd);
      if (headerTrEnd !== -1 && innerTableEnd !== -1 && innerTableEnd > headerTrEnd) {
        const materialRows = this.buildMaterialRowsXml(inspection.items || []);
        docXml = docXml.substring(0, headerTrEnd) + materialRows + docXml.substring(innerTableEnd);
      }
    }

    // === 3. FILTER ATTENDED ACTIVITIES ONLY ===
    // Only include activities that were actually DONE/attended (Acceptable, Not Acceptable, or with results)
    const attendedActivities = (inspection.activities || []).filter((act: any) => {
      const result = inspection.results?.find((r: any) => r.activityId === act.id);
      return act.status === 'ACCEPTABLE' || act.status === 'NOT_ACCEPTABLE' || (result && result.status !== 'PENDING');
    });

    // === 4. DYNAMIC SCOPE OF INSPECTION TABLE (Table 9) ===
    const itpHeaderIdx = docXml.indexOf('ITP LINE NO.');
    if (itpHeaderIdx !== -1) {
      const headerTrEnd = docXml.indexOf('</w:tr>', itpHeaderIdx) + 7;
      const innerTableEnd = docXml.indexOf('</w:tbl>', headerTrEnd);
      if (headerTrEnd !== -1 && innerTableEnd !== -1 && innerTableEnd > headerTrEnd) {
        const dynamicRows = this.buildScopeRowsXml(inspection, attendedActivities);
        docXml = docXml.substring(0, headerTrEnd) + dynamicRows + docXml.substring(innerTableEnd);
      }
    }

    // === 5. EQUIPMENT AND INSTRUMENTATION (Table 10) ===
    const eqIdx = docXml.indexOf('EQUIPMENT AND INSTRUMENTATION');
    if (eqIdx !== -1) {
      // Must end before INSPECTION DETAILS so Section 6.0 is never erased!
      const nextH = docXml.indexOf('INSPECTION DETAILS', eqIdx);
      if (nextH !== -1) {
        const tblStart = docXml.indexOf('<w:tbl', eqIdx);
        const tblEnd = docXml.lastIndexOf('</w:tbl>', nextH) + 8;
        if (tblStart !== -1 && tblEnd > tblStart) {
          const equipmentTableXml = this.buildEquipmentTableXml(inspection.instruments || []);
          docXml = docXml.substring(0, tblStart) + equipmentTableXml + docXml.substring(tblEnd);
        }
      }
    }

    // === 5.5 INSPECTION DETAILS (Section 6.0) ===
    const inspDetIdx = docXml.indexOf('INSPECTION DETAILS');
    if (inspDetIdx !== -1) {
      const tblStart = docXml.indexOf('<w:tbl', inspDetIdx);
      if (tblStart !== -1) {
        const tcStart = docXml.indexOf('<w:tc', tblStart);
        const tcPrEnd = docXml.indexOf('</w:tcPr>', tcStart) + 9;
        const tcEnd = docXml.indexOf('</w:tc>', tcPrEnd);
        if (tcPrEnd !== -1 && tcEnd !== -1 && tcEnd > tcPrEnd) {
          const detailsXml = this.buildInspectionDetailsXml(inspection, project, attendedActivities, dateLong, dateStr, itpFullRef);
          docXml = docXml.substring(0, tcPrEnd) + detailsXml + docXml.substring(tcEnd);
        }
      }
    }

    // === 6. DOCUMENTS USED (Table 8) ===
    // Clean old documents and replace with actual RFI & ITP
    const docIdx = docXml.indexOf('DOCUMENTS USED');
    if (docIdx !== -1) {
      const nextH = docXml.indexOf('SCOPE OF INSPECTION', docIdx);
      if (nextH !== -1) {
        const tblStart = docXml.indexOf('<w:tbl', docIdx);
        const tblEnd = docXml.lastIndexOf('</w:tbl>', nextH) + 8;
        if (tblStart !== -1 && tblEnd > tblStart) {
          const cleanDocsTable = this.buildDocumentsTableXml(inspection, project, itpNo, itpRev);
          docXml = docXml.substring(0, tblStart) + cleanDocsTable + docXml.substring(tblEnd);
        }
      }
    }

    // === 7. ATTENDEES TABLE (Table 5) ===
    const attendeeHeaderIdx = docXml.indexOf('COMPANY REPRESENTED');
    if (attendeeHeaderIdx !== -1) {
      const headerTrEnd = docXml.indexOf('</w:tr>', attendeeHeaderIdx) + 7;
      const innerTableEnd = docXml.indexOf('</w:tbl>', headerTrEnd);
      if (headerTrEnd !== -1 && innerTableEnd !== -1 && innerTableEnd > headerTrEnd) {
        const attendeeRows = this.buildAttendeesXml(inspection.attendees || []);
        docXml = docXml.substring(0, headerTrEnd) + attendeeRows + docXml.substring(innerTableEnd);
      }
    }

    // === 8. REPAIR & POPULATE PHOTO SECTION ===
    const photoHeaderIdx = docXml.indexOf('Inspection Photos.');
    if (photoHeaderIdx !== -1) {
      const tblStart = docXml.indexOf('<w:tbl', photoHeaderIdx);
      const sectPrIdx = docXml.indexOf('<w:sectPr', tblStart);
      const tblEnd = sectPrIdx !== -1 ? docXml.lastIndexOf('</w:tbl>', sectPrIdx) + 8 : -1;

      if (tblStart !== -1 && tblEnd > tblStart) {
        const photos = inspection.photos || [];
        if (photos.length === 0) {
          // If no photos uploaded, keep empty (no old sample photos!)
          const emptyPhotoNotice = `<w:p w14:paraId="11111111" w14:textId="77777777"><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:i/><w:color w:val="777777"/><w:sz w:val="20"/></w:rPr><w:t>No photographs attached for this inspection report.</w:t></w:r></w:p>`;
          docXml = docXml.substring(0, tblStart) + emptyPhotoNotice + docXml.substring(tblEnd);
        } else {
          // Build clean photo table with uploaded photos
          const photoTableXml = await this.embedUploadedPhotos(zip, photos);
          docXml = docXml.substring(0, tblStart) + photoTableXml + docXml.substring(tblEnd);
        }
      }
    }

    // Save modified document.xml
    zip.file(docXmlPath, docXml);

    // === 9. UPDATE HEADERS & FOOTERS ===
    await this.updateHeadersAndFooters(zip, inspection, project, dateLong, dateStr);

    // 10. Generate output file
    const outputFilename = `IR-${inspection.reportNumber}-${Date.now()}.docx`;
    const outputPath = path.join(REPORTS_DIR, outputFilename);
    const outputBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    fs.writeFileSync(outputPath, outputBuffer);

    // 11. Archive report version
    try {
      const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
      const versionCount = await prisma.reportVersion.count({ where: { inspectionId } });
      await prisma.reportVersion.create({
        data: {
          inspectionId,
          versionNumber: versionCount + 1,
          docxStorageKey: outputPath,
          snapshotData: JSON.stringify({
            generatedAt: new Date().toISOString(),
            template: tplName,
            items: inspection.items?.length || 0,
            activities: attendedActivities.length,
            photos: inspection.photos?.length || 0,
          }),
          generatedById: adminUser?.id || inspection.inspectorId,
        },
      });
    } catch { /* non-critical */ }

    return outputPath;
  }

  /**
   * Set text value in a cell immediately following a label cell on Page 1
   */
  private setCellValueAfterLabel(docXml: string, label: string, newText: string): string {
    let labelIdx = docXml.indexOf(label);
    if (labelIdx === -1) {
      const cleanLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
      const match = new RegExp(cleanLabel, 'i').exec(docXml);
      if (match) labelIdx = match.index;
      else return docXml;
    }

    const labelTcEnd = docXml.indexOf('</w:tc>', labelIdx);
    if (labelTcEnd === -1) return docXml;

    const valTcStart = docXml.indexOf('<w:tc', labelTcEnd);
    const valTcEnd = docXml.indexOf('</w:tc>', valTcStart);
    if (valTcStart === -1 || valTcEnd === -1) return docXml;

    const valCellXml = docXml.substring(valTcStart, valTcEnd);
    const pStart = valCellXml.indexOf('<w:p');
    const pEnd = valCellXml.lastIndexOf('</w:p>') + 6;
    if (pStart === -1 || pEnd === -1) return docXml;

    const lines = String(newText || '').split(/\r?\n/).filter(l => l.trim().length > 0);
    const paragraphs = lines.length > 0 ? lines.map(line =>
      `<w:p><w:pPr><w:contextualSpacing/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${escapeXml(line)}</w:t></w:r></w:p>`
    ).join('') : `<w:p><w:pPr><w:contextualSpacing/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:t></w:t></w:r></w:p>`;

    const updatedCellXml = valCellXml.substring(0, pStart) + paragraphs + valCellXml.substring(pEnd);
    return docXml.substring(0, valTcStart) + updatedCellXml + docXml.substring(valTcEnd);
  }

  /**
   * Build comprehensive daily engineering inspection narrative for Section 6.0 (INSPECTION DETAILS)
   */
  private buildInspectionDetailsXml(inspection: any, project: any, attendedActivities: any[], dateLong: string, dateStr: string, itpFullRef?: string): string {
    const offeredItems = (inspection.items || []).filter((i: any) => i.presentedQty > 0 || i.presentedQty === undefined);
    const listToRender = offeredItems.length > 0 ? offeredItems : (inspection.items || []);

    const itpNo = itpFullRef || inspection.itpNumber || project.itpNumber || 'P30339B-30-99-52-4607 Rev C';
    const supplierName = project.supplierName || 'KSB MIL Controls Limited';

    // 1. Visit opening header
    const p1 = `<w:p><w:pPr><w:spacing w:before="120" w:after="120"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="20"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="20"/></w:rPr><w:t>Visited ${escapeXml(supplierName)} on ${escapeXml(dateLong)}, the inspection was conducted according to ITP- ${escapeXml(itpNo)}</w:t></w:r></w:p>`;

    // 2. Day header
    const p2 = `<w:p><w:pPr><w:spacing w:before="120" w:after="80"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:u w:val="single"/><w:sz w:val="20"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:u w:val="single"/><w:sz w:val="20"/></w:rPr><w:t>Day 1 (${escapeXml(dateStr)})</w:t></w:r></w:p>`;

    // 3. Valves inspected summary
    const itemsDesc = listToRender.map((item: any, idx: number) => {
      const parts = [`${idx + 1})`];
      if (item.serialNumber) parts.push(`Valve SL No: ${item.serialNumber}`);
      if (item.jobNo) parts.push(`Job No (${item.jobNo})`);
      if (item.tagNumber) parts.push(`Tag No ${item.tagNumber}`);
      return parts.join(' ');
    }).join(', ') || 'Control Valves';

    const p3 = `<w:p><w:pPr><w:spacing w:before="60" w:after="160"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="19"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="19"/></w:rPr><w:t>FAT Conducted for the ${escapeXml(itemsDesc)}</w:t></w:r></w:p>`;

    // 4. Activity paragraphs
    let actParagraphs = '';
    for (const act of attendedActivities) {
      const result = inspection.results?.find((r: any) => r.activityId === act.id);

      // Title line: bold clause & activity
      actParagraphs += `<w:p><w:pPr><w:spacing w:before="120" w:after="60"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="19"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="19"/></w:rPr><w:t>ITP Clause ${escapeXml(act.clauseNumber)} – ${escapeXml(act.activityName)}:</w:t></w:r></w:p>`;

      // Body narrative
      let narrative = '';
      if (act.notes && act.notes.trim().length > 10) {
        narrative = act.notes.trim();
      } else if (result?.remarks && result.remarks.trim().length > 10) {
        narrative = result.remarks.trim();
      } else {
        narrative = this.synthesizeActivityNarrative(act, result);
      }

      actParagraphs += `<w:p><w:pPr><w:spacing w:before="40" w:after="140"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(narrative)}</w:t></w:r></w:p>`;
    }

    if (attendedActivities.length === 0) {
      actParagraphs = `<w:p><w:pPr><w:spacing w:before="100" w:after="100"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:i/><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:i/><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr><w:t>No inspection activities were executed on this visit.</w:t></w:r></w:p>`;
    }

    return p1 + p2 + p3 + actParagraphs;
  }

  /**
   * Synthesize standard technical/engineering narrative for an ITP activity
   */
  private synthesizeActivityNarrative(act: any, result?: any): string {
    const actNameLower = (act.activityName || '').toLowerCase();
    const clause = act.clauseNumber || '';

    if (actNameLower.includes('shell') || actNameLower.includes('body mount') || actNameLower.includes('hydro')) {
      const press = result?.testPressure ? `${result.testPressure} ${result.pressureUnit || 'bar'}` : '285 bar';
      const time = result?.holdingTimeMin ? `${result.holdingTimeMin} minutes` : '15 minutes';
      const medium = result?.testMedium || 'water';
      const leak = result?.leakageObserved || 'No leakage was observed during the test';
      return `Conducted the ${act.activityName} using ${medium} at a test pressure of ${press}, with a holding time of ${time}. ${leak}. The test met the acceptance criteria in accordance with approved test procedure and was found acceptable.`;
    }

    if (actNameLower.includes('seat leakage') || actNameLower.includes('seat leak')) {
      const press = result?.testPressure ? `${result.testPressure} ${result.pressureUnit || 'kg/cm²'}` : '3.5 kg/cm²';
      const leak = result?.leakageObserved || 'No leakage was observed';
      return `Seat leakage test was conducted using ${result?.testMedium || 'water'} as the test medium at ${press}. The acceptance criteria were in accordance with FCI 70-2 and the leakage class specified in the approved data sheet/approved test procedure. ${leak}. The test was found acceptable.`;
    }

    if (actNameLower.includes('actuator') || actNameLower.includes('chamber')) {
      const press = result?.testPressure ? `${result.testPressure} ${result.pressureUnit || 'bar'}` : '118 bar';
      const time = result?.holdingTimeMin ? `${result.holdingTimeMin} minutes` : '10 minutes';
      return `Conducted the actuator chamber strength and leakage test at a test pressure of ${press}, with a holding time of ${time}. The actuator leakage test was also performed by stroking the actuator, and no leakage was observed during the test.`;
    }

    if (actNameLower.includes('stroke') || actNameLower.includes('opening') || actNameLower.includes('closing')) {
      return `Stroke checking and opening/closing time were verified with reference to the approved data sheet and found acceptable.`;
    }

    if (actNameLower.includes('linearity')) {
      return `Linearity was checked with reference to the approved test procedure, AGES-SP-04-002 and IEC 60534-4, and was found acceptable.`;
    }

    if (actNameLower.includes('hysteresis')) {
      return `Hysteresis was checked with reference to the approved test procedure, AGES-SP-04-002 and IEC 60534-4, and was found acceptable.`;
    }

    if (actNameLower.includes('accessories')) {
      return `Accessories were verified with reference to the approved data sheet and found acceptable.`;
    }

    if (actNameLower.includes('failure action') || actNameLower.includes('dead band')) {
      return `The failure action test/dead band test was conducted with reference to the approved test procedure, AGES-SP-04-002 and IEC 60534-4, and was found acceptable.`;
    }

    if (actNameLower.includes('dimension') || actNameLower.includes('nameplate') || actNameLower.includes('name plate') || actNameLower.includes('visual')) {
      return `Overall dimensions, nameplate details, visual inspection, and markings were verified with reference to the approved data sheet and drawings and were found acceptable.`;
    }

    if (actNameLower.includes('fugitive')) {
      return `Fugitive Emission Production Test was conducted using helium gas. No leakage was observed, and the valve met the acceptance criteria.`;
    }

    if (actNameLower.includes('dft') || actNameLower.includes('paint') || actNameLower.includes('surface')) {
      return `Surface preparation and painting DFT were inspected with calibrated gauge. No sagging, contaminations, orange peel, cracking, blistering, rust, damages or any other defects found. Found acceptable.`;
    }

    if (actNameLower.includes('packing')) {
      return `As per approved procedure confirmed all the items and packing done making sure there is proper structural and climate proofing done.`;
    }

    return `${act.activityName} was conducted in accordance with approved ITP clause ${clause} and project specifications. Result: Acceptable.`;
  }

  /**
   * Build Generic Materials table rows (Table 6)
   */
  private buildGenericMaterialRowsXml(items: any[]): string {
    const offeredItems = (items || []).filter((i: any) => i.presentedQty > 0);
    const listToRender = offeredItems.length > 0 ? offeredItems : (items || []);

    if (listToRender.length === 0) {
      return `<w:tr w:rsidR="00BA3CA3">
  <w:trPr><w:cantSplit/><w:trHeight w:val="333"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="10777" w:type="dxa"/><w:gridSpan w:val="2"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr><w:t>No materials or equipment offered for this inspection visit.</w:t></w:r></w:p>
  </w:tc>
</w:tr>`;
    }

    return listToRender.map((item, idx) => {
      const tag = escapeXml(item.tagNumber || `Item-${idx + 1}`);
      const descParts = [
        item.sizeInch,
        item.valveSeries,
        item.rating,
        item.bodyMaterial,
        item.itemName || 'Control Valve'
      ].filter(Boolean);
      const desc = escapeXml(descParts.join(' ') || item.itemDescription || 'Control Valve');

      return `<w:tr w:rsidR="00BA3CA3" w:rsidRPr="007863FA" w14:paraId="60D020C6" w14:textId="77777777" w:rsidTr="003A37F9">
  <w:trPr><w:cantSplit/><w:trHeight w:val="429"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="3185" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="2" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>${tag}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="7592" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="2" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>${desc}</w:t></w:r>
    </w:p>
  </w:tc>
</w:tr>`;
    }).join('\n');
  }

  /**
   * Build Materials Inspected table rows (Table 7)
   */
  private buildMaterialRowsXml(items: any[]): string {
    const offeredItems = (items || []).filter((i: any) => i.presentedQty > 0);
    const listToRender = offeredItems.length > 0 ? offeredItems : (items || []);

    if (listToRender.length === 0) {
      return `<w:tr w:rsidR="00737F9A">
  <w:trPr><w:cantSplit/><w:trHeight w:val="400"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="10766" w:type="dxa"/><w:gridSpan w:val="7"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:i/><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr><w:t>No materials or equipment offered for this inspection visit.</w:t></w:r></w:p>
  </w:tc>
</w:tr>`;
    }

    return listToRender.map((item, idx) => {
      const poItem = escapeXml(item.poItemNo || `'${idx + 1}`);
      const tag = escapeXml(item.tagNumber || `Item-${idx + 1}`);
      const name = escapeXml(item.itemName || item.itemDescription || 'Control Valve');
      const ordQty = item.orderedQty ? String(item.orderedQty) : '';
      const presQty = item.presentedQty ? String(item.presentedQty) : '1';
      const accThis = item.acceptedThisVisit ? String(item.acceptedThisVisit) : presQty;
      const accTotal = item.acceptedToDate ? String(item.acceptedToDate) : accThis;

      return `<w:tr w:rsidR="00737F9A" w14:paraId="3AA9BD4E" w14:textId="77777777" w:rsidTr="00BA3CA3">
  <w:trPr><w:cantSplit/><w:trHeight w:val="450"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="1145" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="2" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${poItem}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1701" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="2" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>${tag}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="2835" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="2" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>${name}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1441" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="2" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${ordQty}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1275" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="2" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${presQty}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1134" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="2" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${accThis}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1269" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${accTotal}</w:t></w:r>
    </w:p>
  </w:tc>
</w:tr>`;
    }).join('\n');
  }

  /**
   * Build Scope of Inspection table rows (ONLY attended activities)
   */
  private buildScopeRowsXml(inspection: any, activities: any[]): string {
    // Only offered items
    const offeredItems = (inspection.items || []).filter((i: any) => i.presentedQty > 0 || i.presentedQty === undefined);
    const itemsStr = escapeXml((offeredItems.length ? offeredItems : inspection.items)?.map((i: any) => i.tagNumber).join(', ') || 'Control Valve');

    if (activities.length === 0) {
      return `<w:tr w:rsidR="00737F9A">
  <w:trPr><w:cantSplit/><w:trHeight w:val="333"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="10777" w:type="dxa"/><w:gridSpan w:val="5"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="666666"/></w:rPr><w:t>No inspection activities were executed on this visit.</w:t></w:r></w:p>
  </w:tc>
</w:tr>`;
    }

    return activities.map((act: any) => {
      const result = inspection.results?.find((r: any) => r.activityId === act.id);
      const actName = act.activityName || '';
      const isPressureOrLeakage = /hydro|pressure|shell|seat|leak|strength|body mount/i.test(actName);
      const isPaintingOrDft = /paint|dft|coating|surface/i.test(actName);

      let resultText = 'Acceptable';
      if (result) {
        if (result.remarks && result.remarks.trim().length > 3) {
          resultText = result.remarks.trim();
        } else if (isPressureOrLeakage) {
          const parts: string[] = [result.status === 'ACCEPTABLE' ? 'Acceptable' : (result.status || 'Acceptable')];
          if (result.testPressure) parts.push(`Pressure: ${result.testPressure} ${result.pressureUnit || 'bar'}`);
          if (result.testMedium) parts.push(`Medium: ${result.testMedium}`);
          if (result.holdingTimeMin) parts.push(`Hold: ${result.holdingTimeMin} min`);
          if (result.leakageObserved) parts.push(`Leakage: ${result.leakageObserved}`);
          resultText = parts.join(' - ');
        } else if (isPaintingOrDft) {
          resultText = 'Acceptable - DFT within limits';
        } else {
          resultText = result.status === 'ACCEPTABLE' || !result.status ? 'Acceptable' : result.status;
        }
      } else if (act.status) {
        if (isPaintingOrDft) {
          resultText = 'Acceptable - DFT within limits';
        } else {
          resultText = act.status === 'ACCEPTABLE' ? 'Acceptable' : act.status;
        }
      }

      const clauseShort = (act.clauseNumber || '').split(' ')[0];

      return `<w:tr w:rsidR="00737F9A">
  <w:trPr><w:cantSplit/><w:trHeight w:val="333"/></w:trPr>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="1006" w:type="dxa"/>
      <w:tcBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      </w:tcBorders>
      <w:vAlign w:val="center"/>
    </w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(act.clauseNumber)}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="2835" w:type="dxa"/>
      <w:tcBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      </w:tcBorders>
      <w:vAlign w:val="center"/>
    </w:tcPr>
    <w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(act.activityName)}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="3119" w:type="dxa"/>
      <w:tcBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      </w:tcBorders>
      <w:vAlign w:val="center"/>
    </w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${itemsStr}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="2670" w:type="dxa"/>
      <w:tcBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      </w:tcBorders>
      <w:vAlign w:val="center"/>
    </w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(resultText)}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="1147" w:type="dxa"/>
      <w:tcBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      </w:tcBorders>
      <w:vAlign w:val="center"/>
    </w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>CLAUSE ${escapeXml(clauseShort)}</w:t></w:r>
    </w:p>
  </w:tc>
</w:tr>`;
    }).join('\n');
  }

  /**
   * Build clean Documents Used table in OpenXML format
   */
  private buildDocumentsTableXml(inspection: any, project: any, itpNo?: string, itpRev?: string): string {
    const itpDoc = itpNo || inspection.itpNumber || (project as any).itpNumber || 'P30339B-30-99-52-4607';
    const effectiveRev = itpRev || inspection.itpRevision || (project as any).itpRevision || 'C';

    const docs = [
      { no: inspection.reportNumber || 'RFI', rev: '0', title: 'Request For Inspection (RFI)' },
      { no: itpDoc, rev: effectiveRev, title: 'INSPECTION AND TEST PLAN FOR CONTROL VALVES' },
      { no: project.poNumber || 'P-AiP5-12-IC15-003', rev: '0', title: 'Contractor Purchase Order' },
      { no: 'P30350-12-99-90-4863', rev: '1', title: 'Control Valve Hydrostatic & Leakage Test Procedure' },
    ];

    const rowsXml = docs.map(d => `<w:tr w:rsidR="00BA788A">
  <w:trPr><w:cantSplit/><w:trHeight w:val="333"/></w:trPr>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="2698" w:type="dxa"/>
      <w:tcBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      </w:tcBorders>
      <w:vAlign w:val="center"/>
    </w:tcPr>
    <w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(d.no)}</w:t></w:r></w:p>
  </w:tc>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="1143" w:type="dxa"/>
      <w:tcBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      </w:tcBorders>
      <w:vAlign w:val="center"/>
    </w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(d.rev)}</w:t></w:r></w:p>
  </w:tc>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="4878" w:type="dxa"/>
      <w:tcBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      </w:tcBorders>
      <w:vAlign w:val="center"/>
    </w:tcPr>
    <w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(d.title)}</w:t></w:r></w:p>
  </w:tc>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="2058" w:type="dxa"/>
      <w:tcBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      </w:tcBorders>
      <w:vAlign w:val="center"/>
    </w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>Approved</w:t></w:r></w:p>
  </w:tc>
</w:tr>`).join('\n');

    return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="10777" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2698"/><w:gridCol w:w="1143"/><w:gridCol w:w="4878"/><w:gridCol w:w="2058"/></w:tblGrid>
<w:tr w:rsidR="00BA788A"><w:trPr><w:tblHeader/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="2698" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>DOCUMENT NO.</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1143" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>REV</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="4878" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>DOCUMENT TITLE</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="2058" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>STATUS</w:t></w:r></w:p></w:tc>
</w:tr>
${rowsXml}
</w:tbl>`;
  }

  /**
   * Build Attendees table rows
   */
  private buildAttendeesXml(attendees: any[]): string {
    const defaultAttendees = [
      { name: 'Karthik C', company: 'Intertek', title: 'Inspection Engineer', representedOrg: 'ADNOC Onshore' },
      { name: 'Nithin V', company: 'KSB MIL', title: 'Quality Assurance', representedOrg: '' },
    ];
    const listToRender = (attendees && attendees.length > 0) ? attendees : defaultAttendees;

    return listToRender.map(a => {
      const orgInfo = a.representedOrg && a.representedOrg.trim() ? ` (OBO ${escapeXml(a.representedOrg.trim())})` : '';
      const compText = `${escapeXml(a.company || '')}${orgInfo}`;

      return `<w:tr w:rsidR="00737F9A">
  <w:trPr><w:cantSplit/><w:trHeight w:val="320"/></w:trPr>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="3119" w:type="dxa"/>
      <w:tcBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      </w:tcBorders>
      <w:vAlign w:val="center"/>
    </w:tcPr>
    <w:p>
      <w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(a.name || '')}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="3898" w:type="dxa"/>
      <w:tcBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      </w:tcBorders>
      <w:vAlign w:val="center"/>
    </w:tcPr>
    <w:p>
      <w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${compText}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="3783" w:type="dxa"/>
      <w:tcBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      </w:tcBorders>
      <w:vAlign w:val="center"/>
    </w:tcPr>
    <w:p>
      <w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(a.title || '')}</w:t></w:r>
    </w:p>
  </w:tc>
</w:tr>`;
    }).join('\n');
  }

  /**
   * Helper to inspect image buffer and determine pixel width and height
   */
  private getImageDimensions(buf: Buffer): { width: number; height: number } {
    try {
      // 1. PNG: 89 50 4E 47 0D 0A 1A 0A
      if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        if (width > 0 && height > 0) return { width, height };
      }

      // 2. JPEG: FF D8
      if (buf.length > 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
        let offset = 2;
        while (offset < buf.length - 8) {
          if (buf[offset] !== 0xFF) {
            offset++;
            continue;
          }
          const marker = buf[offset + 1];
          // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
          if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) || (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
            const height = buf.readUInt16BE(offset + 5);
            const width = buf.readUInt16BE(offset + 7);
            if (width > 0 && height > 0) return { width, height };
          }
          if (offset + 4 > buf.length) break;
          const segmentLength = buf.readUInt16BE(offset + 2);
          if (segmentLength < 2) break;
          offset += 2 + segmentLength;
        }
      }

      // 3. WebP: RIFF ... WEBP
      if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
        const type = buf.toString('ascii', 12, 16);
        if (type === 'VP8X' && buf.length >= 30) {
          const width = 1 + buf.readUIntLE(24, 3);
          const height = 1 + buf.readUIntLE(27, 3);
          if (width > 0 && height > 0) return { width, height };
        } else if (type === 'VP8 ' && buf.length >= 30) {
          const width = buf.readUInt16LE(26) & 0x3fff;
          const height = buf.readUInt16LE(28) & 0x3fff;
          if (width > 0 && height > 0) return { width, height };
        }
      }
    } catch (err) {
      console.error('Error determining image dimensions:', err);
    }

    // Default fallback: landscape 4:3
    return { width: 1600, height: 1200 };
  }

  /**
   * Embed uploaded photos into Word DOCX and build clean 2-column photo table.
   * Keeps natural aspect ratio for landscape without stretching; adjusts portrait photos.
   */
  private async embedUploadedPhotos(zip: JSZip, photos: any[]): Promise<string> {
    // 1. Update relationships
    const relsPath = 'word/_rels/document.xml.rels';
    let relsXml = await zip.file(relsPath)!.async('string');

    const photoCards: { rId: string; caption: string; cx: number; cy: number }[] = [];

    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      try {
        const filePath = path.resolve(p.storageKey);
        if (!fs.existsSync(filePath)) continue;

        const buf = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'jpeg';
        const mediaName = `insp_photo_${i + 1}.${ext}`;
        const rId = `rIdInspPhoto_${i + 1}`;

        // Save image to zip
        zip.file(`word/media/${mediaName}`, buf);

        // Add relationship
        const relEntry = `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/>`;
        relsXml = relsXml.replace('</Relationships>', `${relEntry}</Relationships>`);

        // Compute aspect ratio:
        // Landscape photos: keep width at 2,800,000 EMUs, compute cy naturally so zero stretching occurs.
        // Portrait photos: adjust height to 2,100,000 EMUs so it fits without expanding page vertically.
        const { width, height } = this.getImageDimensions(buf);
        let cx = 2800000;
        let cy = 2100000;

        if (width >= height) {
          // Landscape: preserve exact natural aspect ratio
          cy = Math.round(cx * (height / width));
        } else {
          // Portrait: height needs to be adjusted within cell
          cy = 2100000;
          cx = Math.round(cy * (width / height));
        }

        photoCards.push({
          rId,
          caption: p.caption || p.category || `Inspection Photo ${i + 1}`,
          cx,
          cy,
        });
      } catch { /* skip invalid photo */ }
    }

    zip.file(relsPath, relsXml);

    if (photoCards.length === 0) {
      return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>No photographs attached for this inspection report.</w:t></w:r></w:p>`;
    }

    // 2. Build 2-column table
    let rowsXml = '';
    for (let i = 0; i < photoCards.length; i += 2) {
      const left = photoCards[i];
      const right = photoCards[i + 1];

      // Row of images
      const leftImg = this.buildImageXml(left.rId, i * 2 + 100, left.cx, left.cy);
      const rightImg = right ? this.buildImageXml(right.rId, i * 2 + 101, right.cx, right.cy) : '';

      rowsXml += `<w:tr w:rsidR="00ED010A">
  <w:tc><w:tcPr><w:tcW w:w="5395" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${leftImg}</w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="5395" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${rightImg}</w:r></w:p></w:tc>
</w:tr>`;

      // Row of captions
      rowsXml += `<w:tr w:rsidR="00ED010A">
  <w:tc><w:tcPr><w:tcW w:w="5395" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(left.caption)}</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="5395" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>${right ? escapeXml(right.caption) : ''}</w:t></w:r></w:p></w:tc>
</w:tr>`;
    }

    return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="10790" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="5395"/><w:gridCol w:w="5395"/></w:tblGrid>${rowsXml}</w:tbl>`;
  }

  private buildImageXml(rId: string, docPrId: number, cx: number = 2800000, cy: number = 2100000): string {
    return `<w:drawing>
  <wp:inline distT="0" distB="0" distL="0" distR="0">
    <wp:extent cx="${cx}" cy="${cy}"/>
    <wp:docPr id="${docPrId}" name="Picture ${docPrId}"/>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:nvPicPr>
            <pic:cNvPr id="${docPrId}" name="Picture ${docPrId}"/>
            <pic:cNvPicPr/>
          </pic:nvPicPr>
          <pic:blipFill>
            <a:blip r:embed="${rId}"/>
            <a:stretch><a:fillRect/></a:stretch>
          </pic:blipFill>
          <pic:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing>`;
  }

  /**
   * Build dynamic Equipment and Instrumentation Used table for Section 5.0
   */
  private buildEquipmentTableXml(instruments: any[]): string {
    const listToRender = (instruments && instruments.length > 0) ? instruments : [
      { instrumentName: 'Stop Watch', serialNumber: 'MQC599', certificateNo: 'SLT/26/02/415/008', expiryDate: '2027-02-27' },
      { instrumentName: 'FE Testing machine', serialNumber: 'FC25004354', certificateNo: 'SLT/26/02/415/009', expiryDate: '2027-02-27' },
      { instrumentName: 'Measuring Tape', serialNumber: 'M509', certificateNo: 'SLT/26/02/415/010', expiryDate: '2027-02-27' },
      { instrumentName: 'Vernier Caliper', serialNumber: 'VC102', certificateNo: 'SLT/26/02/415/011', expiryDate: '2027-02-27' },
      { instrumentName: 'Pressure Gauge', serialNumber: 'PG7701', certificateNo: 'SLT/26/02/415/012', expiryDate: '2027-02-27' },
    ];

    const rowsXml = listToRender.map(inst => {
      let expiryFormatted = 'NA';
      if (inst.expiryDate) {
        try {
          const d = new Date(inst.expiryDate);
          if (!isNaN(d.getTime())) {
            expiryFormatted = d.toLocaleDateString('en-GB');
          } else {
            expiryFormatted = String(inst.expiryDate);
          }
        } catch {
          expiryFormatted = String(inst.expiryDate);
        }
      }

      return `<w:tr w:rsidR="00BA788A">
  <w:trPr><w:cantSplit/><w:trHeight w:val="333"/></w:trPr>
  <w:tc>
    <w:tcPr><w:tcW w:w="4281" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(inst.instrumentName)}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc>
    <w:tcPr><w:tcW w:w="1825" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(inst.serialNumber || 'NA')}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc>
    <w:tcPr><w:tcW w:w="2328" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(inst.certificateNo || 'NA')}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc>
    <w:tcPr><w:tcW w:w="2366" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(expiryFormatted)}</w:t></w:r>
    </w:p>
  </w:tc>
</w:tr>`;
    }).join('\n');

    return `<w:tbl>
  <w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="10800" w:type="dxa"/></w:tblPr>
  <w:tblGrid><w:gridCol w:w="4281"/><w:gridCol w:w="1825"/><w:gridCol w:w="2328"/><w:gridCol w:w="2366"/></w:tblGrid>
  <w:tr w:rsidR="00BA788A">
    <w:trPr><w:tblHeader/></w:trPr>
    <w:tc><w:tcPr><w:tcW w:w="4281" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>EQUIPMENT / INSTRUMENT DESCRIPTION</w:t></w:r></w:p></w:tc>
    <w:tc><w:tcPr><w:tcW w:w="1825" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>SERIAL NO</w:t></w:r></w:p></w:tc>
    <w:tc><w:tcPr><w:tcW w:w="2328" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>CALIBRATION CERT. NO.</w:t></w:r></w:p></w:tc>
    <w:tc><w:tcPr><w:tcW w:w="2366" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>EXPIRY DATE</w:t></w:r></w:p></w:tc>
  </w:tr>
  ${rowsXml}
</w:tbl>`;
  }

  /**
   * Update all header and footer files
   */
  private async updateHeadersAndFooters(zip: JSZip, inspection: any, project: any, dateLong: string, dateStr: string) {
    const files = Object.keys(zip.files).filter(f => f.includes('header') || f.includes('footer'));

    for (const file of files) {
      if (!file.endsWith('.xml')) continue;
      try {
        let content = await zip.file(file)!.async('string');

        if (file.includes('header')) {
          content = this.updateHeaderXml(content, {
            reportNumber: inspection.reportNumber || '001',
            reportDate: dateLong,
            customerName: project.customerName || 'ADNOC Onshore',
            jobNo: project.projectNumber || project.jobNo || 'P30350',
          });
        } else if (file.includes('footer')) {
          content = this.updateFooterXml(content, dateStr);
        }

        zip.file(file, content);
      } catch (err) {
        console.error(`Error updating header/footer ${file}:`, err);
      }
    }
  }

  private updateHeaderXml(xml: string, values: { reportNumber: string; reportDate: string; customerName: string; jobNo: string }): string {
    let result = xml;

    function setCellAfter(labelRegex: RegExp, newValue: string) {
      const match = labelRegex.exec(result);
      if (!match) return;
      const labelPos = match.index;
      const labelTcEnd = result.indexOf('</w:tc>', labelPos);
      if (labelTcEnd === -1) return;
      const nextTcStart = result.indexOf('<w:tc', labelTcEnd);
      if (nextTcStart === -1) return;
      const nextTcEnd = result.indexOf('</w:tc>', nextTcStart);
      if (nextTcEnd === -1) return;

      const tcContent = result.substring(nextTcStart, nextTcEnd);
      const tcPrEnd = tcContent.indexOf('</w:tcPr>');
      const tcPr = tcPrEnd !== -1 ? tcContent.substring(0, tcPrEnd + 9) : '<w:tc><w:tcPr/>';

      const newTc = `${tcPr}<w:p><w:pPr><w:spacing w:before="40" w:after="40"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${escapeXml(newValue)}</w:t></w:r></w:p>`;

      result = result.substring(0, nextTcStart) + newTc + result.substring(nextTcEnd);
    }

    setCellAfter(/Report\s*No\s*:/i, values.reportNumber);
    setCellAfter(/Date\s*of\s*Report\s*:/i, values.reportDate);
    setCellAfter(/Customer\s*:/i, values.customerName);
    setCellAfter(/(EVO\s*)?Job\s*No\s*:/i, values.jobNo);

    return result;
  }

  private updateFooterXml(xml: string, footerDate: string): string {
    let result = xml;

    const tcRegex = /<w:tc[\s>][\s\S]*?<\/w:tc>/g;
    result = result.replace(tcRegex, (tcXml) => {
      const text = tcXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      if (text.includes('mm/dd') || (text.includes('Date') && !text.includes('Inspection'))) {
        const paragraphs = tcXml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g);
        if (paragraphs && paragraphs.length >= 2) {
          const tcPrMatch = tcXml.match(/<w:tcPr[\s\S]*?<\/w:tcPr>/);
          const tcPr = tcPrMatch ? tcPrMatch[0] : '';
          const newSecondP = `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="8640"/></w:tabs><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:bCs/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:bCs/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t>${escapeXml(footerDate)}</w:t></w:r></w:p>`;
          return `<w:tc>${tcPr}${paragraphs[0]}${newSecondP}</w:tc>`;
        }
      }
      return tcXml;
    });

    return result;
  }
}

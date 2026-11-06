import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import { XMLValidator } from 'fast-xml-parser';
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
    const tplName = templateName || options?.templateName || (inspection as any).selectedTemplate || 'master-template.docx';
    let tplPath = path.join(TEMPLATES_DIR, tplName);
    if (!fs.existsSync(tplPath)) {
      if (fs.existsSync(path.resolve(tplName))) {
        tplPath = path.resolve(tplName);
      } else {
        // Try normalized filename lookup in TEMPLATES_DIR
        const files = fs.existsSync(TEMPLATES_DIR) ? fs.readdirSync(TEMPLATES_DIR) : [];
        const normTarget = tplName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const found = files.find(f => f.toLowerCase().replace(/[^a-z0-9]/g, '') === normTarget);
        if (found) {
          tplPath = path.join(TEMPLATES_DIR, found);
        } else {
          const isFR = tplName.toLowerCase().includes('fr') || tplName.toLowerCase().includes('flash');
          const fallback = isFR ? 'NPCC-ADNOC-Flash-Report-Template.docx' : 'master-template.docx';
          console.warn(`Template not found: ${tplName}, falling back to ${fallback}`);
          tplPath = path.join(TEMPLATES_DIR, fallback);
        }
      }
    }

    const tplBuffer = fs.readFileSync(tplPath);
    const zip = await JSZip.loadAsync(tplBuffer);

    // 3. Parse Document AI extractions early
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

    // Active inspection date: prefer explicit inspectionDates from Inspection/RFI over startDate fallback
    const rawDates = (inspection as any).inspectionDates || rfiExtracted.inspectionDates || rfiExtracted.inspectionDate;
    const activeDate = options?.reportDate ? new Date(options.reportDate) : new Date(inspection.startDate);
    const dateFormatted = `${String(activeDate.getDate()).padStart(2, '0')}/${String(activeDate.getMonth() + 1).padStart(2, '0')}/${activeDate.getFullYear()}`;
    const dateStr = rawDates ? String(rawDates).trim() : dateFormatted;
    const dateLong = rawDates ? String(rawDates).trim() : activeDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    // 4. Parse and modify document.xml
    const docXmlPath = 'word/document.xml';
    let docXml = await zip.file(docXmlPath)!.async('string');

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
      [/<w:t>po<\/w:t>/g, `<w:t>${escapeXml(project.poNumber || '')}</w:t>`],
    ];

    for (const [pattern, replacement] of replacements) {
      docXml = docXml.replace(pattern, replacement);
    }

    // === 2. DYNAMIC ITP & MATERIAL EXTRACTION ===

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

    // === 2.1 PAGE 1 FORM FIELD UPDATES (Robust Label Matching for Blank & Custom Templates) ===
    const offeredItems = (inspection.items || []).filter((i: any) => i.presentedQty > 0 || i.presentedQty === undefined);
    const listToRender = offeredItems.length > 0 ? offeredItems : (inspection.items || []);
    const supplierJobs = listToRender.map((i: any) => i.jobNo).filter(Boolean).join(', ') || 'CD77E001-1';

    // PO Number
    docXml = this.setCellValueAfterLabel(docXml, 'P.O. No:', project.poNumber || '');
    docXml = this.setCellValueAfterLabel(docXml, 'PO No:', project.poNumber || '');
    docXml = this.setCellValueAfterLabel(docXml, 'P.O. No.:', project.poNumber || '');
    docXml = this.setCellValueAfterLabel(docXml, 'PO No.:', project.poNumber || '');
    docXml = this.setCellValueAfterLabel(docXml, 'Purchase Order No:', project.poNumber || '');
    docXml = this.setCellValueAfterLabel(docXml, 'Purchase Order No.:', project.poNumber || '');

    // Requisition & Report No
    docXml = this.setCellValueAfterLabel(docXml, 'Requisition No:', inspection.reportNumber);
    docXml = this.setCellValueAfterLabel(docXml, 'Requisition No.:', inspection.reportNumber);
    docXml = this.setCellValueAfterLabel(docXml, 'Report No:', inspection.reportNumber);
    docXml = this.setCellValueAfterLabel(docXml, 'Report No.:', inspection.reportNumber);
    docXml = this.setCellValueAfterLabel(docXml, 'Inspection Report No:', inspection.reportNumber);
    docXml = this.setCellValueAfterLabel(docXml, 'Inspection Report No.:', inspection.reportNumber);

    // Dates
    docXml = this.setCellValueAfterLabel(docXml, 'Date of Order:', dateLong);
    docXml = this.setCellValueAfterLabel(docXml, 'Date(s) of Visit(s):', dateStr);
    docXml = this.setCellValueAfterLabel(docXml, 'Date of Visit:', dateStr);
    docXml = this.setCellValueAfterLabel(docXml, 'Inspection Date:', dateStr);
    docXml = this.setCellValueAfterLabel(docXml, 'Date of Previous Visit:', inspection.previousVisitDate ? new Date(inspection.previousVisitDate).toLocaleDateString('en-GB') : 'NA');
    docXml = this.setCellValueAfterLabel(docXml, 'Date of Next Scheduled Visit:', inspection.nextVisitDate ? new Date(inspection.nextVisitDate).toLocaleDateString('en-GB') : '16/09/2026');

    // Supplier Job No & Project Name
    docXml = this.setCellValueAfterLabel(docXml, 'Supplier Job No:', supplierJobs);
    docXml = this.setCellValueAfterLabel(docXml, 'Job No:', supplierJobs);
    docXml = this.setCellValueAfterLabel(docXml, 'Project Name:', effectiveProjectName);
    docXml = this.setCellValueAfterLabel(docXml, 'Project:', effectiveProjectName);

    // Supplier & Location
    const supplierFull = [project.supplierName, project.supplierAddress].filter(Boolean).join('\n') || project.supplierName || 'KSB MIL Controls Limited';
    docXml = this.setCellValueAfterLabel(docXml, 'Supplier:', supplierFull);
    docXml = this.setCellValueAfterLabel(docXml, 'Vendor:', supplierFull);
    docXml = this.setCellValueAfterLabel(docXml, 'Manufacturer:', supplierFull);
    docXml = this.setCellValueAfterLabel(docXml, 'Location:', inspection.location || project.supplierAddress || 'Meladoor, Annamanada, Kerala, India');
    docXml = this.setCellValueAfterLabel(docXml, 'Place of Inspection:', inspection.location || project.supplierAddress || 'Meladoor, Annamanada, Kerala, India');

    // Customer
    if (project.customerName) {
      docXml = this.setCellValueAfterLabel(docXml, 'Customer:', project.customerName);
      docXml = this.setCellValueAfterLabel(docXml, 'Client:', project.customerName);
      docXml = this.setCellValueAfterLabel(docXml, 'Customer Name:', project.customerName);
      docXml = this.setCellValueAfterLabel(docXml, 'Client Name:', project.customerName);
    }
    if (project.customerAddress) {
      docXml = this.setCellValueAfterLabel(docXml, 'Address:', project.customerAddress);
    }

    // Filter attended activities (or fall back to all inspection activities if none are graded yet)
    let attendedActivities = (inspection.activities || []).filter((act: any) => {
      const result = inspection.results?.find((r: any) => r.activityId === act.id);
      return act.status === 'ACCEPTABLE' || act.status === 'NOT_ACCEPTABLE' || (result && result.status !== 'PENDING');
    });
    if (attendedActivities.length === 0 && (inspection.activities || []).length > 0) {
      attendedActivities = inspection.activities || [];
    }

    const isFlashReport = (tplName || '').toLowerCase().includes('flash') ||
      docXml.includes('Items Inspected / Activities / Results') ||
      docXml.includes('Flash Report No');

    const isWoodTemplate = (tplName || '').toLowerCase().includes('p5') ||
      (tplName || '').toLowerCase().includes('wood') ||
      docXml.includes('P5-DBN') ||
      docXml.includes('4.1- RESULTS OF TESTS AND INSPECTION') ||
      docXml.includes('13- PHOTOS');

    // Resolve effective header values with fallback hierarchy (Inspection model -> Project model -> AI Extracted -> defaults)
    const effectiveNotificationNo = (inspection as any).notificationNo ||
      (inspection as any).noiNumber ||
      rfiExtracted.notificationNo ||
      rfiExtracted.rfiNumber ||
      (inspection.reportNumber && inspection.reportNumber !== '001' ? inspection.reportNumber : '') ||
      '';

    const effectiveReportNo = (inspection.reportNumber && inspection.reportNumber !== '001')
      ? inspection.reportNumber
      : (effectiveNotificationNo || '001');

    const effectiveInspectionDate = dateStr;

    const effectiveClientName = project.customerName ||
      rfiExtracted.clientName ||
      rfiExtracted.customerName ||
      itpExtracted.clientName ||
      itpExtracted.customerName ||
      '';

    const effectiveContractor = project.epcContractor ||
      rfiExtracted.contractorName ||
      itpExtracted.contractorName ||
      '';

    const effectiveVendor = project.supplierName ||
      rfiExtracted.vendorName ||
      rfiExtracted.supplierName ||
      itpExtracted.supplier ||
      itpExtracted.supplierName ||
      '';

    const effectiveContactPerson = (project as any).contactPerson ||
      rfiExtracted.contactPerson ||
      '';

    // Wood Template Table 1 Header Population
    if (isWoodTemplate) {
      docXml = this.populateWoodTable1(docXml, inspection, project, dateStr, rfiExtracted);
    }

    // Flash Report Table 1 & Table 2 Header Fields
    if (isFlashReport) {
      docXml = this.setCellValueInNextCell(docXml, ['Flash Report No', 'Flash  Report  No'], effectiveReportNo);
      docXml = this.setCellValueInNextCell(docXml, ['Rev #', 'Rev#'], (inspection as any).revisionNumber || rfiExtracted.poRevision || '0');
      docXml = this.setCellValueInNextCell(docXml, ['Date:'], effectiveInspectionDate);
      docXml = this.setCellValueInNextCell(docXml, ['PROJECT NAME'], effectiveProjectName);
      docXml = this.setCellValueInNextCell(docXml, ['CLIENT/ COMPANY', 'CLIENT / COMPANY', 'CLIENT/COMPANY'], effectiveClientName);
      docXml = this.setCellValueInNextCell(docXml, ['CONTRACTOR', 'CONTRACTOR '], effectiveContractor);
      docXml = this.setCellValueInNextCell(docXml, ['Material Description', 'Material  Description'], materialSummary);
      docXml = this.setCellValueInNextCell(docXml, ['Contractor PO No:', 'Contractor PO No'], project.poNumber || rfiExtracted.poNumber || '');
      docXml = this.setCellValueInNextCell(docXml, ['Rev.'], (project as any).poRevision || (inspection as any).poRevision || rfiExtracted.poRevision || '0');
      docXml = this.setCellValueInNextCell(docXml, ['Vendor / Supplier', 'Vendor/Supplier', 'VENDOR / SUPPLIER'], effectiveVendor);
      docXml = this.setCellValueInNextCell(docXml, ['Contact Person'], effectiveContactPerson);
      docXml = this.setCellValueInNextCell(docXml, [
        'Inspection Notification No / Rev.',
        'Inspection Notification No / Rev',
        'Inspection Notification No',
        'Inspection Notification No.',
        'Notification No:',
        'Notification No.:',
        'RFI No:',
        'RFI No.:',
        'RFI Number:',
      ], effectiveNotificationNo);
      docXml = this.setCellValueInNextCell(docXml, ['Inspection Date'], effectiveInspectionDate);

      // Check "During Mfg." checkbox in Table 2
      const duringMfgIdx = docXml.indexOf('During Mfg.');
      if (duringMfgIdx !== -1) {
        const prevCheckBox = docXml.lastIndexOf('<w:checkBox>', duringMfgIdx);
        const nextCheckBoxEnd = docXml.indexOf('</w:checkBox>', prevCheckBox);
        if (prevCheckBox !== -1 && nextCheckBoxEnd !== -1 && nextCheckBoxEnd < duringMfgIdx) {
          const checkedBoxXml = '<w:checkBox><w:sizeAuto/><w:default w:val="1"/><w:checked/></w:checkBox>';
          docXml = docXml.substring(0, prevCheckBox) + checkedBoxXml + docXml.substring(nextCheckBoxEnd + 13);
        }
      }
    } else if (!isWoodTemplate) {
      docXml = this.setCellValueInNextCell(docXml, ['Flash Report No', 'Flash  Report  No'], inspection.reportNumber || '001');
      docXml = this.setCellValueInNextCell(docXml, ['Date:'], dateStr);
      docXml = this.setCellValueInNextCell(docXml, ['PROJECT NAME'], effectiveProjectName);
      docXml = this.setCellValueInNextCell(docXml, ['CLIENT/ COMPANY', 'CLIENT / COMPANY', 'CLIENT/COMPANY'], effectiveClientName);
      docXml = this.setCellValueInNextCell(docXml, ['CONTRACTOR', 'CONTRACTOR '], effectiveContractor);
      docXml = this.setCellValueInNextCell(docXml, ['Vendor / Supplier', 'Vendor/Supplier', 'VENDOR / SUPPLIER'], effectiveVendor);
      docXml = this.setCellValueInNextCell(docXml, ['Contact Person'], effectiveContactPerson);
      docXml = this.setCellValueInNextCell(docXml, ['Contractor PO No:', 'Contractor PO No'], project.poNumber || '2745-2024-73004-AC');
      docXml = this.setCellValueInNextCell(docXml, ['Contractor  Project #', 'Contractor Project #'], project.projectNumber || '2745');
      docXml = this.setCellValueInNextCell(docXml, ['Inspector'], inspection.inspector?.fullName || 'Jithin KB');
      docXml = this.setCellValueInNextCell(docXml, ['Inspection Agency'], inspection.inspector?.organization || 'ERAM');
      docXml = this.setCellValueInNextCell(docXml, ['Inspection Location'], inspection.location || 'Udupi');
      docXml = this.setCellValueInNextCell(docXml, ['Ins pection Date & Time', 'Inspection Date & Time'], effectiveInspectionDate);
      docXml = this.setCellValueInNextCell(docXml, ['Material Description', 'Material  Description'], materialSummary);
    }

    // Template Token Placeholders (if template uses {{TAG}} syntax)
    const tokenReplacements: [RegExp, string][] = [
      [/\{\{\s*CUSTOMER_NAME\s*\}\}/gi, escapeXml(project.customerName || '')],
      [/\{\{\s*CUSTOMER_ADDRESS\s*\}\}/gi, escapeXml(project.customerAddress || '')],
      [/\{\{\s*SUPPLIER_NAME\s*\}\}/gi, escapeXml(project.supplierName || '')],
      [/\{\{\s*SUPPLIER_ADDRESS\s*\}\}/gi, escapeXml(project.supplierAddress || '')],
      [/\{\{\s*PO_NUMBER\s*\}\}/gi, escapeXml(project.poNumber || '')],
      [/\{\{\s*PO_NO\s*\}\}/gi, escapeXml(project.poNumber || '')],
      [/\{\{\s*PROJECT_NAME\s*\}\}/gi, escapeXml(effectiveProjectName)],
      [/\{\{\s*REPORT_NUMBER\s*\}\}/gi, escapeXml(inspection.reportNumber || '')],
      [/\{\{\s*REPORT_NO\s*\}\}/gi, escapeXml(inspection.reportNumber || '')],
      [/\{\{\s*INSPECTION_DATE\s*\}\}/gi, dateStr],
      [/\{\{\s*LOCATION\s*\}\}/gi, escapeXml(inspection.location || project.supplierAddress || '')],
      [/\{\{\s*ITP_NUMBER\s*\}\}/gi, escapeXml(itpFullRef)],
      [/\{\{\s*MATERIAL_DESCRIPTION\s*\}\}/gi, escapeXml(materialSummary)],
    ];
    for (const [tokenPat, tokenVal] of tokenReplacements) {
      docXml = docXml.replace(tokenPat, tokenVal);
    }

    // Update Materials/Items Inspected on Page 1 (lives inside the same cell in template)
    const matLabelIdx = this.findHeaderIndex(docXml, ['Materials/Items Inspected:', 'Materials/Items Inspected', 'Material Description:']);
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

    // Flash Report Inspector Name and Stamp/Sign
    docXml = docXml.replace(/<w:t[^>]*>\s*Inspector Name:\s*<\/w:t>/g, `<w:t>Inspector Name: ${escapeXml(inspectorName)}</w:t>`);
    docXml = docXml.replace(/<w:t>Inspector Name:<\/w:t>/g, `<w:t>Inspector Name: ${escapeXml(inspectorName)}</w:t>`);

    // === 2.2 SUMMARY NARRATIVE (Page 1 / Table 3 for standard reports) ===
    if (!isFlashReport) {
      // Cleanly replace Row 2 containing the summary text and conclusion to avoid fragmented template leftover text
      const summaryHeaderIdx = this.findHeaderIndex(docXml, [
        'INSPECTION SUMMARY (Including Area of Concern)',
        'INSPECTION SUMMARY (Including Area of Concern',
        'INSPECTION SUMMARY AND CONCLUSION:',
        'INSPECTION SUMMARY AND CONCLUSION'
      ]);
      if (summaryHeaderIdx !== -1) {
        const row1End = docXml.indexOf('</w:tr>', summaryHeaderIdx) + 7;
        const row2Start = docXml.indexOf('<w:tr', row1End);
        const row2End = docXml.indexOf('</w:tr>', row2Start) + 7;
        if (row2Start !== -1 && row2End !== -1 && row2End > row2Start) {
          const isTable3Format = docXml.substring(summaryHeaderIdx, row1End).toLowerCase().includes('area of concern');
          if (isTable3Format) {
            let summaryText = '';
            if (inspection.summaryNarrative && inspection.summaryNarrative.trim().length > 15) {
              summaryText = inspection.summaryNarrative;
            } else {
              summaryText = this.synthesizeInspectionSummary(inspection, project, itpFullRef);
            }
            const paras = summaryText.split(/\r?\n/).filter(p => p.trim().length > 0);
            const pXml = paras.map(p =>
              `<w:p><w:pPr><w:ind w:left="720" w:right="72"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/></w:rPr><w:t>${escapeXml(p)}</w:t></w:r></w:p>`
            ).join('');
            const table3Row = `<w:tr w:rsidR="00841EA4" w:rsidTr="00B92D01">
  <w:tc>
    <w:tcPr><w:tcW w:w="10260" w:type="dxa"/></w:tcPr>
    ${pXml}
  </w:tc>
</w:tr>`;
            docXml = docXml.substring(0, row2Start) + table3Row + docXml.substring(row2End);
          } else {
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
      }
    }

    // Flash Report Summary Paragraph
    const flashSummaryIdx = this.findHeaderIndex(docXml, ['Summary of the Inspection:', 'Summary of the Inspection']);
    if (flashSummaryIdx !== -1) {
      const pEnd = docXml.indexOf('</w:p>', flashSummaryIdx) + 6;
      if (pEnd !== -1) {
        let summaryText = '';
        if (inspection.summaryNarrative && inspection.summaryNarrative.trim().length > 15) {
          summaryText = inspection.summaryNarrative.trim();
        } else {
          summaryText = this.synthesizeInspectionSummary(inspection, project, itpFullRef);
        }

        const lines = summaryText.split(/\r?\n/).filter(l => l.trim().length > 0);
        const summaryP = lines.map(line => {
          const isBold = /^itp\s*step/i.test(line.trim());
          const boldTag = isBold ? '<w:b/>' : '';
          return `<w:p><w:pPr><w:spacing w:before="60" w:after="80"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/>${boldTag}</w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/>${boldTag}</w:rPr><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`;
        }).join('');

        const nextTblStart = docXml.indexOf('<w:tbl', pEnd);
        if (nextTblStart !== -1) {
          const nextPStart = docXml.indexOf('<w:p', pEnd);
          if (nextPStart !== -1 && nextPStart < nextTblStart) {
            const nextPEnd = docXml.lastIndexOf('</w:p>', nextTblStart) + 6;
            docXml = docXml.substring(0, nextPStart) + summaryP + docXml.substring(nextPEnd);
          } else {
            docXml = docXml.substring(0, pEnd) + summaryP + docXml.substring(pEnd);
          }
        }
      }
    }

    // Wood P5-DBN Report Summary Table: "REPORT SUMMARY:" -> "INSPECTION AND TESTS WITNESSED:"
    const p5SummaryIdx = this.findHeaderIndex(docXml, ['REPORT SUMMARY:', 'REPORT SUMMARY']);
    if (p5SummaryIdx !== -1) {
      const witnessedIdx = docXml.indexOf('INSPECTION AND TESTS WITNESSED:', p5SummaryIdx);
      if (witnessedIdx !== -1) {
        const rowEnd = docXml.indexOf('</w:tr>', witnessedIdx);
        let summaryText = '';
        if (inspection.summaryNarrative && inspection.summaryNarrative.trim().length > 10) {
          summaryText = inspection.summaryNarrative.trim();
        } else {
          summaryText = this.synthesizeInspectionSummary(inspection, project, itpFullRef);
        }

        const instrIdx = docXml.indexOf('Report the inspections and tests witnessed as per', witnessedIdx);
        if (instrIdx !== -1 && instrIdx < rowEnd) {
          let pStart = instrIdx;
          while (pStart >= 0) {
            pStart = docXml.lastIndexOf('<w:p', pStart);
            if (pStart === -1) break;
            const c = docXml.charAt(pStart + 4);
            if (c === ' ' || c === '>') break;
            pStart--;
          }
          const pEnd = docXml.indexOf('</w:p>', instrIdx) + 6;
          if (pStart !== -1 && pEnd !== -1 && pEnd > pStart) {
            const summaryP = `<w:p><w:pPr><w:jc w:val="both"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${escapeXml(summaryText)}</w:t></w:r></w:p>`;
            docXml = docXml.substring(0, pStart) + summaryP + docXml.substring(pEnd);
          }
        }
      }

      // Check "further fabrication stages." checkbox in Row 5
      const furtherFabIdx = docXml.indexOf('further fabrication stages.', p5SummaryIdx);
      if (furtherFabIdx !== -1) {
        const prevTr = docXml.lastIndexOf('<w:tr', furtherFabIdx);
        const nextTr = docXml.indexOf('</w:tr>', furtherFabIdx);
        const checkIdx = docXml.indexOf('<w:checkBox>', prevTr);
        const checkEnd = docXml.indexOf('</w:checkBox>', checkIdx);
        if (checkIdx !== -1 && checkEnd !== -1 && checkEnd < nextTr) {
          const checkedXml = '<w:checkBox><w:sizeAuto/><w:default w:val="1"/><w:checked/></w:checkBox>';
          docXml = docXml.substring(0, checkIdx) + checkedXml + docXml.substring(checkEnd + 13);
        }
      }
    }

    if (!isFlashReport) {
      // === 2.4 GENERIC MATERIALS TABLE (Table 6) ===
      // Wipe old template sample generic materials and populate ONLY offered items
      const gmHeaderIdx = this.findHeaderIndex(docXml, ['TAG / EQPT NO.', 'TAG/EQPT NO', 'TAG NO.', 'TAG NO', 'EQUIPMENT NO', 'TAG / ITEM']);
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
      const matHeaderIdx = this.findHeaderIndex(docXml, ['PRODUCT / MATERIAL', 'PRODUCT/MATERIAL', 'MATERIALS INSPECTED', 'ITEM NAME']);
      if (matHeaderIdx !== -1) {
        const headerTrEnd = docXml.indexOf('</w:tr>', matHeaderIdx) + 7;
        const innerTableEnd = docXml.indexOf('</w:tbl>', headerTrEnd);
        if (headerTrEnd !== -1 && innerTableEnd !== -1 && innerTableEnd > headerTrEnd) {
          const materialRows = this.buildMaterialRowsXml(inspection.items || []);
          docXml = docXml.substring(0, headerTrEnd) + materialRows + docXml.substring(innerTableEnd);
        }
      }

      // === 2.6 5-COLUMN MATERIALS OFFERED TABLE (Table 6) ===
      const fiveColIdx = this.findHeaderIndex(docXml, [
        'Tag Number /  Material Code',
        'Tag Number / Material Code',
        'ITP Step #',
        'ITP Step No'
      ]);
      if (fiveColIdx !== -1) {
        const headerTrEnd = docXml.indexOf('</w:tr>', fiveColIdx) + 7;
        const innerTableEnd = docXml.indexOf('</w:tbl>', headerTrEnd);
        if (headerTrEnd !== -1 && innerTableEnd !== -1 && innerTableEnd > headerTrEnd) {
          const materialRows = this.buildFiveColumnMaterialRowsXml(inspection.items || []);
          docXml = docXml.substring(0, headerTrEnd) + materialRows + docXml.substring(innerTableEnd);
        }
      }

      // === 2.7 APPLICABLE STANDARDS TABLE (Table 4) ===
      const standardsIdx = this.findHeaderIndex(docXml, [
        'Revision (Date)',
        'APPLICABLE STANDARDS',
        'CODES & STANDARDS',
        'REFERENCE STANDARDS'
      ]);
      if (standardsIdx !== -1) {
        const headerTrEnd = docXml.indexOf('</w:tr>', standardsIdx) + 7;
        const innerTableEnd = docXml.indexOf('</w:tbl>', headerTrEnd);
        if (headerTrEnd !== -1 && innerTableEnd !== -1 && innerTableEnd > headerTrEnd) {
          let stdList: any[] = [];
          if ((inspection as any).applicableStandards) {
            try {
              const parsed = typeof (inspection as any).applicableStandards === 'string'
                ? JSON.parse((inspection as any).applicableStandards)
                : (inspection as any).applicableStandards;
              if (Array.isArray(parsed) && parsed.length > 0) stdList = parsed;
            } catch {}
          }
          if (stdList.length === 0 && itpExtracted.standards && Array.isArray(itpExtracted.standards) && itpExtracted.standards.length > 0) {
            stdList = itpExtracted.standards;
          }
          if (stdList.length === 0 && itpExtracted.applicableDocuments && Array.isArray(itpExtracted.applicableDocuments)) {
            stdList = itpExtracted.applicableDocuments.filter((d: any) => {
              const str = typeof d === 'string' ? d : (d.docNo || d.code || '');
              return /ASME|API|ISO|ASTM|MSS|NACE|BS|EN/i.test(str);
            });
          }
          if (stdList.length === 0) {
            stdList = (inspection as any).standards || (project as any).standards || [
              { docNo: 'ASTM A961', rev: '', description: '' }
            ];
          }
          const standardsRows = this.buildStandardsRowsXml(stdList);
          docXml = docXml.substring(0, headerTrEnd) + standardsRows + docXml.substring(innerTableEnd);
        }
      }

      // === 2.8 APPLICABLE DRAWINGS TABLE (Table 5) ===
      const drawingsIdx = this.findHeaderIndex(docXml, [
        'Approval Status (NMDC)',
        'Approval Status (Company)',
        'Approval Status'
      ]);
      if (drawingsIdx !== -1) {
        const headerTrEnd = docXml.indexOf('</w:tr>', drawingsIdx) + 7;
        const innerTableEnd = docXml.indexOf('</w:tbl>', headerTrEnd);
        if (headerTrEnd !== -1 && innerTableEnd !== -1 && innerTableEnd > headerTrEnd) {
          let dwgList: any[] = [];
          if ((inspection as any).applicableDrawings) {
            try {
              const parsed = typeof (inspection as any).applicableDrawings === 'string'
                ? JSON.parse((inspection as any).applicableDrawings)
                : (inspection as any).applicableDrawings;
              if (Array.isArray(parsed) && parsed.length > 0) dwgList = parsed;
            } catch {}
          }
          if (dwgList.length === 0 && itpExtracted.drawings && Array.isArray(itpExtracted.drawings) && itpExtracted.drawings.length > 0) {
            dwgList = itpExtracted.drawings;
          }
          if (dwgList.length === 0) {
            dwgList = (inspection as any).drawings || (project as any).drawings || [
              { docNo: itpNo || 'PNC105- PMVALVEITP', rev: itpRev || '5', statusNmdc: '', statusCompany: '', description: 'ITP' },
              { docNo: '2745-73004AC-J005-019- Manual Valves Drawing', rev: '', statusNmdc: '', statusCompany: '', description: '' }
            ];
          }
          const drawingsRows = this.buildDrawingsRowsXml(dwgList, itpNo, itpRev);
          docXml = docXml.substring(0, headerTrEnd) + drawingsRows + docXml.substring(innerTableEnd);
        }
      }

      // === 2.9 ITP STAGES & RESULTS TABLE (Table 8) ===
      // Autofill from accepted inspection activities and ITP clauses so summary table is never blank
      const itpStageIdx = this.findHeaderIndex(docXml, [
        'ITP No. with Rev.',
        'ITP No. with Rev'
      ]);
      if (itpStageIdx !== -1) {
        const headerTrEnd = docXml.indexOf('</w:tr>', itpStageIdx) + 7;
        const innerTableEnd = docXml.indexOf('</w:tbl>', headerTrEnd);
        if (headerTrEnd !== -1 && innerTableEnd !== -1 && innerTableEnd > headerTrEnd) {
          let stageList: any[] = [];
          if ((inspection as any).stages && Array.isArray((inspection as any).stages) && (inspection as any).stages.length > 0) {
            stageList = (inspection as any).stages;
          } else if (attendedActivities.length > 0) {
            stageList = attendedActivities.map((act: any) => {
              const result = inspection.results?.find((r: any) => r.activityId === act.id);
              const resultText = result?.remarks || (act.status === 'ACCEPTABLE' || !act.status ? 'Acceptable' : act.status);
              return {
                itpRef: itpFullRef,
                stage: act.clauseNumber || '',
                description: act.activityName || '',
                results: resultText,
              };
            });
          }
          const itpStageRows = this.buildItpStageRowsXml(itpFullRef, stageList);
          docXml = docXml.substring(0, headerTrEnd) + itpStageRows + docXml.substring(innerTableEnd);
        }
      }

      // === 2.10 3-COLUMN MEASURING AND TEST EQUIPMENT TABLE (Table 11) ===
      const threeColInstIdx = this.findHeaderIndex(docXml, [
        'Calibration Due Date',
        'Calibration Due'
      ]);
      if (threeColInstIdx !== -1) {
        const headerTrEnd = docXml.indexOf('</w:tr>', threeColInstIdx) + 7;
        const innerTableEnd = docXml.indexOf('</w:tbl>', headerTrEnd);
        if (headerTrEnd !== -1 && innerTableEnd !== -1 && innerTableEnd > headerTrEnd) {
          const instList = (inspection.instruments && inspection.instruments.length > 0) ? inspection.instruments : [
            { instrumentName: 'Vernier Caliper', description: '', expiryDate: null },
            { instrumentName: 'PMI Machine', description: 'SciAps   X200', expiryDate: '2027-07-13' }
          ];
          const instRows = this.buildThreeColInstrumentRowsXml(instList);
          docXml = docXml.substring(0, headerTrEnd) + instRows + docXml.substring(innerTableEnd);
        }
      }

      // === 2.11 RESULTS OF TESTS AND INSPECTION & CERTIFICATION REVIEWED (Table 11) ===
      let t11Start = -1;
      let t11End = -1;
      let searchPos = 0;
      while ((searchPos = docXml.indexOf('RESULTS OF TESTS', searchPos)) !== -1) {
        const tblStart = this.findPrecedingTableStart(docXml, searchPos);
        if (tblStart !== -1) {
          const tblEnd = this.findMatchingTableEnd(docXml, tblStart);
          if (tblEnd !== -1 && tblEnd > searchPos) {
            const tblXml = docXml.substring(tblStart, tblEnd);
            if (tblXml.includes('4.1') && tblXml.includes('CERTIFICATION REVIEWED')) {
              t11Start = tblStart;
              t11End = tblEnd;
              break;
            }
          }
        }
        searchPos += 16;
      }

      if (t11Start !== -1 && t11End !== -1) {
        const tblXml = docXml.substring(t11Start, t11End);
        const rows = [...tblXml.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map(m => m[0]);
        if (rows.length >= 4) {
          const row0 = rows[0];
          const row2 = rows[2];
          const newRow1 = this.buildTestResultsRowXml(attendedActivities, inspection.items || [], inspection.results || []);
          const newRow3 = this.buildCertificationReviewedRowXml((inspection as any).certificationNotes);

          const row0Start = tblXml.indexOf(row0);
          const tablePrefix = tblXml.substring(0, row0Start);
          const newTable11 = `${tablePrefix}${row0}${newRow1}${row2}${newRow3}</w:tbl>`;
          docXml = docXml.substring(0, t11Start) + newTable11 + docXml.substring(t11End);
        }
      }
    }

    // === 3.1 FLASH REPORT ACTIVITIES & RESULTS (Table 4) ===
    const flashActHeaderIdx = this.findHeaderIndex(docXml, ['Items Inspected / Activities / Results', 'PO Item No']);
    if (flashActHeaderIdx !== -1) {
      const poItemIdx = docXml.indexOf('PO Item No', flashActHeaderIdx);
      const row2End = (poItemIdx !== -1) ? (docXml.indexOf('</w:tr>', poItemIdx) + 7) : (docXml.indexOf('</w:tr>', flashActHeaderIdx) + 7);
      const actCodeIdx = docXml.indexOf('Activity Code', row2End);
      if (actCodeIdx !== -1) {
        let actCodeTrStart = docXml.lastIndexOf('<w:tr ', actCodeIdx);
        if (actCodeTrStart === -1) actCodeTrStart = docXml.lastIndexOf('<w:tr>', actCodeIdx);
        if (actCodeTrStart !== -1 && actCodeTrStart > row2End) {
          const actRows = this.buildFlashActivitiesTableRows(inspection.items || [], attendedActivities);
          docXml = docXml.substring(0, row2End) + actRows + docXml.substring(actCodeTrStart);
        }
      }

      // Populate NOTES
      const notesLabelIdx = docXml.indexOf('NOTES:');
      if (notesLabelIdx !== -1) {
        const notesTrEnd = docXml.indexOf('</w:tr>', notesLabelIdx) + 7;
        const notesValTrStart = docXml.indexOf('<w:tr', notesTrEnd);
        const notesValTrEnd = docXml.indexOf('</w:tr>', notesValTrStart) + 7;
        if (notesValTrStart !== -1 && notesValTrEnd > notesValTrStart) {
          const acts = (attendedActivities || [])
            .map((a: any) => (a.activityName || '').split('\t')[0].replace(/^P\.O\.\s*item\(s\):?\s*/i, '').trim())
            .filter((n: string) => n.length > 2 && !n.toLowerCase().includes('p.o. item'));
          const uniqueActs = Array.from(new Set(acts));
          const actsStr = uniqueActs.length > 0 ? uniqueActs.join(', ') : 'Inspection and testing';
          const notesText = `${actsStr} was conducted on the offered ${materialSummary}. The test results were found to be acceptable and in compliance with the specified requirements.`;
          const notesRow = `<w:tr w:rsidR="000068D4" w:rsidTr="003815F0"><w:trPr><w:cantSplit/><w:trHeight w:val="852"/><w:jc w:val="center"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="10172" w:type="dxa"/><w:gridSpan w:val="9"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:ind w:left="360" w:right="72"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(notesText)}</w:t></w:r></w:p></w:tc></w:tr>`;
          docXml = docXml.substring(0, notesValTrStart) + notesRow + docXml.substring(notesValTrEnd);
        }
      }

      // Populate CONCERNS
      const concernsLabelIdx = docXml.indexOf('CONCERNS:');
      if (concernsLabelIdx !== -1) {
        const concernsTrEnd = docXml.indexOf('</w:tr>', concernsLabelIdx) + 7;
        const concernsValTrStart = docXml.indexOf('<w:tr', concernsTrEnd);
        const concernsValTrEnd = docXml.indexOf('</w:tr>', concernsValTrStart) + 7;
        if (concernsValTrStart !== -1 && concernsValTrEnd > concernsValTrStart) {
          const concernsText = (inspection.observations || []).length > 0 ? (inspection.observations || []).map((o: any) => o.comments).join('; ') : 'NA';
          const concernsRow = `<w:tr w:rsidR="002903ED" w:rsidTr="003815F0"><w:trPr><w:cantSplit/><w:trHeight w:val="852"/><w:jc w:val="center"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="10172" w:type="dxa"/><w:gridSpan w:val="9"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:ind w:left="360" w:right="72"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(concernsText)}</w:t></w:r></w:p></w:tc></w:tr>`;
          docXml = docXml.substring(0, concernsValTrStart) + concernsRow + docXml.substring(concernsValTrEnd);
        }
      }
    }

    if (!isFlashReport && !isWoodTemplate) {
      // === 4. DYNAMIC SCOPE OF INSPECTION TABLE (Table 9) ===
      const itpHeaderIdx = this.findHeaderIndex(docXml, ['ITP LINE NO.', 'ITP CLAUSE NO.', 'SCOPE OF INSPECTION']);
      if (itpHeaderIdx !== -1) {
        const headerTrEnd = docXml.indexOf('</w:tr>', itpHeaderIdx) + 7;
        const innerTableEnd = docXml.indexOf('</w:tbl>', headerTrEnd);
        if (headerTrEnd !== -1 && innerTableEnd !== -1 && innerTableEnd > headerTrEnd) {
          const dynamicRows = this.buildScopeRowsXml(inspection, attendedActivities);
          docXml = docXml.substring(0, headerTrEnd) + dynamicRows + docXml.substring(innerTableEnd);
        }
      }

      // === 5. EQUIPMENT AND INSTRUMENTATION (Table 10) ===
      const eqIdx = this.findHeaderIndex(docXml, ['EQUIPMENT AND INSTRUMENTATION', 'EQUIPMENT / INSTRUMENTATION', 'CALIBRATION INSTRUMENTS', 'MEASURING INSTRUMENTS']);
      if (eqIdx !== -1) {
        const tblStart = docXml.indexOf('<w:tbl', eqIdx);
        if (tblStart !== -1) {
          const tblEnd = this.findMatchingTableEnd(docXml, tblStart);
          if (tblEnd !== -1 && tblEnd > tblStart) {
            const equipmentTableXml = this.buildEquipmentTableXml(inspection.instruments || []);
            docXml = docXml.substring(0, tblStart) + equipmentTableXml + docXml.substring(tblEnd);
          }
        }
      }

      // === 5.5 INSPECTION DETAILS (Section 6.0) ===
      const inspDetIdx = this.findHeaderIndex(docXml, ['INSPECTION DETAILS', 'DETAILS OF INSPECTION', 'INSPECTION ACTIVITIES DETAILS']);
      if (inspDetIdx !== -1) {
        const tblStart = docXml.indexOf('<w:tbl', inspDetIdx);
        if (tblStart !== -1) {
          const tcStart = docXml.indexOf('<w:tc', tblStart);
          if (tcStart !== -1) {
            const tcTagEnd = docXml.indexOf('>', tcStart);
            let contentStart = tcTagEnd !== -1 ? tcTagEnd + 1 : tcStart + 5;
            const tcPrIdx = docXml.indexOf('<w:tcPr', tcStart);
            if (tcPrIdx !== -1 && tcPrIdx < contentStart + 20) {
              const tcPrEnd = docXml.indexOf('</w:tcPr>', tcPrIdx);
              if (tcPrEnd !== -1) {
                contentStart = tcPrEnd + 9;
              }
            }
            const tcEnd = this.findMatchingCellEnd(docXml, tcStart);
            if (contentStart !== -1 && tcEnd !== -1 && tcEnd > contentStart) {
              const detailsXml = this.buildInspectionDetailsXml(inspection, project, attendedActivities, dateLong, dateStr, itpFullRef);
              docXml = docXml.substring(0, contentStart) + detailsXml + docXml.substring(tcEnd);
            }
          }
        }
      }

      // === 6. DOCUMENTS USED (Table 8) ===
      // Clean old documents and replace with actual RFI & ITP
      const docIdx = this.findHeaderIndex(docXml, ['DOCUMENTS USED', 'REFERENCE DOCUMENTS', 'APPLICABLE DOCUMENTS']);
      if (docIdx !== -1) {
        const tblStart = docXml.indexOf('<w:tbl', docIdx);
        if (tblStart !== -1) {
          const tblEnd = this.findMatchingTableEnd(docXml, tblStart);
          if (tblEnd !== -1 && tblEnd > tblStart) {
            const cleanDocsTable = this.buildDocumentsTableXml(inspection, project, itpNo, itpRev);
            docXml = docXml.substring(0, tblStart) + cleanDocsTable + docXml.substring(tblEnd);
          }
        }
      }
    }

    // === 7. ATTENDEES TABLE ===
    const flashAttIdx = this.findHeaderIndex(docXml, ['Attendee Name', 'Organization  Name', 'Organization Name', 'Contact Details']);
    if (flashAttIdx !== -1) {
      const headerTrEnd = docXml.indexOf('</w:tr>', flashAttIdx) + 7;
      const innerTableEnd = docXml.indexOf('</w:tbl>', headerTrEnd);
      if (headerTrEnd !== -1 && innerTableEnd !== -1 && innerTableEnd > headerTrEnd) {
        const attendeeRows = this.buildFlashAttendeesXml(inspection.attendees || [], inspection.inspector, project);
        docXml = docXml.substring(0, headerTrEnd) + attendeeRows + docXml.substring(innerTableEnd);
      }
    } else {
      const attendeeHeaderIdx = this.findHeaderIndex(docXml, ['COMPANY REPRESENTED', 'PERSONS ATTENDING', 'ATTENDEES', 'ATTENDANCE LIST']);
      if (attendeeHeaderIdx !== -1) {
        const headerTrEnd = docXml.indexOf('</w:tr>', attendeeHeaderIdx) + 7;
        const innerTableEnd = docXml.indexOf('</w:tbl>', headerTrEnd);
        if (headerTrEnd !== -1 && innerTableEnd !== -1 && innerTableEnd > headerTrEnd) {
          const attendeeRows = this.buildAttendeesXml(inspection.attendees || []);
          docXml = docXml.substring(0, headerTrEnd) + attendeeRows + docXml.substring(innerTableEnd);
        }
      }
    }

    // === 8. REPAIR & POPULATE PHOTO SECTION ===
    const photos = inspection.photos || [];
    if (photos.length > 0) {
      const photoHeaderIdx = this.findHeaderIndex(docXml, [
        '13- PHOTOS',
        '13-PHOTOS',
        '13.0 PHOTOGRAPHS',
        '13.0 PHOTOS',
        '13. PHOTOGRAPHS',
        '13. PHOTOS',
        'Inspection Photos.',
        'Inspection Photos',
        'INSPECTION PHOTOS',
        'PHOTOGRAPHS',
        'PHOTO SHEET',
        'PHOTOS:'
      ]);
      if (photoHeaderIdx !== -1) {
        const containingTblStart = this.findPrecedingTableStart(docXml, photoHeaderIdx);
        let isInsideTable = false;
        let tblStart = -1;
        let tblEnd = -1;

        if (containingTblStart !== -1) {
          const containingTblEnd = this.findMatchingTableEnd(docXml, containingTblStart);
          if (containingTblEnd !== -1 && containingTblEnd > photoHeaderIdx) {
            isInsideTable = true;
            tblStart = containingTblStart;
            tblEnd = containingTblEnd;
          }
        }

        if (!isInsideTable) {
          tblStart = docXml.indexOf('<w:tbl', photoHeaderIdx);
          if (tblStart !== -1) {
            tblEnd = this.findMatchingTableEnd(docXml, tblStart);
          }
        }

        if (tblStart !== -1 && tblEnd !== -1) {
          const photoResult = await this.embedUploadedPhotos(zip, photos);
          if (isInsideTable) {
            // Keep Row 0 (header row "13- PHOTOS") and replace rows 1..N
            const row0End = docXml.indexOf('</w:tr>', photoHeaderIdx) + 7;
            if (row0End > photoHeaderIdx && row0End < tblEnd) {
              docXml = docXml.substring(0, row0End) + photoResult.rowsXml + docXml.substring(tblEnd - 8);
            }
          } else {
            // Standalone table following photo header
            docXml = docXml.substring(0, tblStart) + photoResult.tableXml + docXml.substring(tblEnd);
          }
        }
      }
    }

    // Validate XML integrity to ensure generated document is not corrupted
    const xmlValidation = XMLValidator.validate(docXml);
    if (xmlValidation !== true) {
      console.error('XML Validation Error in generated report:', xmlValidation.err);
      fs.writeFileSync('debug_docXml.xml', docXml);
      throw new Error(`Generated document XML is invalid: ${xmlValidation.err.msg} at line ${xmlValidation.err.line}, col ${xmlValidation.err.col}`);
    }

    // Save modified document.xml
    zip.file(docXmlPath, docXml);

    // === 9. UPDATE HEADERS & FOOTERS ===
    await this.updateHeadersAndFooters(zip, inspection, project, dateLong, dateStr);

    // 10. Generate output file
    const outputFilename = `IR-${inspection.reportNumber}-${Date.now()}.doc`;
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
   * Find table header index with XML-tag tolerance and alternative naming variations
   */
  private findHeaderIndex(docXml: string, possibleHeaders: string[]): number {
    for (const h of possibleHeaders) {
      // 1. Direct index
      let idx = docXml.indexOf(h);
      if (idx !== -1) return idx;

      // 2. Case-insensitive
      const lowerXml = docXml.toLowerCase();
      const lowerH = h.toLowerCase();
      idx = lowerXml.indexOf(lowerH);
      if (idx !== -1) return idx;

      // 3. XML-tag tolerant search (when Word splits letters across runs)
      try {
        const pattern = lowerH
          .split('')
          .map(c => (/\s/.test(c) ? '(?:<[^>]+>|\\s)+' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:<[^>]+>)*'))
          .join('');
        const rx = new RegExp(pattern, 'i');
        const match = rx.exec(docXml);
        if (match) return match.index;
      } catch {}
    }
    return -1;
  }

  /**
   * Set text value in a cell immediately following a label cell, or within the label cell if blank line
   */
  private setCellValueAfterLabel(docXml: string, label: string, newText: string): string {
    if (!newText && newText !== '0') return docXml;
    let labelIdx = docXml.indexOf(label);
    if (labelIdx === -1) {
      const cleanLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
      const match = new RegExp(cleanLabel, 'i').exec(docXml);
      if (match) labelIdx = match.index;
      else {
        try {
          const pattern = label
            .toLowerCase()
            .split('')
            .map(c => (/\s/.test(c) ? '(?:<[^>]+>|\\s)+' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:<[^>]+>)*'))
            .join('');
          const m = new RegExp(pattern, 'i').exec(docXml);
          if (m) labelIdx = m.index;
          else return docXml;
        } catch {
          return docXml;
        }
      }
    }

    const nextTrEnd = docXml.indexOf('</w:tr>', labelIdx);
    const labelTcEnd = docXml.indexOf('</w:tc>', labelIdx);
    if (labelTcEnd === -1) return docXml;

    // 1. Check if the cell containing the label has a subsequent paragraph (<w:p>) for the value (like P.O. No)
    const labelPEnd = docXml.indexOf('</w:p>', labelIdx);
    if (labelPEnd !== -1 && labelPEnd < labelTcEnd) {
      const remainingInCell = docXml.substring(labelPEnd + 6, labelTcEnd);
      if (remainingInCell.includes('<w:p')) {
        const lines = String(newText || '').split(/\r?\n/).filter(l => l.trim().length > 0);
        const paragraphs = lines.length > 0 ? lines.map(line =>
          `<w:p><w:pPr><w:contextualSpacing/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${escapeXml(line)}</w:t></w:r></w:p>`
        ).join('') : `<w:p><w:pPr><w:contextualSpacing/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:t></w:t></w:r></w:p>`;
        return docXml.substring(0, labelPEnd + 6) + paragraphs + docXml.substring(labelTcEnd);
      }
    }

    const valTcStart = docXml.indexOf('<w:tc', labelTcEnd);
    const valTcEnd = docXml.indexOf('</w:tc>', valTcStart);

    // If next cell is on the SAME row
    if (valTcStart !== -1 && valTcEnd !== -1 && (nextTrEnd === -1 || valTcStart < nextTrEnd)) {
      const valCellXml = docXml.substring(valTcStart, valTcEnd);
      // Ensure the next cell is NOT another label (e.g. "Change No:", "Requisition No:", "P.O. Status:")
      const isAnotherLabel = /<w:t[^>]*>\s*(Change No:|Requisition No:|P\.O\. Status:|Phone:|Date|E-Mail|Primary Contact)/i.test(valCellXml);
      if (!isAnotherLabel) {
        const pStart = valCellXml.indexOf('<w:p');
        const pEnd = valCellXml.lastIndexOf('</w:p>') + 6;
        if (pStart !== -1 && pEnd !== -1) {
          const lines = String(newText || '').split(/\r?\n/).filter(l => l.trim().length > 0);
          const paragraphs = lines.length > 0 ? lines.map(line =>
            `<w:p><w:pPr><w:contextualSpacing/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${escapeXml(line)}</w:t></w:r></w:p>`
          ).join('') : `<w:p><w:pPr><w:contextualSpacing/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:t></w:t></w:r></w:p>`;

          const updatedCellXml = valCellXml.substring(0, pStart) + paragraphs + valCellXml.substring(pEnd);
          return docXml.substring(0, valTcStart) + updatedCellXml + docXml.substring(valTcEnd);
        }
      } else {
        // Next cell is another label; insert the value as a new paragraph inside the current cell
        const newPara = `<w:p><w:pPr><w:contextualSpacing/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${escapeXml(newText)}</w:t></w:r></w:p>`;
        return docXml.substring(0, labelTcEnd) + newPara + docXml.substring(labelTcEnd);
      }
    } else {
      // In-cell label & value (same cell): append value to the cell's last paragraph
      const cellStart = docXml.lastIndexOf('<w:tc', labelIdx);
      if (cellStart !== -1 && labelTcEnd > cellStart) {
        const cellXml = docXml.substring(cellStart, labelTcEnd);
        const lastP = cellXml.lastIndexOf('</w:p>');
        if (lastP !== -1) {
          const insertRun = `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t xml:space="preserve"> ${escapeXml(String(newText || ''))}</w:t></w:r>`;
          const updatedCell = cellXml.substring(0, lastP) + insertRun + cellXml.substring(lastP);
          return docXml.substring(0, cellStart) + updatedCell + docXml.substring(labelTcEnd);
        }
      }
    }

    return docXml;
  }

  /**
   * Find table start <w:tbl preceding a given character position
   */
  private findPrecedingTableStart(docXml: string, pos: number): number {
    const re = /<w:tbl[\s>]/g;
    let m;
    let last = -1;
    while ((m = re.exec(docXml)) !== null) {
      if (m.index < pos) last = m.index;
      else break;
    }
    return last;
  }

  /**
   * Find matching closing </w:tbl> tag for a table starting at tblStart, taking nested tables into account
   */
  private findMatchingTableEnd(docXml: string, tblStart: number): number {
    let depth = 1;
    let pos = tblStart + 6;
    const tblRegex = /<(\/)?w:tbl([\s>])/g;
    tblRegex.lastIndex = pos;

    let match;
    while ((match = tblRegex.exec(docXml)) !== null) {
      const isClose = match[1] === '/';
      if (isClose) {
        depth--;
        if (depth === 0) {
          return match.index + match[0].length;
        }
      } else {
        depth++;
      }
    }
    return -1;
  }

  /**
   * Find matching closing </w:tc> tag for a table cell starting at tcStart, taking nested tables/cells into account.
   * Returns the index where </w:tc> begins.
   */
  private findMatchingCellEnd(docXml: string, tcStart: number): number {
    let depth = 1;
    let pos = tcStart + 5;
    const tcRegex = /<(\/)?w:tc([\s>])/g;
    tcRegex.lastIndex = pos;

    let match;
    while ((match = tcRegex.exec(docXml)) !== null) {
      const isClose = match[1] === '/';
      if (isClose) {
        depth--;
        if (depth === 0) {
          return match.index;
        }
      } else {
        depth++;
      }
    }
    return -1;
  }

  /**
   * Set text value in the cell immediately following a label cell in a table
   */
  private setCellValueInNextCell(docXml: string, possibleHeaders: string[], newText: string): string {
    if (!newText && newText !== '0') return docXml;
    const labelIdx = this.findHeaderIndex(docXml, possibleHeaders);
    if (labelIdx === -1) return docXml;

    const labelTcEnd = docXml.indexOf('</w:tc>', labelIdx);
    if (labelTcEnd === -1) return docXml;

    const nextTcStart = docXml.indexOf('<w:tc', labelTcEnd);
    const nextTcEnd = docXml.indexOf('</w:tc>', nextTcStart);
    if (nextTcStart === -1 || nextTcEnd === -1) return docXml;

    const cellXml = docXml.substring(nextTcStart, nextTcEnd);
    const tcPrEnd = cellXml.indexOf('</w:tcPr>');
    const tcPr = tcPrEnd !== -1 ? cellXml.substring(0, tcPrEnd + 9) : '<w:tcPr><w:vAlign w:val="center"/></w:tcPr>';

    const lines = String(newText || '').split(/\r?\n/).filter(l => l.trim().length > 0);
    const newParas = (lines.length > 0 ? lines : ['']).map(line =>
      `<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${escapeXml(line)}</w:t></w:r></w:p>`
    ).join('');

    const updatedCell = tcPr + newParas;
    return docXml.substring(0, nextTcStart) + updatedCell + docXml.substring(nextTcEnd);
  }

  /**
   * Synthesize rich engineering narrative for Flash Report summary
   */
  public synthesizeInspectionSummary(inspection: any, project: any, itpFullRef?: string): string {
    const itpDoc = itpFullRef || inspection?.itpNumber || project?.itpNumber || 'approved ITP';
    const rfiNo = (inspection as any)?.notificationNo || (inspection as any)?.noiNumber || inspection?.reportNumber || (project as any)?.poNumber || '';
    const rfiPrefix = rfiNo ? `As per RFI No. ${rfiNo}, ` : 'As per RFI, ';

    const rawActs = (inspection?.activities || [])
      .map((a: any) => (a.activityName || '').split('\t')[0].replace(/^P\.O\.\s*item\(s\):?\s*/i, '').trim())
      .filter((n: string) => n.length > 2 && !n.toLowerCase().includes('p.o. item'));
    const uniqueActs = Array.from(new Set(rawActs));
    const actsStr = uniqueActs.length > 0 ? uniqueActs.join(', ') : 'Positive Material Identification';
    const pmiText = actsStr.toLowerCase().includes('positive material') || actsStr.toLowerCase().includes('pmi') ? 'PMI' : actsStr;

    const steps = (inspection?.activities || [])
      .map((a: any) => (a.clauseNumber || '').replace(',', '.').trim())
      .filter((c: string) => c && !c.includes('.2026') && !c.startsWith('Scope-') && !c.startsWith('Act-'));
    const stepNo = Array.from(new Set(steps)).join(', ') || 'as per ITP';
    const clauseStr = stepNo !== 'as per ITP' ? `as per ITP clause(s) ${stepNo}` : `as per approved ITP clause`;

    return `${rfiPrefix}IRP witnessed ${pmiText} ${clauseStr} and found acceptable.`;
  }

  /**
   * Build 4-column Flash Report attendees table rows
   */
  private buildFlashAttendeesXml(attendees: any[], inspector?: any, project?: any): string {
    let listToRender = (attendees && attendees.length > 0) ? [...attendees] : [];

    const blankRow = `<w:tr w:rsidR="00716511" w:rsidTr="00EB3EEF">
  <w:trPr><w:trHeight w:val="340"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="2615" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="2479" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="3040" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="2053" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
</w:tr>`;

    const rows = listToRender.map(a => {
      const org = a.company ? (a.representedOrg ? `${escapeXml(a.company)} (OBO ${escapeXml(a.representedOrg)})` : escapeXml(a.company)) : (escapeXml(a.representedOrg || ''));
      const contact = [a.email, a.phone].filter(Boolean).join(' / ') || 'NA';

      return `<w:tr w:rsidR="00716511" w:rsidTr="00EB3EEF">
  <w:trPr><w:trHeight w:val="340"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="2615" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(a.name || '')}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="2479" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(a.title || '')}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="3040" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${org}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="2053" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(contact)}</w:t></w:r>
    </w:p>
  </w:tc>
</w:tr>`;
    });

    if (rows.length === 0) {
      rows.push(blankRow);
    }
    return rows.join('\n');
  }

  /**
   * Build Details of Item Visit table rows in Table 2 for Flash Report formats
   */
  private buildTable2ItemRows(items: any[]): string {
    const offeredItems = (items || []).filter((i: any) => i.presentedQty > 0 || i.presentedQty === undefined);
    const listToRender = offeredItems.length > 0 ? offeredItems : (items || []);
    if (listToRender.length === 0) {
      return '';
    }

    return listToRender.map((item, idx) => {
      const poItem = escapeXml(item.poItemNo || `'${idx + 1}`);
      const tag = escapeXml(item.tagNumber || `Item-${idx + 1}`);
      const desc = escapeXml(item.itemName || item.itemDescription || 'Material');
      const ordered = String(item.orderedQty ?? 1);
      const presented = String(item.presentedQty ?? item.orderedQty ?? 1);
      const acceptedThisVisit = String(item.acceptedThisVisit ?? item.presentedQty ?? presented);
      const acceptedToDate = String(item.acceptedToDate ?? item.acceptedThisVisit ?? acceptedThisVisit);

      return `<w:tr w:rsidR="00737F9A" w:rsidTr="00BA3CA3">
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
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>${desc}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1441" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="2" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${ordered}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1275" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="2" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${presented}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1134" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="2" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${acceptedThisVisit}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1269" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${acceptedToDate}</w:t></w:r>
    </w:p>
  </w:tc>
</w:tr>`;
    }).join('\n');
  }

  /**
   * Build Flash Report Table 4 activities/results dynamic rows
   */
  private buildFlashActivitiesTableRows(items: any[], activities: any[]): string {
    const offeredItems = (items || []).filter((i: any) => i.presentedQty > 0);
    const listToRender = offeredItems.length > 0 ? offeredItems : (items || []);

    const actEntries: string[] = [];
    for (const act of (activities || [])) {
      const clause = (act.clauseNumber || '').replace(',', '.').trim();
      const rawName = (act.activityName || '')
        .split('\t')[0]
        .replace(/^P\.O\.\s*item\(s\):?\s*/i, '')
        .trim();
      if (!rawName || rawName.length < 3 || rawName.toLowerCase().includes('p.o. item')) continue;

      let code = '';
      const lower = rawName.toLowerCase();
      if (/pmi|positive material/i.test(lower)) code = 'PMI';
      else if (/visual/i.test(lower)) code = 'VI';
      else if (/dimens/i.test(lower)) code = 'D';
      else if (/hydro|pressure|leak/i.test(lower)) code = 'HT';
      else if (/paint|dft|coating/i.test(lower)) code = 'P';
      else if (/final/i.test(lower)) code = 'F';
      else if (/cert|document/i.test(lower)) code = 'R';
      else if (/magnet|residual/i.test(lower)) code = 'MP';
      else if (/balanc/i.test(lower)) code = 'Balancing';
      else if (/over\s*speed/i.test(lower)) code = 'Overspeed';
      else if (/hard/i.test(lower)) code = 'HDT';
      else if (/ultra/i.test(lower)) code = 'UT';
      else if (/penetr/i.test(lower)) code = 'PT';

      if (clause && !clause.includes('.2026') && !clause.startsWith('Scope-') && !clause.startsWith('Act-')) {
        actEntries.push(code ? `${clause} (${code})` : `${clause} (${rawName.substring(0, 20)})`);
      } else {
        actEntries.push(code || rawName.substring(0, 25));
      }
    }
    const actCodesStr = Array.from(new Set(actEntries)).join(', ') || 'Inspection as per ITP';

    const blankRow = `<w:tr w:rsidR="00B77D49" w:rsidTr="008030D9">
  <w:tblPrEx><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPrEx>
  <w:trPr><w:cantSplit/><w:trHeight w:val="432"/><w:jc w:val="center"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="1043" w:type="dxa"/><w:tcBorders><w:left w:val="single" w:sz="12" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="991" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="3150" w:type="dxa"/><w:gridSpan w:val="2"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t></w:t></w:r></w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="668" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1710" w:type="dxa"/><w:gridSpan w:val="2"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1350" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1260" w:type="dxa"/><w:tcBorders><w:right w:val="single" w:sz="12" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p>
  </w:tc>
</w:tr>`;

    const rows = listToRender.map((item, idx) => {
      const poItem = escapeXml(item.poItemNo || `'${idx + 1}`);
      const tag = escapeXml(item.tagNumber || `Item-${idx + 1}`);
      const desc = escapeXml(item.itemName || item.itemDescription || 'Control Valve');
      const qty = String(item.presentedQty || item.orderedQty || 1);
      const accept = String(item.acceptedThisVisit || item.presentedQty || qty);
      const reject = '-';

      return `<w:tr w:rsidR="00B77D49" w:rsidTr="008030D9">
  <w:tblPrEx><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPrEx>
  <w:trPr><w:cantSplit/><w:trHeight w:val="432"/><w:jc w:val="center"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="1043" w:type="dxa"/><w:tcBorders><w:left w:val="single" w:sz="12" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${poItem}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="991" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>${tag}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="3150" w:type="dxa"/><w:gridSpan w:val="2"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${desc}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="668" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${qty}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1710" w:type="dxa"/><w:gridSpan w:val="2"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${actCodesStr}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1350" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${accept}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1260" w:type="dxa"/><w:tcBorders><w:right w:val="single" w:sz="12" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${reject}</w:t></w:r>
    </w:p>
  </w:tc>
</w:tr>`;
    });

    while (rows.length < 7) {
      rows.push(blankRow);
    }
    return rows.join('\n');
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
   * Build 5-column Materials Offered table rows (Table 6 format: PO Item No, Tag Number, Description, Quantity, ITP Step #)
   */
  private buildFiveColumnMaterialRowsXml(items: any[], defaultItpStep = 'VISUAL AND DIMENSION'): string {
    const offeredItems = (items || []).filter((i: any) => i.presentedQty > 0);
    const listToRender = offeredItems.length > 0 ? offeredItems : (items || []);

    const blankRow = `<w:tr w:rsidR="00925296" w:rsidTr="00FF4246">
  <w:trPr><w:trHeight w:val="312"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="1260" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="2160" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="990" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1170" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
</w:tr>`;

    const rows = listToRender.map((item, idx) => {
      const itemNo = escapeXml(item.poItemNo || String(idx + 1));
      const tag = escapeXml(item.tagNumber || item.materialCode || 'SODS25195');
      const desc = escapeXml(item.itemName || item.itemDescription || 'VALVE ITEM');
      const qty = escapeXml(String(item.presentedQty || item.orderedQty || 1));
      const step = escapeXml(item.itpStep || defaultItpStep);

      return `<w:tr w:rsidR="00925296" w:rsidTr="00FF4246">
  <w:trPr><w:trHeight w:val="312"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="1260" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${itemNo}</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="2160" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${tag}</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${desc}</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="990" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${qty}</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1170" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${step}</w:t></w:r></w:p></w:tc>
</w:tr>`;
    });

    if (rows.length === 0) {
      rows.push(blankRow);
    }
    return rows.join('\n');
  }

  /**
   * Build 3-column Measuring Instruments & Calibration table rows (Table 11: Identification No, Description, Calibration Due Date)
   */
  private buildThreeColInstrumentRowsXml(instruments: any[]): string {
    const list = (instruments && instruments.length > 0) ? instruments : [
      { instrumentName: 'Vernier Caliper', description: '', expiryDate: null },
      { instrumentName: 'PMI Machine', description: 'SciAps   X200', expiryDate: '2027-07-13' }
    ];

    return list.map((inst: any) => {
      const name = escapeXml(inst.instrumentName || inst.name || 'Instrument');
      const desc = escapeXml(inst.description || inst.model || '');
      let due = '';
      if (inst.expiryDate) {
        const d = new Date(inst.expiryDate);
        due = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
      } else {
        due = inst.calibrationDue || '13-07-2027';
      }

      return `<w:tr w:rsidR="006318D2" w:rsidTr="00B8677D">
  <w:trPr><w:cantSplit/><w:trHeight w:val="350"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="4281" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${name}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="4153" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${desc}</w:t></w:r>
    </w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="2366" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${due}</w:t></w:r>
    </w:p>
  </w:tc>
</w:tr>`;
    }).join('\n');
  }

  /**
   * Build Applicable Standards table rows (Table 4)
   */
  private buildStandardsRowsXml(standards?: any[]): string {
    const rawList = standards && standards.length > 0 ? [...standards] : [
      { docNo: 'ASTM A961', rev: '', description: '' }
    ];
    const list = rawList.map(s => typeof s === 'string' ? { docNo: s, rev: '', description: '' } : s);
    while (list.length < 3) {
      list.push({ docNo: '', rev: '', description: '' });
    }

    return list.map(s => {
      const docNo = escapeXml(s.docNo || s.code || '');
      const rev = escapeXml(s.rev || s.revision || '');
      const desc = escapeXml(s.description || '');

      return `<w:tr w:rsidR="00214C7C" w:rsidTr="00975E73">
  <w:trPr><w:cantSplit/><w:trHeight w:val="282"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="3082" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${docNo}</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1418" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${rev}</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="5760" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${desc}</w:t></w:r></w:p></w:tc>
</w:tr>`;
    }).join('\n');
  }

  /**
   * Build Applicable Drawings / Documents table rows (Table 5)
   */
  private buildDrawingsRowsXml(drawings?: any[], itpNo?: string, itpRev?: string): string {
    const defaultList = [
      { docNo: itpNo || 'PNC105- PMVALVEITP', rev: itpRev || '5', statusNmdc: '', statusCompany: '', description: 'ITP' },
      { docNo: '2745-73004AC-J005-019- Manual Valves Drawing', rev: '', statusNmdc: '', statusCompany: '', description: '' }
    ];
    const rawList = drawings && drawings.length > 0 ? [...drawings] : defaultList;
    const list = rawList.map(d => typeof d === 'string' ? { docNo: d, rev: '', statusNmdc: '', statusCompany: '', description: '' } : d);
    while (list.length < 2) {
      list.push({ docNo: '', rev: '', statusNmdc: '', statusCompany: '', description: '' });
    }

    return list.map(d => {
      const docNo = escapeXml(d.docNo || d.no || '');
      const rev = escapeXml(d.rev || d.revision || '');
      const statusNmdc = escapeXml(d.statusNmdc || '');
      const statusCompany = escapeXml(d.statusCompany || '');
      const desc = escapeXml(d.description || d.title || '');

      return `<w:tr w:rsidR="00932337" w:rsidTr="00932337">
  <w:trPr><w:cantSplit/><w:trHeight w:val="269"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="3082" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${docNo}</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="993" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${rev}</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1325" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${statusNmdc}</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1440" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${statusCompany}</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="3420" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${desc}</w:t></w:r></w:p></w:tc>
</w:tr>`;
    }).join('\n');
  }

  /**
   * Build ITP Stage Results table rows (Table 8)
   */
  private buildItpStageRowsXml(itpFullRef: string, stages?: any[]): string {
    const defaultStage = itpFullRef.includes('REV') ? itpFullRef : `${itpFullRef} REV :-5`;
    const rawList = stages && stages.length > 0 ? [...stages] : [];
    const list = rawList.map(st => typeof st === 'string' ? { itpRef: itpFullRef, stage: '', description: st, results: 'Acceptable' } : st);
    if (list.length === 0) {
      list.push({ itpRef: defaultStage, stage: '', description: '', results: '' });
    }
    while (list.length < 3) {
      list.push({ itpRef: '', stage: '', description: '', results: '' });
    }

    return list.map(st => {
      const ref = escapeXml(st.itpRef || '');
      const stage = escapeXml(st.stage || '');
      const desc = escapeXml(st.description || '');
      const res = escapeXml(st.results || '');

      return `<w:tr w:rsidR="00A14488" w:rsidTr="00ED7709">
  <w:trPr><w:cantSplit/><w:trHeight w:val="282"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="3060" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${ref}</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="990" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${stage}</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="3617" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${desc}</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="2593" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>${res}</w:t></w:r></w:p></w:tc>
</w:tr>`;
    }).join('\n');
  }

  /**
   * Build Table 11 Row 1: 4.1- RESULTS OF TESTS AND INSPECTION content
   */
  private buildTestResultsRowXml(activities: any[], items: any[], results: any[]): string {
    const defaultItemsText = (items || []).map((i: any) => i.tagNumber || i.itemName).filter(Boolean).join(', ') || 'offered equipment / materials';
    const paras: string[] = [];

    if (activities && activities.length > 0) {
      for (const act of activities) {
        const clause = act.clauseNumber ? `Clause ${act.clauseNumber}` : 'Clause / ITP Stage';
        const actName = act.activityName || 'Inspection Activity';
        const res = (results || []).find((r: any) => r.activityId === act.id);

        let findingsText = '';
        if (res && res.remarks) {
          findingsText = res.remarks;
        } else if (/PMI|Positive Material/i.test(actName)) {
          findingsText = `Witnessed Positive Material Identification (PMI) on casing, pipe material including welds for Item(s): ${defaultItemsText}. Testing was performed utilizing a calibrated PMI Analyzer (SciAps X200). Material chemical composition, key alloying elements (Cr, Ni, Mo, etc.), and alloy grades were verified against approved Material Test Certificates (MTCs) and applicable ASME/ASTM specifications. Results: Conform to requirements - ACCEPTABLE.`;
        } else if (/Hydro|Pressure|Leak/i.test(actName)) {
          findingsText = `Witnessed pressure / leak testing for Item(s): ${defaultItemsText} in accordance with approved test procedures and project specifications. Test pressure held for the designated holding period with zero pressure drop and zero leakage observed. Results: ACCEPTABLE.`;
        } else if (/Visual|Dimension/i.test(actName)) {
          findingsText = `Carried out visual and dimensional examination on Item(s): ${defaultItemsText}. Dimensions, flange faces, wall thickness, bevel ends, markings, and overall workmanship verified against approved fabrication drawings. Results: ACCEPTABLE.`;
        } else if (/Hardness/i.test(actName)) {
          findingsText = `Witnessed hardness testing on parent metal and weld heat-affected zones for Item(s): ${defaultItemsText}. Recorded hardness values were verified within project specified limits. Results: ACCEPTABLE.`;
        } else {
          findingsText = `Witnessed and verified ${actName} for Item(s): ${defaultItemsText} in full accordance with approved ITP requirements and project specifications. All quality parameters and acceptance criteria were witnessed and verified. Results: ACCEPTABLE.`;
        }

        paras.push(`<w:p>
  <w:pPr><w:spacing w:after="40" w:line="240" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="en-US"/></w:rPr></w:pPr>
  <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="en-US"/></w:rPr><w:t xml:space="preserve">${escapeXml(clause)} - ${escapeXml(actName)}: </w:t></w:r>
</w:p>
<w:p>
  <w:pPr><w:spacing w:after="100" w:line="240" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="en-US"/></w:rPr></w:pPr>
  <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="en-US"/></w:rPr><w:t>${escapeXml(findingsText)}</w:t></w:r>
</w:p>`);
      }
    } else {
      paras.push(`<w:p>
  <w:pPr><w:spacing w:after="60" w:line="240" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="en-US"/></w:rPr></w:pPr>
  <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="en-US"/></w:rPr><w:t>Witnessed inspection and testing of presented materials and equipment in accordance with approved ITP clauses and project specifications. All parameters, dimensions, and test results were verified and found acceptable.</w:t></w:r>
</w:p>`);
    }

    return `<w:tr w:rsidR="00316468" w:rsidRPr="00316468" w:rsidTr="00316468">
  <w:tc><w:tcPr><w:tcW w:w="10762" w:type="dxa"/></w:tcPr>
  ${paras.join('\n')}
  </w:tc>
</w:tr>`;
  }

  /**
   * Build Table 11 Row 3: 5- CERTIFICATION REVIEWED AND/OR SIGNED content
   */
  private buildCertificationReviewedRowXml(certNotes?: string): string {
    const defaultNotes = [
      '1. Reviewed and verified Vendor Material Test Certificates (EN 10204 Type 3.1 / 3.2) for casing, pipe materials, and consumables against approved project specifications; chemical analysis and mechanical test properties found fully compliant.',
      '2. Reviewed calibration certificates of measuring & test equipment (SciAps X200 PMI Machine, Vernier Calipers, Pressure Gauges) and confirmed all instruments are valid within their calibration validity period.',
      '3. Verified Quality Control records, NDT operator qualifications, and welding procedure specifications (WPS/PQR). Inspection & Test Plan (ITP) stage witness signed and endorsed.'
    ];

    const notesList = certNotes ? [certNotes] : defaultNotes;
    const paras = notesList.map(n => `<w:p>
  <w:pPr><w:spacing w:after="60" w:line="240" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="en-US"/></w:rPr></w:pPr>
  <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="en-US"/></w:rPr><w:t>${escapeXml(n)}</w:t></w:r>
</w:p>`);

    return `<w:tr w:rsidR="00316468" w:rsidRPr="00316468" w:rsidTr="00AA785D">
  <w:tc><w:tcPr><w:tcW w:w="10762" w:type="dxa"/></w:tcPr>
  ${paras.join('\n')}
  </w:tc>
</w:tr>`;
  }

  /**
   * Populate Table 1 for Wood P5-DBN inspection report template
   */
  private populateWoodTable1(
    docXml: string,
    inspection: any,
    project: any,
    dateStr: string,
    rfiExtracted: any
  ): string {
    const reportNoIdx = docXml.indexOf('REPORT NO.');
    if (reportNoIdx === -1) return docXml;
    const tblStart = this.findPrecedingTableStart(docXml, reportNoIdx);
    const tblEnd = this.findMatchingTableEnd(docXml, tblStart);
    if (tblStart === -1 || tblEnd === -1) return docXml;

    let t1Xml = docXml.substring(tblStart, tblEnd);
    const rows = [...t1Xml.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map(m => m[0]);
    if (rows.length < 8) return docXml;

    const effectiveNotificationNo = (inspection as any).notificationNo ||
      (inspection as any).noiNumber ||
      rfiExtracted.notificationNo ||
      rfiExtracted.rfiNumber ||
      '';

    const effectiveReportNo = (inspection.reportNumber && inspection.reportNumber !== '001')
      ? inspection.reportNumber
      : (effectiveNotificationNo || 'P5-DBN-Vendor PO #- Vendor Name-IR-XXXX');

    const effectiveContractNo = project.projectNumber && project.projectNumber !== 'Not specified'
      ? project.projectNumber
      : (rfiExtracted.projectNumber || 'PROJECT 5.0 (P5)');

    const effectiveClientName = project.customerName ||
      rfiExtracted.clientName ||
      rfiExtracted.customerName ||
      'ADNOC GAS';

    let equipmentDesc = inspection.materialDescription ||
      rfiExtracted.materialDescription ||
      (inspection.items && inspection.items.length > 0
        ? inspection.items.map((i: any) => i.tagNumber || i.itemName).filter(Boolean).join(', ')
        : 'POSITIVE MATERIAL IDENTIFICATION ON CASING, PIPE MATERIAL INCLUDING WELDS');

    const mrNoAndClass = (inspection as any).mrNumber ||
      rfiExtracted.mrNumber ||
      (inspection as any).inspectionClass ||
      'Class 1 / MR-001';

    const effectiveVendor = project.supplierName ||
      rfiExtracted.vendorName ||
      rfiExtracted.supplierName ||
      'Triveni Turbines Limited';

    let effectiveOrderNo = project.poNumber && project.poNumber !== 'Not specified'
      ? project.poNumber
      : (rfiExtracted.poNumber && rfiExtracted.poNumber !== 'Not specified' ? rfiExtracted.poNumber : '');
    if (!effectiveOrderNo) {
      const poMatch = (inspection.reportNumber || effectiveNotificationNo).match(/PO\.?([0-9A-Za-z_-]+)/i);
      effectiveOrderNo = poMatch ? poMatch[1] : '608200';
    }

    const effectiveSubVendor = rfiExtracted.subVendor ||
      project.supplierName ||
      effectiveVendor;

    const orderDate = rfiExtracted.orderDate || dateStr;

    const addressForOrder = project.supplierAddress ||
      rfiExtracted.supplierAddress ||
      '12A, Peenya Industrial Area, Bangalore - 560 058';

    const subOrderNo = rfiExtracted.subOrderNo || 'NA';

    const inspectionLocation = inspection.location ||
      project.supplierAddress ||
      'Meladoor, Annamanada, Kerala, India';

    const inspectorName = inspection.inspector?.fullName ||
      (inspection as any).inspectorName ||
      rfiExtracted.inspectorName ||
      'Adarsh MS';

    const inspectionAgency = inspection.inspector?.organization ||
      (inspection as any).inspectionAgency ||
      rfiExtracted.inspectionAgency ||
      'Intertek';

    const stageInspection = (inspection.activities && inspection.activities.length > 0)
      ? inspection.activities.map((a: any) => a.activityName).slice(0, 2).join(' / ')
      : (rfiExtracted.stageInspection || 'Witness / PMI');

    const nextVisitDate = inspection.nextVisitDate
      ? new Date(inspection.nextVisitDate).toLocaleDateString('en-GB')
      : 'NA';

    // Process each row
    for (let r = 0; r < 8; r++) {
      const cells = [...rows[r].matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map(m => m[0]);
      if (r === 0 && cells.length >= 4) {
        // Cell 1: Report No (replace placeholder and strip highlight)
        cells[1] = this.fillCellParagraph(cells[1], effectiveReportNo, 0, true);
        cells[1] = cells[1].replace(/<w:highlight\s+w:val="[^"]*"\/>/g, '');
        // Cell 2: CONTRACT
        cells[2] = `<w:tc><w:tcPr><w:tcW w:w="2691" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:bCs/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t xml:space="preserve">CONTRACT : ${escapeXml(effectiveContractNo)}</w:t></w:r></w:p></w:tc>`;
        // Cell 3: CLIENT
        cells[3] = `<w:tc><w:tcPr><w:tcW w:w="2691" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:bCs/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t xml:space="preserve">CLIENT : ${escapeXml(effectiveClientName)}</w:t></w:r></w:p></w:tc>`;
      } else if (r === 1 && cells.length >= 4) {
        // Cell 1: Equipment description
        cells[1] = this.fillCellParagraph(cells[1], equipmentDesc, 0, false);
        // Cell 3: MR NO / INSPECTION CLASS
        cells[3] = this.fillCellParagraph(cells[3], mrNoAndClass, 0, false);
      } else if (r === 2 && cells.length >= 4) {
        // Cell 1: VENDOR
        cells[1] = this.fillCellParagraph(cells[1], effectiveVendor, 0, false);
        // Cell 3: ORDER NO
        cells[3] = this.fillCellParagraph(cells[3], effectiveOrderNo, 0, false);
      } else if (r === 3 && cells.length >= 4) {
        // Cell 1: SUB VENDOR
        cells[1] = this.fillCellParagraph(cells[1], effectiveSubVendor, 0, false);
        // Cell 3: ORDER DATE
        cells[3] = this.fillCellParagraph(cells[3], orderDate, 0, false);
      } else if (r === 4 && cells.length >= 4) {
        // Cell 1: ADDRESS FOR ORDER
        cells[1] = this.fillCellParagraph(cells[1], addressForOrder, 0, false);
        // Cell 3: SUB ORDER NO
        cells[3] = this.fillCellParagraph(cells[3], subOrderNo, 0, false);
      } else if (r === 5 && cells.length >= 2) {
        // Cell 1: INSPECTION LOCATION
        cells[1] = this.fillCellParagraph(cells[1], inspectionLocation, 0, false);
      } else if (r === 6 && cells.length >= 4) {
        // Cell 0: INSPECTOR NAME
        cells[0] = this.fillCellParagraph(cells[0], inspectorName, 1, false);
        // Cell 2: DATE OF VISIT
        cells[2] = this.fillCellParagraph(cells[2], dateStr, 1, false);
        // Cell 3: INSPECTION AGENCY
        cells[3] = this.fillCellParagraph(cells[3], inspectionAgency, 1, false);
      } else if (r === 7 && cells.length >= 4) {
        // Cell 0: NOTIFICATION NUMBER
        cells[0] = this.fillCellParagraph(cells[0], effectiveNotificationNo || effectiveReportNo, 1, false);
        // Cell 1: STAGE INSPECTION
        cells[1] = this.fillCellParagraph(cells[1], stageInspection, 1, false);
        // Cell 2: DATE OF NEXT VISIT
        cells[2] = this.fillCellParagraph(cells[2], nextVisitDate, 1, false);
      }

      const trPrMatch = rows[r].match(/<w:trPr[\s\S]*?<\/w:trPr>/);
      const trPr = trPrMatch ? trPrMatch[0] : '';
      const trOpenMatch = rows[r].match(/<w:tr(\s[^>]*)?>/);
      const trOpen = trOpenMatch ? trOpenMatch[0] : '<w:tr>';
      rows[r] = `${trOpen}${trPr}${cells.join('')}</w:tr>`;
    }

    const tblPrMatch = t1Xml.match(/<w:tblPr[\s\S]*?<\/w:tblPr>/);
    const tblPr = tblPrMatch ? tblPrMatch[0] : '';
    const tblGridMatch = t1Xml.match(/<w:tblGrid[\s\S]*?<\/w:tblGrid>/);
    const tblGrid = tblGridMatch ? tblGridMatch[0] : '';
    const tblOpenMatch = t1Xml.match(/<w:tbl(\s[^>]*)?>/);
    const tblOpen = tblOpenMatch ? tblOpenMatch[0] : '<w:tbl>';

    const newT1Xml = `${tblOpen}${tblPr}${tblGrid}${rows.join('')}</w:tbl>`;
    return docXml.substring(0, tblStart) + newT1Xml + docXml.substring(tblEnd);
  }

  private fillCellParagraph(tcXml: string, text: string, paraIndex: number = 0, isBold: boolean = false): string {
    const pMatches = [...tcXml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)];
    if (pMatches.length === 0) return tcXml;
    const targetP = pMatches[paraIndex] || pMatches[pMatches.length - 1];
    const targetPXml = targetP[0];

    const pPrMatch = targetPXml.match(/<w:pPr[\s\S]*?<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[0] : '<w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr>';

    const boldXml = isBold ? '<w:b/><w:bCs/>' : '';
    const newP = `<w:p>${pPr}<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>${boldXml}<w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;

    return tcXml.replace(targetPXml, newP);
  }

  private appendToLastParagraph(tcXml: string, text: string, isBold: boolean = true): string {
    const pMatches = [...tcXml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)];
    if (pMatches.length === 0) return tcXml;
    const targetPXml = pMatches[pMatches.length - 1][0];
    const pEndIdx = targetPXml.lastIndexOf('</w:p>');
    if (pEndIdx === -1) return tcXml;

    const boldXml = isBold ? '<w:b/><w:bCs/>' : '';
    const runXml = `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>${boldXml}<w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t xml:space="preserve"> ${escapeXml(text)}</w:t></w:r>`;
    const newP = targetPXml.substring(0, pEndIdx) + runXml + '</w:p>';
    return tcXml.replace(targetPXml, newP);
  }

  /**
   * Build Generic Materials table rows (Table 6)
   */
  private buildGenericMaterialRowsXml(items: any[]): string {
    const offeredItems = (items || []).filter((i: any) => i.presentedQty > 0);
    const listToRender = offeredItems.length > 0 ? offeredItems : (items || []);

    const blankRow = `<w:tr w:rsidR="00BA3CA3" w:rsidRPr="007863FA" w:rsidTr="003A37F9">
  <w:trPr><w:cantSplit/><w:trHeight w:val="429"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="3185" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="2" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p>
  </w:tc>
  <w:tc><w:tcPr><w:tcW w:w="7592" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="2" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p>
  </w:tc>
</w:tr>`;

    const rows = listToRender.map((item, idx) => {
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
    });

    if (rows.length === 0) {
      rows.push(blankRow);
    }
    return rows.join('\n');
  }

  /**
   * Build Materials Inspected table rows (Table 7)
   */
  private buildMaterialRowsXml(items: any[]): string {
    const offeredItems = (items || []).filter((i: any) => i.presentedQty > 0);
    const listToRender = offeredItems.length > 0 ? offeredItems : (items || []);

    const blankRow = `<w:tr w:rsidR="00737F9A" w:rsidTr="00BA3CA3">
  <w:trPr><w:cantSplit/><w:trHeight w:val="450"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="1145" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1701" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="2835" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1441" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1275" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1134" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1269" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
</w:tr>`;

    const rows = listToRender.map((item, idx) => {
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
    });

    if (rows.length === 0) {
      rows.push(blankRow);
    }
    return rows.join('\n');
  }

  /**
   * Build Scope of Inspection table rows (ONLY attended activities)
   */
  private buildScopeRowsXml(inspection: any, activities: any[]): string {
    // Only offered items
    const offeredItems = (inspection.items || []).filter((i: any) => i.presentedQty > 0 || i.presentedQty === undefined);
    const itemsStr = escapeXml((offeredItems.length ? offeredItems : inspection.items)?.map((i: any) => i.tagNumber).join(', ') || 'Control Valve');

    const blankRow = `<w:tr w:rsidR="00737F9A">
  <w:trPr><w:cantSplit/><w:trHeight w:val="333"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="1006" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="2835" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="3119" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="2670" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="1147" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
</w:tr>`;

    const rows = activities.map((act: any) => {
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
          resultText = result.status === 'ACCEPTABLE' || !result.status ? 'Acceptable' : (result.status === 'PENDING' ? 'Conform to approved ITP / Acceptable' : result.status);
        }
      } else if (act.status) {
        if (isPaintingOrDft) {
          resultText = 'Acceptable - DFT within limits';
        } else {
          resultText = act.status === 'ACCEPTABLE' ? 'Acceptable' : (act.status === 'PENDING' ? 'Conform to approved ITP / Acceptable' : act.status);
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
    });

    if (rows.length === 0) {
      rows.push(blankRow);
    }
    return rows.join('\n');
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
    const listToRender = (attendees && attendees.length > 0) ? [...attendees] : [];

    const blankRow = `<w:tr w:rsidR="00737F9A">
  <w:trPr><w:cantSplit/><w:trHeight w:val="320"/></w:trPr>
  <w:tc><w:tcPr><w:tcW w:w="3119" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="3898" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="3783" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t></w:t></w:r></w:p></w:tc>
</w:tr>`;

    const rows = listToRender.map(a => {
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
    });

    if (rows.length === 0) {
      rows.push(blankRow);
    }
    return rows.join('\n');
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
   * Resolve photo path checking direct path and multiple fallback storage candidate directories
   */
  private resolvePhotoPath(storageKey: string): string {
    if (!storageKey) return '';
    if (fs.existsSync(storageKey)) return storageKey;
    const resolved = path.resolve(storageKey);
    if (fs.existsSync(resolved)) return resolved;
    const base = path.basename(storageKey);
    const storageDir = process.env.STORAGE_DIR || path.resolve(__dirname, '../../../storage');
    const candidates = [
      path.join(storageDir, 'photos', base),
      path.join(process.cwd(), 'storage', 'photos', base),
      path.resolve(__dirname, '../../storage/photos', base),
      path.resolve(__dirname, '../storage/photos', base),
      path.resolve(__dirname, '../../../storage/photos', base),
    ];
    for (const cand of candidates) {
      if (cand && fs.existsSync(cand)) return cand;
    }
    return '';
  }

  /**
   * Embed uploaded photos into Word DOCX and build clean 2-column photo table.
   * Keeps natural aspect ratio for landscape without stretching; adjusts portrait photos.
   * Returns both full tableXml and inner rowsXml for preserving template table header rows.
   */
  private async embedUploadedPhotos(zip: JSZip, photos: any[]): Promise<{ tableXml: string; rowsXml: string; hasPhotos: boolean }> {
    // 1. Update relationships
    const relsPath = 'word/_rels/document.xml.rels';
    let relsXml = await zip.file(relsPath)!.async('string');

    const photoCards: { rId: string; caption: string; cx: number; cy: number }[] = [];

    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      try {
        const filePath = this.resolvePhotoPath(p.storageKey);
        let buf: Buffer | null = null;
        if (filePath && fs.existsSync(filePath)) {
          try {
            buf = fs.readFileSync(filePath);
          } catch {}
        }

        if (buf) {
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
            cy = Math.round(cx * (height / width));
          } else {
            cy = 2100000;
            cx = Math.round(cy * (width / height));
          }

          photoCards.push({
            rId,
            caption: p.caption || p.category || `Inspection Photo ${i + 1}`,
            cx,
            cy,
          });
        } else {
          // File not locally accessible, preserve photo card caption
          photoCards.push({
            rId: '',
            caption: p.caption || p.category || `Inspection Photo ${i + 1}`,
            cx: 2800000,
            cy: 2100000,
          });
        }
      } catch { /* skip invalid photo */ }
    }

    zip.file(relsPath, relsXml);

    if (photoCards.length === 0) {
      return {
        tableXml: `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>No photographs attached for this inspection report.</w:t></w:r></w:p>`,
        rowsXml: '',
        hasPhotos: false,
      };
    }

    // 2. Build 2-column table
    let rowsXml = '';
    for (let i = 0; i < photoCards.length; i += 2) {
      const left = photoCards[i];
      const right = photoCards[i + 1];

      // Row of images
      const leftImg = left.rId
        ? this.buildImageXml(left.rId, i * 2 + 100, left.cx, left.cy)
        : `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:i/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t xml:space="preserve">[Photo Attached: ${escapeXml(left.caption)}]</w:t></w:r>`;
      const rightImg = right
        ? (right.rId
          ? this.buildImageXml(right.rId, i * 2 + 101, right.cx, right.cy)
          : `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:i/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t xml:space="preserve">[Photo Attached: ${escapeXml(right.caption)}]</w:t></w:r>`)
        : '';

      rowsXml += `<w:tr w:rsidR="00ED010A">
  <w:tc><w:tcPr><w:tcW w:w="5395" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${leftImg}</w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="5395" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${rightImg}</w:p></w:tc>
</w:tr>`;

      // Row of captions
      rowsXml += `<w:tr w:rsidR="00ED010A">
  <w:tc><w:tcPr><w:tcW w:w="5395" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(left.caption)}</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:tcW w:w="5395" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>${right ? escapeXml(right.caption) : ''}</w:t></w:r></w:p></w:tc>
</w:tr>`;
    }

    const tableXml = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="10790" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="5395"/><w:gridCol w:w="5395"/></w:tblGrid>${rowsXml}</w:tbl>`;

    return { tableXml, rowsXml, hasPhotos: true };
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
            reportNumber: inspection.reportNumber || '2745-2024-73004-AC-IR-001',
            reportDate: dateStr,
            customerName: project.customerName || 'ADNOC OFFSHORE',
            jobNo: project.projectNumber || project.jobNo || '2745',
            rev: inspection.revisionNumber || '0',
            poNumber: project.poNumber || '',
            vendorName: project.supplierName || '',
          });
        } else if (file.includes('footer')) {
          content = this.updateFooterXml(content, dateStr, inspection.inspector?.fullName || 'Jithin KB');
        }

        zip.file(file, content);
      } catch (err) {
        console.error(`Error updating header/footer ${file}:`, err);
      }
    }
  }

  private updateHeaderXml(xml: string, values: { reportNumber: string; reportDate: string; customerName: string; jobNo: string; rev?: string; poNumber?: string; vendorName?: string }): string {
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

      const newTc = `${tcPr}<w:p><w:pPr><w:spacing w:before="40" w:after="40"/><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${escapeXml(newValue)}</w:t></w:r></w:p>`;

      result = result.substring(0, nextTcStart) + newTc + result.substring(nextTcEnd);
    }

    setCellAfter(/Report\s*No\s*:/i, values.reportNumber);
    setCellAfter(/Date\s*of\s*Report\s*:/i, values.reportDate);
    setCellAfter(/Customer\s*:/i, values.customerName);
    setCellAfter(/(EVO\s*)?Job\s*No\s*:/i, values.jobNo);

    // Safe direct text replacements for Wood P5-DBN and standard templates
    result = result.replace(/<w:t>IR-XXXX<\/w:t>/g, `<w:t>${escapeXml(values.reportNumber)}</w:t>`);
    result = result.replace(/<w:t>IR-XX<\/w:t>/g, `<w:t>${escapeXml(values.reportNumber)}</w:t>`);
    if (values.poNumber) {
      result = result.replace(/<w:t>Vendor PO #<\/w:t>/g, `<w:t>${escapeXml(values.poNumber)}</w:t>`);
    }
    if (values.vendorName) {
      result = result.replace(/<w:t>Vendor Name<\/w:t>/g, `<w:t>${escapeXml(values.vendorName)}</w:t>`);
    }
    result = result.replace(/<w:t>-IR-XXXX<\/w:t>/g, `<w:t>-${escapeXml(values.reportNumber)}</w:t>`);
    // Remove yellow highlights from header runs
    result = result.replace(/<w:highlight w:val="yellow"\/>/g, '');

    // For other templates with a single isolated cell containing IR-XX (safe regex that never crosses </w:tc>)
    const safeIrCellRegex = /<w:tc\b[^>]*>(?:(?!<\/w:tc>)[\s\S])*?\bIR-XX\b(?:(?!<\/w:tc>)[\s\S])*?<\/w:tc>/g;
    result = result.replace(safeIrCellRegex, (tcXml) => {
      if (tcXml.includes(values.reportNumber)) return tcXml;
      const tcPrMatch = tcXml.match(/<w:tcPr[\s\S]*?<\/w:tcPr>/);
      const tcPr = tcPrMatch ? tcPrMatch[0] : '<w:tcPr/>';
      return `<w:tc>${tcPr}<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="0070C0"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${escapeXml(values.reportNumber)}</w:t></w:r></w:p></w:tc>`;
    });

    // 2. Direct Rev cell replacement (cell following Rev #)
    const revLabelIdx = result.indexOf('Rev #');
    if (revLabelIdx !== -1) {
      const revTcEnd = result.indexOf('</w:tc>', revLabelIdx);
      if (revTcEnd !== -1) {
        const nextTcStart = result.indexOf('<w:tc', revTcEnd);
        const nextTcEnd = result.indexOf('</w:tc>', nextTcStart);
        if (nextTcStart !== -1 && nextTcEnd !== -1) {
          const nextTc = result.substring(nextTcStart, nextTcEnd + 7);
          const tcPrMatch = nextTc.match(/<w:tcPr[\s\S]*?<\/w:tcPr>/);
          const tcPr = tcPrMatch ? tcPrMatch[0] : '<w:tcPr/>';
          const newRevTc = `<w:tc>${tcPr}<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${escapeXml(values.rev || '0')}</w:t></w:r></w:p></w:tc>`;
          result = result.substring(0, nextTcStart) + newRevTc + result.substring(nextTcEnd + 7);
        }
      }
    }

    // 3. Direct Date cell replacement (cell following Date: in header)
    const dateLabelIdx = result.indexOf('Date:');
    if (dateLabelIdx !== -1) {
      const dateTcEnd = result.indexOf('</w:tc>', dateLabelIdx);
      if (dateTcEnd !== -1) {
        const nextTcStart = result.indexOf('<w:tc', dateTcEnd);
        const nextTcEnd = result.indexOf('</w:tc>', nextTcStart);
        if (nextTcStart !== -1 && nextTcEnd !== -1) {
          const nextTc = result.substring(nextTcStart, nextTcEnd + 7);
          const tcPrMatch = nextTc.match(/<w:tcPr[\s\S]*?<\/w:tcPr>/);
          const tcPr = tcPrMatch ? tcPrMatch[0] : '<w:tcPr/>';
          const newDateTc = `<w:tc>${tcPr}<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${escapeXml(values.reportDate)}</w:t></w:r></w:p></w:tc>`;
          result = result.substring(0, nextTcStart) + newDateTc + result.substring(nextTcEnd + 7);
        }
      }
    }

    return result;
  }

  private updateFooterXml(xml: string, footerDate: string, inspectorName: string = 'Jithin KB'): string {
    let result = xml;

    // 1. Inspector Name replacement
    result = result.replace(/(Inspector Name:\s*<\/w:t>\s*<\/w:r>\s*<w:r[^>]*>\s*<w:rPr>[\s\S]*?<\/w:rPr>\s*<w:t>)[^<]*(<\/w:t>)/g, `$1${escapeXml(inspectorName)}$2`);
    if (result.includes('Inspector Name:')) {
      const inspIdx = result.indexOf('Inspector Name:');
      const inspTcEnd = result.indexOf('</w:tc>', inspIdx);
      if (inspIdx !== -1 && inspTcEnd !== -1) {
        const cellXml = result.substring(inspIdx, inspTcEnd);
        if (!cellXml.includes(inspectorName)) {
          const insertRun = `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="0070C0"/><w:sz w:val="20"/></w:rPr><w:t>${escapeXml(inspectorName)}</w:t></w:r>`;
          const lastP = cellXml.lastIndexOf('</w:p>');
          if (lastP !== -1) {
            const updatedCell = cellXml.substring(0, lastP) + insertRun + cellXml.substring(lastP);
            result = result.substring(0, inspIdx) + updatedCell + result.substring(inspTcEnd);
          }
        }
      }
    }

    // 2. Date replacement
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

export const reportService = new ReportService();

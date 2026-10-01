import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import prisma from '../db/prisma';

export class DocumentService {
  /**
   * Extract raw text and metadata (page/sheet count) from various file formats:
   * .pdf, .docx, .doc, .xlsx, .xls, .csv
   */
  public async extractTextFromFile(filePath: string): Promise<{ rawText: string; pageCount: number }> {
    const absPath = path.resolve(filePath);
    const ext = path.extname(absPath).toLowerCase();

    if (ext === '.pdf') {
      const { PDFParse } = require('pdf-parse');
      const p = new PDFParse({ url: absPath });
      try {
        let pageCount = 1;
        try {
          const info = await p.getInfo();
          pageCount = info.total || 1;
        } catch { /* info optional */ }

        const textResult = await p.getText();
        let rawText = '';
        if (textResult.pages) {
          rawText = textResult.pages.map((pg: any) => pg.text || '').join('\n\n');
        } else if (typeof textResult === 'string') {
          rawText = textResult;
        } else {
          rawText = JSON.stringify(textResult);
        }
        return { rawText, pageCount };
      } finally {
        await p.destroy();
      }
    }

    if (ext === '.xlsx' || ext === '.xls') {
      const wb = XLSX.readFile(absPath);
      let rawText = '';
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        rawText += `\n--- Sheet: ${sheetName} ---\n` + csv + '\n';
      }
      return { rawText, pageCount: wb.SheetNames.length };
    }

    if (ext === '.csv') {
      const rawText = fs.readFileSync(absPath, 'utf8');
      return { rawText, pageCount: 1 };
    }

    if (ext === '.doc' || ext === '.docx') {
      try {
        const WordExtractor = require('word-extractor');
        const extractor = new WordExtractor();
        const extracted = await extractor.extract(absPath);
        const rawText = [
          extracted.getHeaders({ includeFooters: false }),
          extracted.getBody(),
          extracted.getFooters()
        ].filter(Boolean).join('\n\n');
        return { rawText: rawText || extracted.getBody(), pageCount: 1 };
      } catch (docErr) {
        // Fallback for docx using JSZip
        if (ext === '.docx') {
          const JSZip = require('jszip');
          const zip = await JSZip.loadAsync(fs.readFileSync(absPath));
          const xml = await zip.file('word/document.xml')?.async('string');
          if (xml) {
            const rawText = xml
              .replace(/<w:br[^>]*\/?>/gi, '\n')
              .replace(/<w:tab[^>]*\/?>/gi, '\t')
              .replace(/<\/w:p>/gi, '\n')
              .replace(/<\/w:tr>/gi, '\n')
              .replace(/<\/w:tc>/gi, '\t')
              .replace(/<[^>]+>/g, '')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&apos;/g, "'");
            return { rawText, pageCount: 1 };
          }
        }
        throw docErr;
      }
    }

    // Default plain text fallback
    const rawText = fs.readFileSync(absPath, 'utf8');
    return { rawText, pageCount: 1 };
  }

  /**
   * Process a document: extract text from file (.pdf, .docx, .doc, .xlsx, .csv),
   * parse structured data, and save the extraction record.
   */
  async processDocument(documentId: string, filePath: string, documentType: string) {
    let extractedData: any = {};
    let rawText = '';
    let confidence = 0.85;

    const absPath = path.resolve(filePath);

    try {
      const extractResult = await this.extractTextFromFile(absPath);
      rawText = extractResult.rawText;
      const pageCount = extractResult.pageCount;

      // Update page count
      if (pageCount > 0) {
        await prisma.document.update({ where: { id: documentId }, data: { pageCount } }).catch(() => {});
      }

      // Parse based on document type
      if (documentType === 'RFI') {
        extractedData = this.parseRFI(rawText);
        confidence = 0.92;
      } else if (documentType === 'ITP') {
        extractedData = this.parseITP(rawText);
        confidence = 0.90;
      } else if (documentType === 'CALIBRATION_CERTIFICATE') {
        extractedData = this.parseCalibration(rawText);
        confidence = 0.88;
      } else if (documentType === 'OFFER_LIST' || documentType === 'OFFER_LETTER') {
        extractedData = this.parseOfferList(rawText);
        confidence = 0.95;
      } else {
        extractedData = {
          documentType,
          textPreview: rawText.substring(0, 2000),
          totalLength: rawText.length,
        };
      }
    } catch (err: any) {
      console.error('Document extraction error:', err.message);
      extractedData = { error: err.message, documentType };
      confidence = 0.0;
    }

    // Save extraction
    const extraction = await prisma.documentExtraction.create({
      data: {
        documentId,
        extractedData: JSON.stringify(extractedData),
        rawText: rawText.substring(0, 50000), // Limit stored text
        confidence,
      },
    });

    return { ...extraction, extractedData };
  }

  /**
   * Extract data directly from file without database persistence (useful for preview/testing)
   */
  public async extractDataFromPDF(filePath: string, documentType: string): Promise<any> {
    return this.extractDataFromFile(filePath, documentType);
  }

  public async extractDataFromFile(filePath: string, documentType: string): Promise<any> {
    const { rawText } = await this.extractTextFromFile(filePath);
    if (documentType === 'RFI') return this.parseRFI(rawText);
    if (documentType === 'ITP') return this.parseITP(rawText);
    if (documentType === 'CALIBRATION_CERTIFICATE') return this.parseCalibration(rawText);
    if (documentType === 'OFFER_LIST' || documentType === 'OFFER_LETTER') return this.parseOfferList(rawText);
    return { rawText };
  }

  /**
   * Parse RFI document text to extract structured fields
   */
  public parseRFI(text: string): any {
    const result: any = { documentType: 'RFI' };

    // 1. Project Name (e.g. EPCM FOR BAB & BU HASA AiP5 OFF-PLOT FACILITIES PROJECT)
    const projNameMatch = text.match(/(EPCM\s+FOR\s+[A-Za-z0-9\s&]+?PROJECT)/i) ||
                          text.match(/(?:Project\s*Name|Subject)\s*[:,\s]+\s*([^\r\n,]+)/i);
    if (projNameMatch) result.projectName = projNameMatch[1].replace(/\s+/g, ' ').trim();

    // 2. Project number: P30350 or P30339B
    const projMatch = text.match(/PROJECT\s*No[.:,]*\s*(P\d{4,6}[A-Z]?)/i) ||
                      text.match(/(?:Project\s*No[.:,]*|Project:)\s*(P\d{4,6}\w*)/i);
    if (projMatch) result.projectNumber = projMatch[1].trim();

    // 3. RFI number: matches "RFI No: ...", "RFI-P30350...", or "P30339B-RFI-..."
    const rfiHeaderMatch = text.match(/RFI\s*No[.:,\s]*\s*([A-Za-z0-9\-_\s\n\/]+?)(?=\s+Rev|\s+Equipment|\s+Materials|,|\n\s*\n|$)/i);
    if (rfiHeaderMatch) {
      result.rfiNumber = rfiHeaderMatch[1].replace(/[\r\n\t\s]+/g, '').trim();
    } else {
      const fallbackRfi = text.match(/(?:(P\d+[A-Z]?-RFI-[A-Z0-9\-]+)|(RFI-[A-Za-z0-9\-]+))/i);
      if (fallbackRfi) result.rfiNumber = (fallbackRfi[1] || fallbackRfi[2]).trim();
    }

    // 4. PO Number: e.g. "VENDOR PO NO.: P-AiP5-12-IC15-003" or "04108-PM-INST-008"
    const poMatch = text.match(/VENDOR\s+PO\s+NO[.:,\s]*\s*([A-Za-z0-9\-]+)/i) ||
                    text.match(/CONTRACTOR\s+PO[.:,\s]*\s*(\S+)/i) ||
                    text.match(/PO\s+NO[.:,\s]*\s*(P-[A-Za-z0-9\-]+|\d{4,}[\w\-]*)/i);
    if (poMatch) result.poNumber = poMatch[1].trim();

    // 5. Supplier
    const supplierMatch = text.match(/(?:KSB MIL CONTROLS LIMITED|KSB MIL Controls Limited)/i) ||
                          text.match(/Supplier\s*[:,\s]+\s*([^\r\n,]+)/i);
    if (supplierMatch) result.supplierName = (supplierMatch[1] || supplierMatch[0]).trim();

    // 6. Inspection dates
    const dateMatch = text.match(/(\d{1,2}(?:st|nd|rd|th)?\s*[,&]\s*\d{1,2}(?:st|nd|rd|th)?.*?\d{4})/i) ||
                      text.match(/Inspection\s*Date[s]?\s*[:,\s]+\s*([^\r\n,]+)/i);
    if (dateMatch) result.inspectionDates = dateMatch[1].trim();

    // 7. ITP Reference: e.g. "CV-L2-4441 QAP R3/SO" or "P30350-12-99-97-4786"
    const itpQapMatch = text.match(/ITP\s*NO[.:,\s]*\s*([A-Za-z0-9\-_ \/]+?)(?=\s+REF|\s+REV|\s+VENDOR|,|\r|\n|$)/i);
    const itpFallbackMatch = text.match(/(P\d+[A-Z]?-\d+-\d+-\d+-\d+)/);
    if (itpQapMatch) {
      result.itpReference = itpQapMatch[1].replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    } else if (itpFallbackMatch) {
      result.itpReference = itpFallbackMatch[1];
    }

    // 8. Materials / Equipment description: e.g. "CONTROL VALVES (BUHASA)" or "SUPPLY OF CONTROL VALVE"
    const matMatch = text.match(/REQUEST\s+FOR\s+INSPECTION\s*\(RFI\)\s*([A-Za-z0-9\s\(\)]+?)(?=\s+RFI\s+No|\n|$)/i) ||
                     text.match(/SUPPLY\s+OF\s+([A-Za-z0-9\s]+?)(?=\s+Document|\s+Rev|\n|$)/i) ||
                     text.match(/(?:Materials?|Equipment)\s*(?:Inspected)?\s*[:,\s]+\s*([^\r\n,]+)/i);
    if (matMatch) result.materialDescription = matMatch[1].replace(/\s+/g, ' ').trim();

    // Activities - ITP clause references with sub-clauses
    const activities: any[] = [];
    const activityRegex = /(\d+\.\d+(?:\s*\([a-z]\))?)\s*[-–,\t]?\s*([A-Za-z][^\n,]{3,90})/g;
    let match;
    while ((match = activityRegex.exec(text)) !== null) {
      const clause = match[1].trim();
      if (clause === '3.2' || (clause.startsWith('3.2') && !clause.includes('('))) continue; // Skip material cert note
      const rawDesc = match[2]
        .replace(/\(Vendor:.*|\(Sub-Vendor:.*|Vendor Location:.*|Meladoor.*|Sub Vendor Location:.*|Specialised Coating.*/gi, '')
        .trim();
      if (rawDesc && !activities.some(a => a.clauseNumber === clause) && !rawDesc.includes('mm/y')) {
        activities.push({
          clauseNumber: clause,
          activityName: rawDesc,
          acceptanceCriteria: 'Conform to approved ITP & project specifications',
          interventionTPIA: 'W',
        });
      }
    }
    if (activities.length > 0) result.activities = activities;

    // Items extraction supporting multiple RFI styles:
    // Helper to identify equipment tag numbers (valves, instruments, equipment)
    const months = /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
    const isTagNumber = (s: string) => {
      if (!s || s.length < 5 || s.length > 40) return false;
      if (/^(?:rfi|itp|po|project|item|sl|rev|qap|iso|vendor|p30)/i.test(s)) return false;
      if (months.test(s)) return false;
      if (s.endsWith('-') || s.startsWith('-')) return false;
      // Must contain at least two letters (e.g. PCV, FCV, MOV) and not be pure numbers
      if (!/[a-z]{2,}/i.test(s)) return false;
      return /^\d{2}-\d{2}-[A-Za-z0-9\-]+$/.test(s) || /^\d{2}-[A-Za-z]{2,5}-[A-Za-z0-9\-]+$/.test(s);
    };

    // Items extraction supporting multiple RFI styles:
    const items: any[] = [];

    // Format 1: Explicit "Tag No.:" lines (Primary RFI item style)
    // e.g. Tag No.: 11-14-PCV-6712-09B (KSB Ref. No.: CD77E001-1) [PO SL No.: 1] (Valve SL No.: 26000788)
    const tagLines = text.split(/\r?\n/).filter(l => /Tag\s*No[.:]/i.test(l));
    for (const line of tagLines) {
      const tagMatch = line.match(/Tag\s*No[.:]*\s*([0-9]{2}-[0-9]{2}-[A-Za-z0-9\-]+|[0-9]{2}-[A-Za-z]{2,5}-[A-Za-z0-9\-]+)/i);
      if (tagMatch) {
        const rawTag = tagMatch[1].trim();
        if (isTagNumber(rawTag) && !items.some(i => i.tagNumber === rawTag)) {
          const poItemMatch = line.match(/(?:PO\s*SL\s*No[.:]*|PO\s*Item[.:]*|Item\s*No[.:]*)\s*([0-9]+)/i);
          const ksbRefMatch = line.match(/(?:KSB\s*Ref[.:\sNo]*|Job\s*No[.:]*|Ref\s*No[.:]*)\s*([A-Za-z0-9\-]+)/i);
          const valveSlMatch = line.match(/(?:Valve\s*SL\s*No[.:]*|Valve\s*Serial[.:]*|Serial\s*No[.:]*)\s*([0-9A-Za-z]+)/i);

          items.push({
            poItemNo: poItemMatch ? `'${poItemMatch[1].trim()}` : "'1",
            tagNumber: rawTag,
            serialNumber: valveSlMatch ? valveSlMatch[1].trim() : '',
            jobNo: ksbRefMatch ? ksbRefMatch[1].trim() : '',
            itemName: 'Control Valve',
            sizeInch: "24''",
            rating: 'ASME #600 RF',
            bodyMaterial: 'Gr WCC',
            orderedQty: 1,
            presentedQty: 1,
            acceptedThisVisit: 1,
            acceptedToDate: 1,
          });
        }
      }
    }

    // Format 2: Table / Annexure style (e.g. RFI-109 table) - ONLY if Format 1 found no items
    if (items.length === 0) {
      const pattern2 = /[''`](\d+)\s+([0-9]{2}-[0-9]{2}-[A-Za-z]+(?:\s*-\s*)?[0-9A-Za-z\-]+)\s+([0-9]+)\s+([A-Za-z0-9]+)\s+([^\n]*)/g;
      let match;
      while ((match = pattern2.exec(text)) !== null) {
        const rawTag = match[2].replace(/\s+/g, '');
        if (isTagNumber(rawTag) && !items.some(i => i.tagNumber === rawTag)) {
          const details = match[5].trim();
          const sizeMatch = details.match(/(\d+['"])/);
          const ratingMatch = details.match(/(ASME\s*#?\d+\s*\w*)/i);
          const matMatch = details.match(/(Gr\s*\w+|WCC|LCC|CF8M)/i);
          const seriesMatch = details.match(/(\d{5})/);

          items.push({
            poItemNo: `'${match[1]}`,
            tagNumber: rawTag,
            serialNumber: match[3],
            jobNo: match[4],
            itemName: 'Control Valve',
            sizeInch: sizeMatch ? sizeMatch[1] : "24''",
            rating: ratingMatch ? ratingMatch[1] : 'ASME #600 RF',
            bodyMaterial: matMatch ? matMatch[1] : 'Gr WCC',
            valveSeries: seriesMatch ? seriesMatch[1] : '41611',
            orderedQty: 1,
            presentedQty: 1,
            acceptedThisVisit: 1,
            acceptedToDate: 1,
          });
        }
      }
    }

    // Format 3: Delimited row style (CSV / Excel / Word table tabs) - ONLY if still no items
    if (items.length === 0) {
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        const parts = line.split(/[,;\t]/).map(p => p.trim().replace(/^["']|["']$/g, ''));
        if (parts.length >= 2) {
          const tagIdx = parts.findIndex(p => isTagNumber(p));
          if (tagIdx !== -1) {
            const rawTag = parts[tagIdx];
            if (!items.some(i => i.tagNumber === rawTag)) {
              const itemNo = tagIdx > 0 && /^\d+$/.test(parts[0]) ? parts[0] : `${items.length + 1}`;
              const serialNo = (parts[tagIdx + 1] && !parts[tagIdx + 1].toLowerCase().includes('valve')) ? parts[tagIdx + 1] : '';
              const desc = parts.find(p => /valve|pipe|fitting|flange/i.test(p)) || 'Control Valve';
              items.push({
                poItemNo: `'${itemNo}`,
                tagNumber: rawTag,
                serialNumber: serialNo,
                jobNo: '',
                itemName: desc,
                sizeInch: "24''",
                rating: 'ASME #600 RF',
                bodyMaterial: 'Gr WCC',
                orderedQty: 1,
                presentedQty: 1,
                acceptedThisVisit: 1,
                acceptedToDate: 1,
              });
            }
          }
        }
      }
    }

    // Format 4: Generic Tag detection if items still empty:
    if (items.length === 0) {
      const tagRegex = /\b(\d{2}-\d{2}-[A-Za-z]{2,4}\s*-\s*\d{4}\s*-\s*\d{2}[A-Za-z]?)\b/g;
      let match;
      while ((match = tagRegex.exec(text)) !== null) {
        const tag = match[1].replace(/\s+/g, '');
        if (isTagNumber(tag) && !items.some(i => i.tagNumber === tag)) {
          items.push({
            poItemNo: "'1",
            tagNumber: tag,
            serialNumber: '',
            jobNo: '',
            itemName: 'Control Valve',
            sizeInch: "24''",
            rating: 'ASME #600 RF',
            bodyMaterial: 'Gr WCC',
            orderedQty: 1,
            presentedQty: 1,
            acceptedThisVisit: 1,
            acceptedToDate: 1,
          });
        }
      }
    }

    if (items.length > 0) {
      result.items = items;
      result.tagNumbers = items.map(i => i.tagNumber);
    }

    // Contact persons
    const contacts: string[] = [];
    const contactRegex = /Mr\.\s+([A-Z][a-z]+\s+[A-Z][a-z]*(?:\s+[A-Z])?)/g;
    while ((match = contactRegex.exec(text)) !== null) {
      if (!contacts.includes(match[1])) contacts.push(match[1]);
    }
    if (contacts.length > 0) result.contactPersons = contacts;

    // Location
    const locMatch = text.match(/(Meladoor[^.]*India\.?)/i);
    if (locMatch) result.inspectionLocation = locMatch[1];

    return result;
  }

  /**
   * Parse ITP document text to extract clauses and activities
   */
  private parseITP(text: string): any {
    const result: any = { documentType: 'ITP' };

    // ITP Number
    const itpMatch = text.match(/(P\d+[A-Z]?-\d+-\d+-\d+-\d+)/);
    if (itpMatch) result.itpNumber = itpMatch[1];

    // Revision
    const revMatch = text.match(/Revision[:\s]*(\d+|[A-Z])/i);
    if (revMatch) result.revision = revMatch[1];

    // Supplier
    const supplierMatch = text.match(/Supplier[:\s]*([^\n]+)/i);
    if (supplierMatch) result.supplier = supplierMatch[1].trim();

    // Sections and Activities
    const sections: any[] = [];
    const sectionHeaders = [
      'PRE-INSPECTION', 'INCOMING INSPECTION', 'IN PROCESS INSPECTION',
      'ASSEMBLY TEST', 'Painting and allied', 'FINAL INSPECTION'
    ];

    // Extract clause activities
    const clauses: any[] = [];
    const clauseRegex = /(\d+\.\d+)\s+([A-Z][^\n]{10,100})/g;
    let match;
    while ((match = clauseRegex.exec(text)) !== null) {
      clauses.push({
        clauseNumber: match[1],
        activityDescription: match[2].trim(),
      });
    }
    result.clauses = clauses;

    // Intervention levels
    const interventionPattern = /\b([HWRMAhwrma])\s+([HWRMAhwrma])\s+([HWRMAhwrma])\b/g;
    const interventions: string[] = [];
    while ((match = interventionPattern.exec(text)) !== null) {
      interventions.push(`${match[1]}/${match[2]}/${match[3]}`);
    }
    if (interventions.length > 0) result.interventionSamples = interventions.slice(0, 10);

    return result;
  }

  /**
   * Parse calibration certificate text
   */
  private parseCalibration(text: string): any {
    const result: any = { documentType: 'CALIBRATION_CERTIFICATE' };

    // Serial number
    const serialMatch = text.match(/(?:Serial|SL|S\/N)[.\s:No]*\s*([A-Z0-9-]+)/i);
    if (serialMatch) result.serialNumber = serialMatch[1];

    // Certificate number
    const certMatch = text.match(/(?:Certificate|Cert)[.\s:No]*\s*([A-Z0-9/\-]+)/i);
    if (certMatch) result.certificateNumber = certMatch[1];

    // Dates
    const dateRegex = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/g;
    const dates: string[] = [];
    let match;
    while ((match = dateRegex.exec(text)) !== null) {
      dates.push(match[1]);
    }
    if (dates.length > 0) {
      result.calibrationDate = dates[0];
      if (dates.length > 1) result.expiryDate = dates[dates.length - 1];
    }

    return result;
  }

  /**
   * Parse customer offer list / letter to identify offered items and inspection activities
   */
  public parseOfferList(text: string, existingItems: any[] = [], existingActivities: any[] = []): any {
    const result: any = {
      documentType: 'OFFER_LIST',
      matchedItemIds: [] as string[],
      matchedItems: [] as any[],
      omittedItemIds: [] as string[],
      omittedItems: [] as any[],
      newItems: [] as any[],
      matchedActivityIds: [] as string[],
      matchedActivities: [] as any[],
      omittedActivityIds: [] as string[],
      omittedActivities: [] as any[],
      newActivities: [] as any[],
      offeredTags: [] as string[],
      offeredClauses: [] as string[],
      summary: '',
    };

    const cleanText = text || '';
    const norm = (s: string) => (s || '').toLowerCase().replace(/[\s\-_()]/g, '');

    // 1. Offer letter reference and date
    const refMatch = cleanText.match(/(?:Offer\s*(?:Ref|Letter|No|Number)?|Ref\s*No[.:]*)\s*([A-Za-z0-9\-_/]+)/i);
    if (refMatch) result.offerReference = refMatch[1].trim();

    const dateMatch = cleanText.match(/(?:Offer\s*Date|Date[.:]*\s*)\s*(\d{1,2}(?:st|nd|rd|th)?[\s\-\/]+[A-Za-z0-9]+[\s\-\/]+\d{2,4})/i);
    if (dateMatch) result.offerDate = dateMatch[1].trim();

    // 2. Identify candidate tags in the offer text
    const months = /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
    const isCandidateTag = (s: string) => {
      if (!s || s.length < 5 || s.length > 40) return false;
      if (/^(?:rfi|itp|po|project|item|sl|rev|qap|iso|vendor|p30)/i.test(s)) return false;
      if (months.test(s)) return false;
      if (s.endsWith('-') || s.startsWith('-')) return false;
      if (!/[a-z]{2,}/i.test(s)) return false;
      return /^\d{2}-\d{2}-[A-Za-z0-9\-]+$/.test(s) || /^\d{2}-[A-Za-z]{2,5}-[A-Za-z0-9\-]+$/.test(s);
    };

    // Extract tags from text lines or words
    const detectedTags: string[] = [];
    const tagMatches = cleanText.match(/\b(\d{2}-\d{2}-[A-Za-z0-9\-]+|\d{2}-[A-Za-z]{2,5}-[A-Za-z0-9\-]+)\b/g) || [];
    for (const tm of tagMatches) {
      const cleanTag = tm.trim();
      if (isCandidateTag(cleanTag) && !detectedTags.includes(cleanTag)) {
        detectedTags.push(cleanTag);
      }
    }

    // 3. Match against existing inspection items
    const matchedItemIds = new Set<string>();

    for (const item of existingItems) {
      let isOffered = false;

      // Check tag match
      if (item.tagNumber) {
        const itemTagNorm = norm(item.tagNumber);
        if (detectedTags.some(t => norm(t) === itemTagNorm)) {
          isOffered = true;
        } else if (cleanText.toLowerCase().includes(item.tagNumber.toLowerCase())) {
          isOffered = true;
        }
      }

      // Check serial number match (min 4 chars)
      if (!isOffered && item.serialNumber && item.serialNumber.length >= 4) {
        const serialRegex = new RegExp(`\\b${item.serialNumber.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        if (serialRegex.test(cleanText)) {
          isOffered = true;
        }
      }

      // Check PO Item No match (e.g. "PO SL No: 1" or "PO Item: '79" or "Item 1")
      if (!isOffered && item.poItemNo) {
        const cleanPo = item.poItemNo.replace(/['"`]/g, '').trim();
        if (cleanPo) {
          const poRegex = new RegExp(`(?:PO\\s*(?:SL|Item|No)?|Item)\\s*[:#.]*\\s*['"]?${cleanPo}['"]?\\b`, 'i');
          if (poRegex.test(cleanText)) {
            isOffered = true;
          }
        }
      }

      if (isOffered) {
        matchedItemIds.add(item.id);
        result.matchedItems.push(item);
        if (item.tagNumber && !result.offeredTags.includes(item.tagNumber)) {
          result.offeredTags.push(item.tagNumber);
        }
      } else {
        result.omittedItems.push(item);
      }
    }

    result.matchedItemIds = Array.from(matchedItemIds);
    result.omittedItemIds = result.omittedItems.map((i: any) => i.id);

    // Any detected tags that are NOT in existing items
    for (const dt of detectedTags) {
      if (!existingItems.some((i: any) => norm(i.tagNumber) === norm(dt))) {
        result.newItems.push({
          tagNumber: dt,
          itemName: 'Control Valve',
          presentedQty: 1,
          orderedQty: 1,
        });
        if (!result.offeredTags.includes(dt)) result.offeredTags.push(dt);
      }
    }

    // 4. Identify candidate clauses in offer text (e.g. 4.1(a), 4.1 (a), 7.1, 8.13)
    const clauseRegex = /\b(\d+\.\d+(?:\s*\([a-z]\))?)\b/gi;
    const detectedClauses: string[] = [];
    let cm;
    while ((cm = clauseRegex.exec(cleanText)) !== null) {
      const c = cm[1].replace(/\s+/g, '');
      if (!detectedClauses.includes(c)) detectedClauses.push(c);
    }

    // 5. Match against existing inspection activities
    const matchedActIds = new Set<string>();

    for (const act of existingActivities) {
      let isOffered = false;
      const actClauseNorm = (act.clauseNumber || '').replace(/\s+/g, '').toLowerCase();

      // Check clause match
      if (actClauseNorm) {
        if (detectedClauses.some(c => c.toLowerCase() === actClauseNorm)) {
          isOffered = true;
        } else {
          // Check base clause e.g. "4.1" if act is "4.1(a)"
          const baseClause = actClauseNorm.replace(/\([a-z]\)/, '');
          if (baseClause && detectedClauses.some(c => c.toLowerCase() === baseClause)) {
            isOffered = true;
          }
        }
      }

      // Check activity name keywords in offer text
      if (!isOffered && act.activityName && act.activityName.length > 5) {
        const keywords = act.activityName
          .split(/[-–,/()]/)
          .map((k: string) => k.trim())
          .filter((k: string) => k.length >= 6 && !/^(conform|approved|project|specification|general|standard)/i.test(k));

        for (const kw of keywords) {
          if (cleanText.toLowerCase().includes(kw.toLowerCase())) {
            isOffered = true;
            break;
          }
        }
      }

      if (isOffered) {
        matchedActIds.add(act.id);
        result.matchedActivities.push(act);
        if (act.clauseNumber && !result.offeredClauses.includes(act.clauseNumber)) {
          result.offeredClauses.push(act.clauseNumber);
        }
      } else {
        result.omittedActivities.push(act);
      }
    }

    result.matchedActivityIds = Array.from(matchedActIds);
    result.omittedActivityIds = result.omittedActivities.map((a: any) => a.id);

    // Summary description
    result.summary = `Auto-selected ${result.matchedItemIds.length} item(s) and ${result.matchedActivityIds.length} activity/activities from offer letter.`;

    return result;
  }
}

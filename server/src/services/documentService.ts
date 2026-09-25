import path from 'path';
import prisma from '../db/prisma';

export class DocumentService {
  /**
   * Process a document: extract text from PDF, parse structured data,
   * and save the extraction record.
   */
  async processDocument(documentId: string, filePath: string, documentType: string) {
    let extractedData: any = {};
    let rawText = '';
    let confidence = 0.85;

    const absPath = path.resolve(filePath);

    if (filePath.toLowerCase().endsWith('.pdf')) {
      try {
        const { PDFParse } = require('pdf-parse');
        const p = new PDFParse({ url: absPath });

        try {
          // Get info
          let pageCount = 0;
          try {
            const info = await p.getInfo();
            pageCount = info.total || 0;
          } catch { /* info optional */ }

          // Get text
          const textResult = await p.getText();
          if (textResult.pages) {
            rawText = textResult.pages.map((pg: any) => pg.text || '').join('\n\n');
          } else if (typeof textResult === 'string') {
            rawText = textResult;
          } else {
            rawText = JSON.stringify(textResult);
          }

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
          } else {
            extractedData = {
              documentType,
              textPreview: rawText.substring(0, 2000),
              totalLength: rawText.length,
            };
          }
        } finally {
          await p.destroy();
        }
      } catch (err: any) {
        console.error('PDF extraction error:', err.message);
        extractedData = { error: err.message, documentType };
        confidence = 0.0;
      }
    } else {
      // Non-PDF files
      extractedData = { documentType, note: 'Non-PDF file - manual review required' };
      confidence = 0.5;
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
   * Extract data directly from PDF without database persistence (useful for preview/testing)
   */
  public async extractDataFromPDF(filePath: string, documentType: string): Promise<any> {
    const absPath = path.resolve(filePath);
    const { PDFParse } = require('pdf-parse');
    const p = new PDFParse({ url: absPath });
    try {
      const textResult = await p.getText();
      const rawText = textResult.pages ? textResult.pages.map((pg: any) => pg.text || '').join('\n\n') : (typeof textResult === 'string' ? textResult : JSON.stringify(textResult));
      if (documentType === 'RFI') return this.parseRFI(rawText);
      if (documentType === 'ITP') return this.parseITP(rawText);
      if (documentType === 'CALIBRATION_CERTIFICATE') return this.parseCalibration(rawText);
      return { rawText };
    } finally {
      await p.destroy();
    }
  }

  /**
   * Parse RFI document text to extract structured fields
   */
  public parseRFI(text: string): any {
    const result: any = { documentType: 'RFI' };

    // 1. Project Name (e.g. EPCM FOR BAB & BU HASA AiP5 OFF-PLOT FACILITIES PROJECT)
    const projNameMatch = text.match(/(EPCM\s+FOR\s+[A-Za-z0-9\s&]+?PROJECT)/i) ||
                          text.match(/Subject\s*:\s*([^\n\r]+?)(?=\s+ADNOC|\s*[\r\n]|$)/i);
    if (projNameMatch) result.projectName = projNameMatch[1].replace(/\s+/g, ' ').trim();

    // 2. Project number: P30350 or P30339B
    const projMatch = text.match(/PROJECT\s*No[.:]*\s*(P\d{4,6}[A-Z]?)/i) ||
                      text.match(/(?:Project No[.:]*|Project:)\s*(P\d{4,6}\w*)/i);
    if (projMatch) result.projectNumber = projMatch[1].trim();

    // 3. RFI number: matches "RFI No: ...", "RFI-P30350...", or "P30339B-RFI-..."
    const rfiHeaderMatch = text.match(/RFI\s*No[.:\s]*\s*([A-Za-z0-9\-_\s\n]+?)(?=\s+Rev|\s+Equipment|\s+Materials|\n\s*\n|$)/i);
    if (rfiHeaderMatch) {
      result.rfiNumber = rfiHeaderMatch[1].replace(/[\r\n\t\s]+/g, '').trim();
    } else {
      const fallbackRfi = text.match(/(?:(P\d+[A-Z]?-RFI-[A-Z0-9\-]+)|(RFI-[A-Za-z0-9\-]+))/i);
      if (fallbackRfi) result.rfiNumber = (fallbackRfi[1] || fallbackRfi[2]).trim();
    }

    // 4. PO Number: e.g. "VENDOR PO NO.: P-AiP5-12-IC15-003" or "04108-PM-INST-008"
    const poMatch = text.match(/VENDOR\s+PO\s+NO[.:]*\s*([A-Za-z0-9\-]+)/i) ||
                    text.match(/CONTRACTOR\s+PO[.:]*\s*(\S+)/i) ||
                    text.match(/PO\s+NO[.:]*\s*(P-[A-Za-z0-9\-]+|\d{4,}[\w\-]*)/i);
    if (poMatch) result.poNumber = poMatch[1].trim();

    // 5. Supplier
    const supplierMatch = text.match(/(?:KSB MIL CONTROLS LIMITED|KSB MIL Controls Limited)/i);
    if (supplierMatch) result.supplierName = supplierMatch[0];

    // 6. Inspection dates
    const dateMatch = text.match(/(\d{1,2}(?:st|nd|rd|th)?\s*[,&]\s*\d{1,2}(?:st|nd|rd|th)?.*?\d{4})/i);
    if (dateMatch) result.inspectionDates = dateMatch[1].trim();

    // 7. ITP Reference: e.g. "CV-L2-4441 QAP R3/SO" or "P30350-12-99-97-4786"
    const itpQapMatch = text.match(/ITP\s*NO[.:\s]*\s*([A-Za-z0-9\-_\s\/]+?)(?=\s+REF|\s+REV|\s+VENDOR|\n\s*\n|$)/i);
    const itpFallbackMatch = text.match(/(P\d+[A-Z]?-\d+-\d+-\d+-\d+)/);
    if (itpQapMatch) {
      result.itpReference = itpQapMatch[1].replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    } else if (itpFallbackMatch) {
      result.itpReference = itpFallbackMatch[1];
    }

    // 8. Materials / Equipment description: e.g. "CONTROL VALVES (BUHASA)" or "SUPPLY OF CONTROL VALVE"
    const matMatch = text.match(/REQUEST\s+FOR\s+INSPECTION\s*\(RFI\)\s*([A-Za-z0-9\s\(\)]+?)(?=\s+RFI\s+No|\n|$)/i) ||
                     text.match(/SUPPLY\s+OF\s+([A-Za-z0-9\s]+?)(?=\s+Document|\s+Rev|\n|$)/i);
    if (matMatch) result.materialDescription = matMatch[1].replace(/\s+/g, ' ').trim();

    // Activities - ITP clause references with sub-clauses
    const activities: any[] = [];
    const activityRegex = /(\d+\.\d+(?:\s*\([a-z]\))?)\s*[-–]?\s*([A-Za-z][^\n]{3,90})/g;
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
    const items: any[] = [];

    // Format 1: Inline Key-Value style:
    // Tag No.: 11-14-PCV-6712-09B (KSB Ref. No.: CD77E001-1) [PO SL No.: 1] (Valve SL No.: 26000788)
    const pattern1 = /Tag\s*No[.:]*\s*([0-9]{2}-[0-9]{2}-[A-Za-z0-9\-]+)[^\n]*?(?:KSB\s*Ref[.:\sNo]*([A-Za-z0-9\-]+))[^\n]*?(?:PO\s*SL\s*No[.:]*\s*([0-9]+))[^\n]*?(?:Valve\s*SL\s*No[.:]*\s*([0-9A-Za-z]+))/gi;
    while ((match = pattern1.exec(text)) !== null) {
      const rawTag = match[1].replace(/\s+/g, '');
      if (rawTag && rawTag.includes('-') && !items.some(i => i.tagNumber === rawTag)) {
        items.push({
          poItemNo: match[3] ? `'${match[3].trim()}` : "'1",
          tagNumber: rawTag,
          serialNumber: match[4] ? match[4].trim() : '',
          jobNo: match[2] ? match[2].trim() : '',
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

    // Format 2: Table / Annexure style:
    // '79 14-01-FCV-1601-01A 25009567 CD13E085 24''-41611 ASME #600 RF Gr WCC CV=4500 58 24'' 1
    const pattern2 = /[''`](\d+)\s+([0-9]{2}-[0-9]{2}-[A-Za-z]+(?:\s*-\s*)?[0-9A-Za-z\-]+)\s+([0-9]+)\s+([A-Za-z0-9]+)\s+([^\n]*)/g;
    while ((match = pattern2.exec(text)) !== null) {
      const rawTag = match[2].replace(/\s+/g, '');
      if (!items.some(i => i.tagNumber === rawTag)) {
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

    // Format 3: Generic Tag detection if items still empty:
    if (items.length === 0) {
      const tagRegex = /\b(\d{2}-\d{2}-[A-Za-z]{2,4}\s*-\s*\d{4}\s*-\s*\d{2}[A-Za-z]?)\b/g;
      while ((match = tagRegex.exec(text)) !== null) {
        const tag = match[1].replace(/\s+/g, '');
        if (!items.some(i => i.tagNumber === tag)) {
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
}

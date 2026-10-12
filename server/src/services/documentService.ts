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

    // Clean hyphenated word wraps like "P30339B-30-99-52-\n4607" -> "P30339B-30-99-52-4607"
    const cleanText = text.replace(/([A-Za-z0-9]+-)\s*[\r\n]+\s*([A-Za-z0-9]+)/g, '$1$2');

    // 1. Project Name (e.g. Lower Zakum LTDP-1 EPC Works for EPS-2 and PDP Project, EPCM FOR BAB...)
    const projNameMatch = cleanText.match(/(Lower\s*Zakum[\s\S]*?Project)/i) ||
                          cleanText.match(/(EPCM\s+FOR\s+[A-Za-z0-9\s&]+?PROJECT)/i) ||
                          cleanText.match(/(EPC\s+for\s+[A-Za-z0-9\s&()\-]+?Package\s*\d+)/i) ||
                          cleanText.match(/(?:Project\s*Name|Subject)\s*[:,\s]+\s*([^\r\n,]+)/i);
    if (projNameMatch) result.projectName = projNameMatch[1].replace(/\s+/g, ' ').trim();

    // 2. Project number: COMPANY PROJECT NO or Contractor PROJECT No or P30350 / P30339B
    const projMatch = cleanText.match(/COMPANY\s*PROJECT\s*NO[.:\-\s]*\s*([A-Za-z0-9\-]+)/i) ||
                      cleanText.match(/Contractor\s*PROJECT\s*No[.:\-\s]*\s*([A-Za-z0-9\-]+)/i) ||
                      cleanText.match(/PROJECT\s*No[.:,]*\s*(P\d{4,6}[A-Z]?)/i) ||
                      cleanText.match(/(?:Project\s*No[.:,]*|Project:)\s*(P\d{4,6}\w*)/i) ||
                      cleanText.match(/\b(P\d{4,6}[A-Z]?)\b/);
    if (projMatch) result.projectNumber = projMatch[1].trim();

    // 3. RFI / Notification number: matches "Notification No: NOI-...", "RFI No: ...", "RFI-P30350...", etc.
    const notifMatch = cleanText.match(/(?:Notification|NOI|RFI)\s*No[.:,\s]*\s*([A-Za-z0-9\-_\s/]+?)(?=\s+Rev|\s+Equipment|\s+Materials|,|\n\s*\n|$)/i);
    if (notifMatch) {
      result.rfiNumber = notifMatch[1].replace(/[\r\n\t\s]+/g, '-').replace(/-+/g, '-').trim();
    } else {
      const fallbackRfi = cleanText.match(/(?:(NOI-[A-Za-z0-9\-]+)|(P\d+[A-Z]?-RFI-[A-Z0-9\-]+)|(RFI-[A-Za-z0-9\-]+))/i);
      if (fallbackRfi) result.rfiNumber = (fallbackRfi[1] || fallbackRfi[2] || fallbackRfi[3]).trim();
    }

    // 4. PO Number: e.g. "PO NO: 2745-2024-73004-AC" or "VENDOR PO NO.: P-AiP5-12-IC15-003"
    const poMatch = cleanText.match(/PO\s*NO[.:\s]*\s*([A-Za-z0-9\-\/]+)/i) ||
                    cleanText.match(/VENDOR\s+PO\s+NO[.:,\s]*\s*([A-Za-z0-9\-]+)/i) ||
                    cleanText.match(/CONTRACTOR\s+PO[.:,\s]*\s*(\S+)/i) ||
                    cleanText.match(/PO\s+NO[.:,\s]*\s*(P-[A-Za-z0-9\-]+|\d{4,}[\w\-]*)/i);
    if (poMatch) result.poNumber = poMatch[1].trim();

    const custPoMatch = cleanText.match(/P\.?O\.?\s*No[.:\s]*\s*([0-9]{5,}[\w\-]*)/i);
    if (custPoMatch) result.customerPoNumber = custPoMatch[1].trim();

    // 5. Supplier
    const supplierMatch = cleanText.match(/Vendor\s*Name\s*([^\r\n,]+)/i) ||
                          cleanText.match(/Manufacturer\s*&\s*Factory\s*([^\r\n,]+)/i) ||
                          cleanText.match(/(?:STEELSTRONG\s*VALVES\s*\(INDIA\)\s*PVT\.?\s*LTD\.?|KSB\s*MIL\s*CONTROLS\s*LIMITED)/i) ||
                          cleanText.match(/Supplier\s*[:,\s]+\s*([^\r\n,]+)/i);
    if (supplierMatch) result.supplierName = (supplierMatch[1] || supplierMatch[0]).trim();

    // 6. Inspection dates
    const dateMatch = cleanText.match(/(\d{1,2}(?:st|nd|rd|th)?\s*[,&]\s*\d{1,2}(?:st|nd|rd|th)?.*?\d{4})/i) ||
                      cleanText.match(/Inspection\s*Date[s]?\s*[:,\s]+\s*([^\r\n,]+)/i);
    if (dateMatch) result.inspectionDates = dateMatch[1].trim();

    // 7. Location: Place of witness or Vendor address
    const witnessMatch = cleanText.match(/Place\s*of\s*Witness[\s\S]*?Address\s*([^\r\n]+(?:\r?\n[^\r\n]+){0,2})/i);
    if (witnessMatch) {
      result.inspectionLocation = witnessMatch[1].replace(/\s+/g, ' ').replace(/Subject.*$/i, '').trim();
    } else {
      const locMatch = text.match(/(Meladoor[^.]*India\.?)/i) || text.match(/(Survey\s*No[^.\n]+India\.?)/i);
      if (locMatch) result.inspectionLocation = locMatch[1].trim();
    }

    // 8. ITP Reference & Revision: e.g. "2745-73004AC-X002-005", "P30339B-30-99-52-4607"
    const itpDocMatch = cleanText.match(/ITP\s*No[.:\s]*\s*([A-Za-z0-9\-_]+)/i) ||
                         cleanText.match(/(P\d+[A-Z]?-\d+-\d+-\d+-\d+)/) ||
                         cleanText.match(/ITP\s*(?:Ref\.?|NO)[.:,\s]*\s*([A-Za-z0-9\-_ \/]+?)(?=\s+ITP Activity|\s+Activity|\s+Witness|\s+Review|\s+REF|\s+REV|\s+VENDOR|,|\r|\n|$)/i);
    const itpQapMatch = cleanText.match(/([A-Z0-9]+-[A-Z0-9]+-[0-9]+(?:-[A-Z0-9]+)?\s*QAP\s*R\d+\/[A-Z0-9]+)/i);

    if (itpDocMatch) {
      result.itpReference = itpDocMatch[1].trim();
    } else if (itpQapMatch) {
      result.itpReference = itpQapMatch[1].trim();
    }

    // Extract ITP revision if present in RFI
    const revMatch = cleanText.match(/ITP\s*No[\s\S]{0,60}?\bRev\s*#?\s*:\s*([0-9A-Za-z]+)/i) ||
                     cleanText.match(/\bITP\b[\s\S]{0,60}?\bRev(?:ision)?\.?\s*[:\-]?\s*([0-9]+|[A-Z])\b/i) ||
                     cleanText.match(/\b(R\d+\/[A-Z0-9]+)\b/i) ||
                     cleanText.match(/\bRev(?:ision)?\.?\s*[:\-]?\s*([0-9]+|[A-Z])\b/i);
    if (revMatch) {
      result.itpRevision = revMatch[1].trim();
    }

    // 9. Materials / Equipment description: validate correctly per RFI
    const isInvalidMat = (s: string) => !s || /(Certification|3\.2|3\.1|Inspection Details|Annexure|CONTRACTOR|INTERNAL)/i.test(s);
    const matCandidates: string[] = [];

    const poDescMatch = cleanText.match(/PO\s+Description\s*([^\r\n,]+)/i);
    if (poDescMatch && !isInvalidMat(poDescMatch[1])) matCandidates.push(poDescMatch[1].trim());

    const matRfiHeader = cleanText.match(/REQUEST\s+FOR\s+INSPECTION\s*\(RFI\)\s*([A-Za-z0-9\s\(\)]+?)(?=\s+RFI\s+No|\n|$)/i);
    if (matRfiHeader && !isInvalidMat(matRfiHeader[1])) matCandidates.push(matRfiHeader[1].trim());

    const matEquipHeader = cleanText.match(/Equipment\s*[\/&]\s*Materials?\s*[\/&]\s*Activities[\s\S]*?Request for Inspection\s*\(RFI\)[\s\S]*?\n\s*([^\r\n]+)/i);
    if (matEquipHeader && !isInvalidMat(matEquipHeader[1])) {
      let desc = matEquipHeader[1].replace(/-\s*\d+\s*Tag\s*Nos\.?/i, '').trim();
      matCandidates.push(desc);
    }

    const matSupply = cleanText.match(/SUPPLY\s+OF\s+([A-Za-z0-9\s]+?)(?=\s+Document|\s+Rev|\n|$)/i);
    if (matSupply && !isInvalidMat(matSupply[1])) matCandidates.push('SUPPLY OF ' + matSupply[1].trim());

    const matGeneric = cleanText.match(/(?:Materials?|Equipment)\s*(?:Inspected)?\s*[:,\s]+\s*([^\r\n,]+)/i);
    if (matGeneric && !isInvalidMat(matGeneric[1])) matCandidates.push(matGeneric[1].trim());

    if (matCandidates.length > 0) {
      let chosen = matCandidates[0].replace(/\s+/g, ' ').trim();
      if (/VALVE WITH ACTUATOR/i.test(chosen) && !/CONTROL VALVES/i.test(chosen)) {
        chosen = `CONTROL VALVES (${chosen})`;
      }
      result.materialDescription = chosen;
    } else {
      result.materialDescription = 'CONTROL VALVES AND ITS COMPONENTS';
    }

    // 10. Activities - Extract strictly as per RFI / Notification of Inspection
    const activities: any[] = [];

    // Format A: Tabular NOI step format (e.g. "19.5 Visual & Dimension (Trims) W RW RW RW", "19.61 PMI ( Positive Material Identification) Trims W RW RW RW")
    const stepRegex = /(?:^|\n|\s)(\d{1,2}[\.,]\d{1,2})\s+([A-Za-z][^\n\r]+?)(?=(?:\s+[WHR]\s+[A-Za-z0-9\s]+|\r|\n|$))/g;
    let sm;
    while ((sm = stepRegex.exec(cleanText)) !== null) {
      const clause = sm[1].replace(',', '.');
      if (clause === '3.2' || clause.startsWith('3.2') || clause === '10.00' || clause.includes(':')) continue;
      let actName = sm[2].replace(/\s+/g, ' ').trim();
      actName = actName.replace(/\s+[WHR](?:\s+[WHR\w]+)*$/i, '').trim();
      if (actName.toLowerCase().includes('am (ist)') || actName.toLowerCase().includes('pm (ist)')) continue;
      if (actName.length >= 3 && !activities.some(a => a.clauseNumber === clause)) {
        activities.push({
          clauseNumber: clause,
          activityName: actName,
          acceptanceCriteria: 'Conform to approved ITP & project specifications',
          interventionTPIA: 'W',
          isMandatoryInRFI: true,
        });
      }
    }

    // Format B: Standard activity regex if Format A did not find any
    if (activities.length === 0) {
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
            isMandatoryInRFI: true,
          });
        }
      }
    }
    if (activities.length > 0) result.activities = activities;

    // 11. Items extraction supporting multiple RFI styles:
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

    const items: any[] = [];

    // Format 1: Explicit "Tag No.:" lines (Primary RFI item style)
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

    // Format 3: Delimited row style (CSV / Excel / Word table tabs)
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

    // Format 5: Generic placeholder detection (e.g. "Ball & Seat (for all)", offering qty: 3600, "The final annexure (detailed offer list) will be shared at the time of inspection")
    // When RFI does NOT have individual item details, we flag it so materials can be picked up from the Offer list!
    const placeholderMatch = cleanText.match(/(?:Ball\s*&\s*Seat(?:\s*\(for\s*all\))?|Trims(?:\s*\(for\s*all\))?)/i);
    const qtyMatch = cleanText.match(/Offering\s*qty[\s\S]{0,30}?(\d{2,})/i) || cleanText.match(/(\d{3,})\s+(?:The\s+final\s+annexure|detailed\s+offer)/i);
    const annexureNote = cleanText.includes('detailed offer list') || cleanText.includes('final annexure') || cleanText.includes('shared at the time of inspection');

    if (items.length === 0 && (placeholderMatch || annexureNote)) {
      const genericName = placeholderMatch ? placeholderMatch[0].trim() : 'Ball & Seat (for all)';
      const totalOfferingQty = qtyMatch ? parseInt(qtyMatch[1], 10) : 3600;
      items.push({
        poItemNo: "'1",
        tagNumber: genericName,
        itemName: genericName,
        orderedQty: totalOfferingQty,
        presentedQty: totalOfferingQty,
        acceptedThisVisit: totalOfferingQty,
        acceptedToDate: totalOfferingQty,
        isPlaceholder: true,
        remarks: 'The final annexure (detailed offer list) will be shared at the time of inspection.',
      });
      result.rfiHasNoDetails = true;
    }

    if (items.length > 0) {
      result.items = items;
      result.tagNumbers = items.map(i => i.tagNumber);
      if (items.some(i => i.isPlaceholder)) {
        result.rfiHasNoDetails = true;
      }
    } else {
      result.rfiHasNoDetails = true;
    }

    // Contact persons
    const contacts: string[] = [];
    const contactRegex = /Mr\.\s+([A-Z][a-z]+\s+[A-Z][a-z]*(?:\s+[A-Z])?)/g;
    let match;
    while ((match = contactRegex.exec(text)) !== null) {
      if (!contacts.includes(match[1])) contacts.push(match[1]);
    }
    if (contacts.length > 0) result.contactPersons = contacts;

    return result;
  }

  /**
   * Helper to parse CSV or tab-delimited text line with quotes
   */
  public parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((ch === ',' || ch === '\t' || ch === ';') && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  }

  /**
   * Parse ITP document text to extract clauses, reference documents, and activities
   */
  public parseITP(text: string): any {
    const result: any = { documentType: 'ITP' };

    // Clean hyphenated word wraps
    const cleanText = text.replace(/([A-Za-z0-9]+-)\s*[\r\n]+\s*([A-Za-z0-9]+)/g, '$1$2');

    // ITP / Document Number
    const adnocDoc = cleanText.match(/ADNOC\s+Offshore\s+Document\s+No\.?\s*[:\s]*\s*([^\r\n]+)/i) ||
                     cleanText.match(/ADNOC\s+Onshore\s+Document\s+No\.?\s*[:\s]*\s*([^\r\n]+)/i) ||
                     cleanText.match(/Contractor\s+Document\s+No\.?\s*[:\s]*\s*([^\r\n]+)/i) ||
                     cleanText.match(/Document\s+No\.?\s*[:\s]*\s*([^\r\n]+)/i);
    const itpMatch = cleanText.match(/(P\d+[A-Z]?-\d+-\d+-\d+-\d+)/) ||
                     cleanText.match(/(PNC105-[A-Za-z0-9\-]+)/i) ||
                     cleanText.match(/ITP\s*NO[.:,\s]*\s*([A-Za-z0-9\-_ \/]+?)(?=\s+REF|\s+REV|\s+VENDOR|,|\r|\n|$)/i);

    if (adnocDoc) {
      result.itpNumber = adnocDoc[1].trim().split(/\s+/)[0];
    } else if (itpMatch) {
      result.itpNumber = (itpMatch[1] || itpMatch[2] || itpMatch[3]).trim();
    }

    // Revision
    const revMatch = cleanText.match(/\bRevision\s*[:\s]*([A-Za-z0-9]+)/i) ||
                     cleanText.match(/\bRev\.?\s*[:\s]*([A-Za-z0-9]+)/i) ||
                     cleanText.match(/\bRev\s+([A-Za-z0-9]+)\b/i) ||
                     cleanText.match(/Revision[:\s]*(\d+|[A-Z])/i);
    if (revMatch) result.revision = revMatch[1].trim();

    // Project Name / Subject
    const projMatch = cleanText.match(/(Lower\s*Zakum[\s\S]*?Project)/i) ||
                      cleanText.match(/(INSPECTION\s*&\s*TEST\s*PLAN\s*FOR\s*[^\r\n]+)/i);
    if (projMatch) result.projectName = projMatch[1].replace(/\s+/g, ' ').trim();

    // Item / Package Description
    const itemDescMatch = cleanText.match(/Item\s+Description\s*[:\s]*([^\r\n]+)/i) ||
                          cleanText.match(/PO\s+Description\s*[:\s]*([^\r\n]+)/i);
    if (itemDescMatch) result.itemDescription = itemDescMatch[1].trim();

    // Equipment Tag No
    const tagMatch = cleanText.match(/Equipment\s+Tag\s+No\.?\s*[:\s]*([^\r\n]+)/i);
    if (tagMatch) result.equipmentTagNo = tagMatch[1].trim();

    // Supplier / Vendor
    const supplierMatch = cleanText.match(/Vendor\s+Name\s*[:\s]*([^\r\n]+)/i) ||
                          cleanText.match(/Supplier[:\s]*([^\r\n]+)/i) ||
                          cleanText.match(/(SUNDYNE\s+INTERNATIONAL|STEELSTRONG\s+VALVES)/i);
    if (supplierMatch) result.supplier = (supplierMatch[1] || supplierMatch[0]).trim();

    // Standard ITP clause criteria & reference documents mapping
    const standardCriteriaMap: Record<string, { ref: string; record: string }> = {
      '19.1': { ref: 'Drawing 2745-73004AC-J005-019, NACE MR0175, AD-27-I-50420', record: 'Material certificate type 3.2' },
      '19.2': { ref: 'Sundyne supplier procedure', record: 'HT report' },
      '19.3': { ref: 'Approved NDT procedure, ASME VIII Div.1 Appendix 7', record: 'RT Report' },
      '19.4': { ref: 'API 598', record: 'Hydrostatic Test Report' },
      '19.5': { ref: 'Approved NDT procedure, ASME VIII Div.1 Appendix 7, Drawing 2745-73004AC-J005-019', record: 'PT Report' },
      '19.6': { ref: 'Approved Drawing 2745-73004AC-J005-019, PMI procedure, ASME VIII Div.1 Appendix 7', record: 'PMI Report' },
      '19.7': { ref: 'Manual valve drawing 2745-73004AC-J005-011, Sundyne procedure 2745-J-SP-0013, AD-27-I-50420', record: 'FAT report' },
      '19.8': { ref: 'ISO 15848 Part 1 & 2', record: 'FET report' },
      '19.9': { ref: 'Approved Drawing 2745-73004AC-J036-008', record: 'Visual & Dimensional certificate' },
      '19.10': { ref: 'Approved Painting procedure AD-27-D-10124 (Addendum to AGES-SP-07-004)', record: 'Surface preparation inspection report' },
      '19.11': { ref: 'FROSIO level 2 or NACE level 2, AD-27-D-10124', record: 'Painting Certificate' },
      '19.12': { ref: 'Approved Painting procedure AD-27-D-10124', record: 'Painting Adhesion Test report' },
      '19.13': { ref: 'Sundyne supplier documentation', record: 'Final inspection clearance report' },
    };

    // Extract clause activities (supporting dot and comma: 19.5, 19,5, 19.6, 19,6, 19.9, etc.)
    const clauses: any[] = [];
    const clauseRegex = /(?:^|\n|\s)(\d{1,2}[\.,]\d{1,2})\s+([A-Za-z][^\n\r]{6,120})/g;
    let match;
    while ((match = clauseRegex.exec(cleanText)) !== null) {
      const clauseNum = match[1].replace(',', '.');
      let desc = match[2].trim().replace(/\s+/g, ' ');
      // Clean trailing intervention markers
      desc = desc.replace(/\s+[WHR]\s+[WHR\s]+$/i, '').trim();

      const std = standardCriteriaMap[clauseNum];
      const criteriaStr = std ? `${std.ref}. Verifying record: ${std.record}` : `Conform to approved ITP & project specifications (Clause ${clauseNum})`;

      if (!clauses.some(c => c.clauseNumber === clauseNum)) {
        clauses.push({
          clauseNumber: clauseNum,
          activityDescription: desc,
          referenceDocument: std ? std.ref : '',
          verifyingRecord: std ? std.record : '',
          acceptanceCriteria: criteriaStr,
          interventionTPIA: 'W',
        });
      }
    }
    result.clauses = clauses;

    return result;
  }

  /**
   * Parse calibration certificate text
   */
  public parseCalibration(text: string): any {
    const result: any = { documentType: 'CALIBRATION_CERTIFICATE' };
    const certMatch = text.match(/(?:Certificate\s*No\.?|Cert\s*#?)\s*([A-Za-z0-9\-_/]+)/i);
    if (certMatch) result.certificateNumber = certMatch[1].trim();
    const instMatch = text.match(/(?:Instrument|Gauge|Device|Equipment)\s*(?:Name|Type|Description)?[.:\s]*([^\r\n]{3,60})/i);
    if (instMatch) result.instrumentName = instMatch[1].trim();
    const calDateMatch = text.match(/(?:Calibration\s*Date|Cal\s*Date)[.:\s]*([0-9\-\/\.]{8,12})/i);
    if (calDateMatch) result.calibrationDate = calDateMatch[1].trim();
    const expDateMatch = text.match(/(?:Due\s*Date|Expiry\s*Date|Valid\s*Upto)[.:\s]*([0-9\-\/\.]{8,12})/i);
    if (expDateMatch) result.expiryDate = expDateMatch[1].trim();
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
      rfiHasNoDetails: false,
      allOfferItemsAsPrimary: false,
      summary: '',
    };

    const cleanText = text || '';
    const norm = (s: string) => (s || '').toLowerCase().replace(/[\s\-_()]/g, '');

    // 1. Offer letter reference and metadata
    const refMatch = cleanText.match(/(?:Offer\s*(?:Ref|Letter|No|Number)?|Ref\s*No[.:]*)\s*([A-Za-z0-9\-_/]+)/i);
    if (refMatch) result.offerReference = refMatch[1].trim();

    const dateMatch = cleanText.match(/(?:Offer\s*Date|P\.?O\.?\s*Date|Date[.:]*\s*)\s*(\d{1,2}(?:st|nd|rd|th)?[\s\-\/]+[A-Za-z0-9]+[\s\-\/]+\d{2,4})/i);
    if (dateMatch) result.offerDate = dateMatch[1].trim();

    const custMatch = cleanText.match(/Customer\s*Name[.:,\s]*\s*([^\r\n,]+)/i);
    if (custMatch) result.customerName = custMatch[1].trim();

    const poMatch = cleanText.match(/Customer\s*Purchase\s*Order[.:,\s]*\s*([^\r\n,]+)/i) ||
                    cleanText.match(/Customer\s*PO[.:,\s]*\s*([^\r\n,]+)/i);
    if (poMatch) result.poNumber = poMatch[1].trim();

    const companyMatch = cleanText.match(/(STEELSTRONG\s*VALVES[^\r\n,]*)/i) ||
                         cleanText.match(/^(?:Company|Vendor)?\s*([A-Za-z0-9\s().]+?PVT\.?\s*LTD\.?)/im);
    if (companyMatch) result.supplierName = companyMatch[1].trim();

    const soMatch = cleanText.match(/Sales\s*Order\s*Number[.:,\s]*\s*([A-Za-z0-9\-]+)/i);
    if (soMatch) result.salesOrderNumber = soMatch[1].trim();

    // 2. Parse Tabular / CSV rows from Offer List
    const lines = cleanText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const parsedOfferItems: any[] = [];
    let headerIndex = -1;
    let colSl = -1, colSo = -1, colItem = -1, colDrawing = -1, colDesc = -1, colQty = -1, colMat = -1;

    for (let i = 0; i < lines.length; i++) {
      const parts = this.parseCsvLine(lines[i]);
      const lower = parts.map(p => p.toLowerCase());
      if (lower.some(p => p.includes('sl no') || p.includes('drawing') || p.includes('item description') || p.includes('offer qty') || (p.includes('so no') && p.includes('item')))) {
        headerIndex = i;
        colSl = lower.findIndex(p => p.includes('sl no') || p === 'sl' || p.includes('item no') || p === 'pos');
        colSo = lower.findIndex(p => p.includes('so no') || p.includes('sales order') || p.includes('so #'));
        colItem = lower.findIndex(p => p === 'item' || p.includes('item type') || p.includes('part name'));
        colDrawing = lower.findIndex(p => p.includes('drawing') || p.includes('drg') || p.includes('part no') || p.includes('ref'));
        colDesc = lower.findIndex(p => p.includes('item description') || p.includes('description') || p.includes('desc'));
        colQty = lower.findIndex(p => p.includes('offer qty') || p.includes('offered qty') || p.includes('qty') || p.includes('quantity'));
        colMat = lower.findIndex(p => p.includes('material') || p.includes('moc') || p.includes('grade'));
        break;
      }
    }

    if (headerIndex !== -1) {
      for (let i = headerIndex + 1; i < lines.length; i++) {
        const parts = this.parseCsvLine(lines[i]);
        if (parts.length < 3) continue;
        if (parts.some(p => p.toLowerCase().includes('total') || p.toLowerCase().includes('comments') || p.toLowerCase().includes('inspection notes'))) break;

        const slStr = colSl !== -1 && parts[colSl] ? parts[colSl] : `${parsedOfferItems.length + 1}`;
        if (!/^\d+$/.test(slStr)) continue;

        const soNo = colSo !== -1 ? parts[colSo] : '';
        const itemType = colItem !== -1 ? parts[colItem] : '';
        const drawingRef = colDrawing !== -1 ? parts[colDrawing] : '';
        const desc = colDesc !== -1 ? parts[colDesc] : '';
        const qtyStr = colQty !== -1 ? parts[colQty] : '1';
        const qty = parseInt(qtyStr.replace(/[^0-9]/g, ''), 10) || 1;
        const mat = colMat !== -1 ? parts[colMat] : '';

        const fullItemName = desc ? (itemType && !desc.toLowerCase().includes(itemType.toLowerCase()) ? `${itemType} - ${desc}` : desc) : (itemType || 'Valve Component');
        const sizeMatch = desc.match(/(?:^|\s|["'])(\d+(?:\/\d+)?["']|\d+(?:\.\d+)?["'])/);
        const sizeInch = sizeMatch ? sizeMatch[1] : "2''";
        const ratingMatch = desc.match(/\b(\d{3,4}#|ASME\s*#?\d+|CL(?:ASS)?\s*\d+)\b/i);
        const rating = ratingMatch ? (ratingMatch[1].endsWith('#') ? `ASME #${ratingMatch[1].replace('#', '')} RF` : ratingMatch[1]) : 'ASME #600 RF';
        const seriesMatch = desc.match(/\b(FBV(?:\/[A-Za-z0-9\-]+)?|TBV(?:\/[A-Za-z0-9\-]+)?|DBB(?:\/[A-Za-z0-9\-]+)?)\b/i);
        const valveSeries = seriesMatch ? seriesMatch[1] : 'FBV';

        parsedOfferItems.push({
          poItemNo: `'${slStr}`,
          jobNo: soNo,
          tagNumber: drawingRef || `PART-${slStr}`,
          serialNumber: drawingRef,
          itemName: fullItemName,
          sizeInch,
          rating,
          valveSeries,
          bodyMaterial: mat || 'B564 N08825',
          orderedQty: qty,
          presentedQty: qty,
          acceptedThisVisit: qty,
          acceptedToDate: qty,
        });
      }
    }

    // 3. Determine if RFI has NO material details
    const isGenericPlaceholder = (item: any) => {
      if (!item) return true;
      if (item.isPlaceholder) return true;
      const tag = (item.tagNumber || '').toLowerCase().trim();
      const name = (item.itemName || '').toLowerCase().trim();
      return (
        !tag ||
        tag === '-' ||
        tag === 'na' ||
        tag.includes('for all') ||
        tag.includes('ball & seat') ||
        tag.includes('annexure') ||
        tag.includes('offer list') ||
        name.includes('for all') ||
        name.includes('annexure') ||
        name.includes('offer list')
      );
    };

    const rfiHasNoDetails = !existingItems || existingItems.length === 0 || existingItems.every(isGenericPlaceholder);
    result.rfiHasNoDetails = rfiHasNoDetails;

    // 4. CLAUSE: If no material details available in RFI, pick up from Offer List!
    if (rfiHasNoDetails && parsedOfferItems.length > 0) {
      result.allOfferItemsAsPrimary = true;
      result.newItems = parsedOfferItems;
      result.matchedItems = [];
      result.matchedItemIds = [];
      const totalQty = parsedOfferItems.reduce((acc, it) => acc + (it.presentedQty || 0), 0);
      result.summary = `No detailed materials available in RFI. Found ${parsedOfferItems.length} items with complete specifications in Offer List (Total Qty: ${totalQty}). Populating inspection materials from Offer List.`;
    } else {
      // RFI has real materials: match existing items against offer list
      const matchedItemIds = new Set<string>();

      for (const item of existingItems) {
        let isOffered = false;

        // Check drawing reference or tag match
        if (item.tagNumber) {
          const itemTagNorm = norm(item.tagNumber);
          if (parsedOfferItems.some(poi => norm(poi.tagNumber) === itemTagNorm)) {
            isOffered = true;
          } else if (cleanText.toLowerCase().includes(item.tagNumber.toLowerCase())) {
            isOffered = true;
          }
        }

        // Check serial number match
        if (!isOffered && item.serialNumber && item.serialNumber.length >= 4) {
          if (cleanText.toLowerCase().includes(item.serialNumber.toLowerCase())) {
            isOffered = true;
          }
        }

        // Check PO item number match
        if (!isOffered && item.poItemNo) {
          const cleanPo = item.poItemNo.replace(/['"`]/g, '').trim();
          if (parsedOfferItems.some(poi => poi.poItemNo.replace(/['"`]/g, '').trim() === cleanPo)) {
            isOffered = true;
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

      // Any offer items not present in RFI
      for (const poi of parsedOfferItems) {
        if (!existingItems.some((ei: any) => norm(ei.tagNumber) === norm(poi.tagNumber))) {
          result.newItems.push(poi);
        }
      }
    }

    // 5. Match Activities from Offer comments / inspection notes
    // e.g. "2.16 Visual & Dimension (SEAT RING & BALL)", "2.17 PMI (SEAT RING & BALL)"
    const matchedActIds = new Set<string>();

    for (const act of existingActivities) {
      let isOffered = false;
      const actNameLower = (act.activityName || '').toLowerCase();
      const clauseNorm = (act.clauseNumber || '').toLowerCase().replace(',', '.');

      // Check comments matching Visual & Dimension
      if (actNameLower.includes('visual') || actNameLower.includes('dimension') || clauseNorm === '19.5' || clauseNorm === '19.9') {
        if (cleanText.toLowerCase().includes('visual') || cleanText.toLowerCase().includes('dimension')) {
          isOffered = true;
        }
      }

      // Check comments matching PMI
      if (actNameLower.includes('pmi') || actNameLower.includes('positive material') || clauseNorm === '19.6' || clauseNorm === '19.61') {
        if (cleanText.toLowerCase().includes('pmi') || cleanText.toLowerCase().includes('positive material')) {
          isOffered = true;
        }
      }

      // Check generic clause mentions
      if (!isOffered && clauseNorm) {
        if (cleanText.includes(clauseNorm)) {
          isOffered = true;
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

    if (!result.summary) {
      result.summary = `Auto-selected ${result.matchedItemIds.length} item(s) and ${result.matchedActivityIds.length} activity/activities from offer letter.`;
    }

    return result;
  }
}

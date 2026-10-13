import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

export interface TableBlueprint {
  index: number;
  rowCount: number;
  columnCount: number;
  headerRows: string[][];
  sampleCells: string[];
  allRowTexts: string[][];
  rawXmlStart: number;
  rawXmlEnd: number;
}

export interface TemplateBlueprint {
  templateName: string;
  tableCount: number;
  tables: TableBlueprint[];
  headerText: string;
  footerText: string;
}

export class TemplateInspector {
  /**
   * Inspect any DOCX template file and extract its complete structural blueprint
   */
  public async inspectTemplate(docxPath: string): Promise<TemplateBlueprint> {
    const absPath = path.resolve(docxPath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Template not found: ${docxPath}`);
    }

    const data = fs.readFileSync(absPath);
    const zip = await JSZip.loadAsync(data);

    let headerText = '';
    let footerText = '';

    if (zip.file('word/header1.xml')) {
      const xml = await zip.file('word/header1.xml')!.async('text');
      headerText = this.stripXml(xml);
    }
    if (zip.file('word/footer1.xml')) {
      const xml = await zip.file('word/footer1.xml')!.async('text');
      footerText = this.stripXml(xml);
    }

    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) {
      throw new Error('Invalid DOCX: missing word/document.xml');
    }
    const docXml = await docXmlFile.async('text');

    const tables: TableBlueprint[] = [];
    const tblRegex = /<w:tbl[\s>][\s\S]*?<\/w:tbl>/g;
    let match: RegExpExecArray | null;
    let tIdx = 0;

    while ((match = tblRegex.exec(docXml)) !== null) {
      const tblXml = match[0];
      const rawXmlStart = match.index;
      const rawXmlEnd = rawXmlStart + tblXml.length;

      const rowMatches = tblXml.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || [];
      const allRowTexts: string[][] = [];
      let maxCols = 0;

      for (const trXml of rowMatches) {
        const cellMatches = trXml.match(/<w:tc[\s>][\s\S]*?<\/w:tc>/g) || [];
        maxCols = Math.max(maxCols, cellMatches.length);
        const rowCells = cellMatches.map(tcXml => this.stripXml(tcXml));
        allRowTexts.push(rowCells);
      }

      const sampleCells = Array.from(new Set(allRowTexts.flat().filter(Boolean))).slice(0, 15);

      tables.push({
        index: tIdx,
        rowCount: allRowTexts.length,
        columnCount: maxCols,
        headerRows: allRowTexts.slice(0, 2),
        sampleCells,
        allRowTexts,
        rawXmlStart,
        rawXmlEnd
      });

      tIdx++;
    }

    return {
      templateName: path.basename(docxPath),
      tableCount: tables.length,
      tables,
      headerText,
      footerText
    };
  }

  private stripXml(xml: string): string {
    return xml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
}

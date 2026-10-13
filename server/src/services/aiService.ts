import fs from 'fs';
import path from 'path';

export interface AIServiceConfig {
  apiKey?: string;
  model?: string;
}

export interface ExtractedInspectionDocument {
  projectName?: string;
  client?: string;
  contractor?: string;
  vendor?: string;
  subSupplier?: string;
  poNumber?: string;
  poRevision?: string;
  projectNumber?: string;
  inspectionDate?: string;
  location?: string;
  itpNumber?: string;
  itpRevision?: string;
  rfiNumber?: string;
  items?: Array<{
    itemNo?: string;
    tagNo?: string;
    description?: string;
    quantity?: number | string;
    materialCode?: string;
    itpStep?: string;
  }>;
  activities?: Array<{
    clause?: string;
    activityName?: string;
    acceptanceCriteria?: string;
    interventionPoint?: string;
  }>;
  instruments?: Array<{
    name?: string;
    description?: string;
    serialNo?: string;
    certificateNo?: string;
    calibratedDate?: string;
    expiryDate?: string;
  }>;
  standards?: Array<{
    code?: string;
    description?: string;
  }>;
  drawings?: Array<{
    docNo?: string;
    revision?: string;
    description?: string;
  }>;
}

export interface TemplateTableMapping {
  tableIndex: number;
  role: 'PROJECT_STAKEHOLDERS' | 'INSPECTION_HEADER' | 'ATTENDEES' | 'SUMMARY_NARRATIVE' | 'STANDARDS_DOCS' | 'PROJECT_DRAWINGS' | 'MATERIALS_OFFERED' | 'MATERIALS_INSPECTED' | 'ITP_CLAUSES' | 'CONCLUSION_NARRATIVE' | 'NCR_REMARKS' | 'EQUIPMENT_CALIBRATION' | 'OUTSTANDING_ITEMS' | 'PHOTOS_SECTION' | 'UNKNOWN';
  confidence: number;
  columnMap?: Record<string, string>; // e.g. { "PO Item  No.": "itemNo", "Description": "description", "Quantity": "quantity" }
  fieldLabels?: Record<string, string>; // e.g. { "PROJECT N AME": "projectName", "CLIENT /  COMPANY": "client", "CONTRACTOR": "contractor" }
}

export interface SemanticMappingPlan {
  headerFields?: {
    reportNo?: string;
    revision?: string;
    date?: string;
    title?: string;
  };
  footerFields?: {
    inspectorName?: string;
    contractorReview?: string;
  };
  tables: TemplateTableMapping[];
  narrativeSummary?: string;
  narrativeConclusion?: string;
}

export class AIService {
  private apiKey: string;
  private model: string;

  constructor(config?: AIServiceConfig) {
    this.apiKey = config?.apiKey || process.env.GEMINI_API_KEY || '';
    this.model = config?.model || process.env.GEMINI_MODEL || 'gemini-flash-latest';
  }

  private isEnabled(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * Raw call to Google Gemini GenerateContent API
   */
  public async callGemini(contents: any[], systemInstruction?: string, responseSchema?: any): Promise<any> {
    if (!this.isEnabled()) {
      throw new Error('GEMINI_API_KEY is not configured.');
    }

    const candidateModels = [this.model, 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];
    let lastError: Error | null = null;

    for (const modelToTry of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelToTry}:generateContent?key=${this.apiKey}`;
        const body: any = { contents };
        if (systemInstruction) {
          body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }
        const generationConfig: any = { temperature: 0.1 };
        if (responseSchema && responseSchema.properties) {
          generationConfig.responseMimeType = 'application/json';
          generationConfig.responseSchema = responseSchema;
        } else if (responseSchema) {
          generationConfig.responseMimeType = 'application/json';
        }
        body.generationConfig = generationConfig;

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          const errText = await res.text();
          if (res.status === 503 || res.status === 404 || res.status === 429) {
            console.warn(`Model ${modelToTry} returned ${res.status}, trying fallback model...`);
            lastError = new Error(`Gemini API Error (${res.status}): ${errText}`);
            continue;
          }
          throw new Error(`Gemini API Error (${res.status}): ${errText}`);
        }

        const data: any = await res.json();
        const candidate = data.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error('Gemini API returned empty response.');
        }
        return text;
      } catch (err: any) {
        lastError = err;
      }
    }

    throw lastError || new Error('All Gemini model candidates failed.');
  }

  /**
   * Multimodal document parsing: ingest PDF or image and extract full inspection schema
   */
  public async extractFromDocumentFile(filePath: string, documentType: string): Promise<ExtractedInspectionDocument> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.pdf' ? 'application/pdf' : (ext === '.png' ? 'image/png' : 'image/jpeg');
    const base64Data = buffer.toString('base64');

    const prompt = `You are an expert QA/QC Third-Party Inspection Engineer analyzing an industrial engineering document (Type: ${documentType}).
Extract all structured data with high precision.

Return a valid JSON object matching this schema:
{
  "projectName": "string",
  "client": "string (e.g. ADNOC OFFSHORE)",
  "contractor": "string (e.g. National Marine Dredging Company / NMDC)",
  "vendor": "string (Manufacturer / Supplier, e.g. Steelstrong Valves)",
  "subSupplier": "string",
  "poNumber": "string",
  "poRevision": "string",
  "projectNumber": "string",
  "inspectionDate": "string",
  "location": "string",
  "itpNumber": "string",
  "itpRevision": "string",
  "rfiNumber": "string",
  "items": [
    {
      "itemNo": "string",
      "tagNo": "string",
      "description": "string",
      "quantity": "string or number",
      "materialCode": "string",
      "itpStep": "string"
    }
  ],
  "activities": [
    {
      "clause": "string",
      "activityName": "string",
      "acceptanceCriteria": "string",
      "interventionPoint": "string"
    }
  ],
  "instruments": [
    {
      "name": "string (e.g. PMI Machine, Vernier Caliper)",
      "description": "string (e.g. SciAps X200)",
      "serialNo": "string",
      "certificateNo": "string",
      "calibratedDate": "string",
      "expiryDate": "string"
    }
  ],
  "standards": [
    {
      "code": "string (e.g. ASTM A961)",
      "description": "string"
    }
  ],
  "drawings": [
    {
      "docNo": "string",
      "revision": "string",
      "description": "string"
    }
  ]
}`;

    const parts = [
      {
        inlineData: {
          mimeType,
          data: base64Data
        }
      },
      {
        text: prompt
      }
    ];

    const jsonText = await this.callGemini(
      [{ role: 'user', parts }],
      'You are a specialized industrial QA/QC document parsing agent. Always return pure JSON with zero markdown code block formatting.',
      { type: 'OBJECT' }
    );

    try {
      const cleanJson = jsonText.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
      return JSON.parse(cleanJson);
    } catch {
      return JSON.parse(jsonText);
    }
  }

  /**
   * AI-powered semantic template reconciliation:
   * Maps an unknown client template blueprint to the actual inspection data
   */
  public async generateMappingPlan(
    templateBlueprint: {
      tables: Array<{
        index: number;
        rowCount: number;
        headerRows: string[][];
        sampleCells: string[];
      }>;
      headerText?: string;
      footerText?: string;
    },
    inspectionData: ExtractedInspectionDocument
  ): Promise<SemanticMappingPlan> {
    const prompt = `You are a Principal Lead Inspection Engineer at a Tier-1 Third Party Inspection Agency (TPIA).
Analyze this DOCX Template Blueprint and match each table to its correct semantic role based on the extracted inspection data.

CRITICAL RULES:
1. Distinguish between METADATA FORMS (tables with 2-4 columns containing key-value labels like "PROJECT NAME", "Material Description", "Contractor PO No") and MULTI-ROW DATA TABLES (tables listing items, scopes, or instruments).
2. NEVER classify a form header table as "MATERIALS_OFFERED".
3. A table with columns like ["PO Item No.", "Tag Number", "Description", "Quantity", "ITP Step #"] or similar is MATERIALS_OFFERED or MATERIALS_INSPECTED.
4. A table with columns like ["Identification No", "Description", "Calibration Due Date"] is EQUIPMENT_CALIBRATION.
5. A table with columns like ["Attendee Name", "Position", "Organization Name", "Contact Details"] is ATTENDEES.
6. A table with single large text cell or narrative prompt is SUMMARY_NARRATIVE or CONCLUSION_NARRATIVE.
7. A table with 2 columns displaying photo placeholders or captions is PHOTOS_SECTION.
8. Stakeholders: Client is Company (e.g. ADNOC), Contractor is EPC Main Contractor (e.g. NMDC), Vendor is Supplier/Manufacturer (e.g. Steelstrong). NEVER invert Contractor and Vendor!

TEMPLATE BLUEPRINT:
${JSON.stringify(templateBlueprint, null, 2)}

INSPECTION DATA AVAILABLE:
${JSON.stringify({
  client: inspectionData.client,
  contractor: inspectionData.contractor,
  vendor: inspectionData.vendor,
  poNumber: inspectionData.poNumber,
  projectNumber: inspectionData.projectNumber,
  itemsCount: inspectionData.items?.length || 0,
  instrumentsCount: inspectionData.instruments?.length || 0
}, null, 2)}

Return a structured JSON mapping plan mapping each tableIndex to its correct semantic role:
{
  "headerFields": {
    "reportNo": "string",
    "revision": "string",
    "date": "string",
    "title": "INSPECTION REPORT"
  },
  "footerFields": {
    "inspectorName": "string",
    "contractorReview": "string"
  },
  "tables": [
    {
      "tableIndex": 0,
      "role": "PROJECT_STAKEHOLDERS",
      "confidence": 0.99
    },
    {
      "tableIndex": 1,
      "role": "INSPECTION_HEADER",
      "confidence": 0.99
    },
    {
      "tableIndex": 6,
      "role": "MATERIALS_OFFERED",
      "confidence": 0.99
    }
  ],
  "narrativeSummary": "Day 1 ... Day 2 ...",
  "narrativeConclusion": "Conclusion ..."
}`;

    const jsonText = await this.callGemini(
      [{ role: 'user', parts: [{ text: prompt }] }],
      'You are an expert TPIA report mapping system. Output valid JSON only.',
      { type: 'OBJECT' }
    );

    try {
      const cleanJson = jsonText.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
      return JSON.parse(cleanJson);
    } catch {
      return JSON.parse(jsonText);
    }
  }

  /**
   * Synthesize executive narrative and conclusion in standard TPIA engineering format
   */
  public async generateExecutiveNarrative(inspectionData: any): Promise<{ summary: string; conclusion: string }> {
    const prompt = `Generate a professional, publication-ready Third-Party Inspection (TPIA) report narrative for ADNOC / Intertek / NMDC standards.

INSPECTION DETAILS:
- Vendor: ${inspectionData.vendor || 'Manufacturer'}
- Location: ${inspectionData.location || 'Factory site'}
- Inspection Date: ${inspectionData.inspectionDate || '12/10/2026'}
- ITP Ref: ${inspectionData.itpNumber || 'Approved ITP'} Rev ${inspectionData.itpRevision || '0'}
- Activities Attended: ${JSON.stringify(inspectionData.activities || ['Positive Material Identification (PMI)', 'Visual and Dimensional inspection'])}
- Items Tested: ${inspectionData.items?.length || 0} items (Valve balls, valve seats, inserts)
- Results: All items met project specifications and acceptance criteria with zero deviations.

REQUIREMENTS:
1. Provide a "summary" structured chronologically by Day / Stage (e.g. Day 1: PMI test as per ITP Clause; Day 2: Visual and Dimensional inspection as per ITP Clause).
2. Provide a concise, rigorous engineering "conclusion" confirming acceptance against specified ITP clauses.
3. Return JSON:
{
  "summary": "string",
  "conclusion": "string"
}`;

    const jsonText = await this.callGemini(
      [{ role: 'user', parts: [{ text: prompt }] }],
      'You are a Senior Lead QA/QC Engineer. Output valid JSON only.',
      { type: 'OBJECT' }
    );

    try {
      const cleanJson = jsonText.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
      return JSON.parse(cleanJson);
    } catch {
      return JSON.parse(jsonText);
    }
  }
}

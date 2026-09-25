# INSPECTAI - System Architecture Specification

## 1. High-Level Architecture Overview

INSPECTAI is structured as a modular, event-driven multi-tier application designed for high traceability, deterministic validation, and pluggable AI providers.

```
+-------------------+        +----------------------+
|   Telegram Bot    |        |  Web Dashboard (SPA) |
| (Field Interface) |        |  (React/TS/Tailwind) |
+---------+---------+        +----------+-----------+
          |                             |
          | HTTPS Webhook / Long-Poll   | REST / SSE
          v                             v
+-------------------------------------------------------+
|                 Backend API Gateway                   |
|           (Node.js / Express / TypeScript)            |
+---------------------------+---------------------------+
                            |
  +-------------------------+-------------------------+
  |                         |                         |
  v                         v                         v
+--------------------+ +--------------------+ +--------------------+
|  Document Engine   | | Inspection Engine  | | Report Engine      |
|  - Classification  | | - Activity Manager | | - DOCX Template    |
|  - Text/OCR Extr.  | | - Result Capture   | |   Assembler        |
|  - Table Parsing   | | - Validation Rules | | - Dynamic Photos   |
|  - Provenance Map  | | - Photo Manager    | | - PDF Converter    |
+---------+----------+ +---------+----------+ +---------+----------+
          |                      |                      |
          +----------------------+----------------------+
                                 |
  +------------------------------+------------------------------+
  |                              |                              |
  v                              v                              v
+--------------------+ +--------------------+ +--------------------+
|  AI Abstraction    | | Database Access    | | Storage Service    |
|  - LLM Provider    | | - Prisma ORM       | | - S3 / Local MinIO |
|  - Vision Provider | | - PostgreSQL       | | - Originals & Thumb|
|  - Speech Provider | | - Audit Log Engine | | - Document Vault   |
+--------------------+ +--------------------+ +--------------------+
```

---

## 2. Core Subsystems

### 2.1 Telegram Bot Service
- Handles webhook updates from Telegram Bot API.
- Implements session management, state machine for multi-step dialogues (e.g. uploading RFI -> confirming metadata -> checklist).
- Parses inline buttons, callbacks, photo uploads, and voice notes.
- Routes voice files to Speech-to-Text adapter and natural language to Inspection Natural Language Interpreter.

### 2.2 Web Dashboard Service
- Single Page Application built with React 19, Vite, TypeScript, and Tailwind CSS.
- Modern enterprise B2B layout with responsive navigation:
  - **Dashboard**: High-level KPIs, pending inspections, active warnings.
  - **Inspection Workspace**: Live inspection tracker, progress bar, checklist statuses, equipment cards.
  - **Document Center**: Uploaded RFIs, ITPs, datasheets, calibration certificates with extraction viewer and provenance explorer.
  - **Photo Gallery**: Tagged inspection evidence, category filter, AI suggestions vs confirmed tags.
  - **Report Builder & Review**: Side-by-side view of validation checklist, warnings, and report preview with approval workflow.
  - **Audit Trail**: Real-time event stream of all document extractions, user entries, validations, and report downloads.

### 2.3 Document Processing & AI Extraction Engine
- Implements a resilient 3-layer extraction strategy:
  1. **Direct Native Extraction**: High-speed text and layout extraction using PDFParse.
  2. **Table Structural Extractor**: Analyzes layout coordinates and whitespace tables to preserve tabular columns (crucial for ITP and RFI Annexures).
  3. **AI Structured Extraction Layer**: Pluggable agentic prompts that transform raw page chunks into validated JSON conforming to `document-schema.json`.
- **Confidence Scoring & Provenance**: Every extracted attribute is coupled with:
  ```json
  {
    "value": "P30339B",
    "confidence": 0.99,
    "source_document_id": "uuid",
    "source_document_name": "P30339B-RFI-INST-008-ARC-INT-KSB-0109 Rev.0.pdf",
    "page": 1,
    "verified_by_user": false
  }
  ```

### 2.4 Inspection Workflow & Activity Engine
- Loads standard activities from ITP clauses.
- Filters and scopes activities according to RFI requests for the specific date range and tag numbers.
- Manages strict state transitions:
  - `PENDING` -> `IN_PROGRESS` -> `ACCEPTABLE` / `NOT_ACCEPTABLE` / `ON_HOLD` / `NOT_APPLICABLE`
- Captures test parameters (medium, pressure, hold duration, observations, measurements).

### 2.5 Validation Engine
- Pure deterministic business logic rules executing before report draft and final generation:
  - Check 1: RFI ITP reference matches active ITP document.
  - Check 2: Dates are within valid inspection window.
  - Check 3: Every witness activity has an explicit recorded result.
  - Check 4: Test pressure & holding times match or exceed ITP minimums.
  - Check 5: Calibration certificate expiry date is after inspection date.
  - Check 6: Tag numbers on photos and test reports match PO item specifications.
  - Check 7: No duplicate serial numbers or conflicting results.

### 2.6 Report Generation Service (DOCX / PDF)
- Uses the master DOCX template as a clean binary base.
- Manipulates document XML (`word/document.xml`, `word/header1.xml`, `word/footer1.xml`, `word/_rels/document.xml.rels`).
- Replaces form fields, metadata cells, attendee rows, and scope tables cleanly.
- Dynamically creates the photograph grid in Section 6.0 with image embeddings, caption labels, and proper dimensions.
- Converts to PDF using headless LibreOffice / Chromium PDF renderer.

### 2.7 AI Provider Abstraction Layer
```typescript
export interface AIProviderInterface {
  extractStructuredData<T>(prompt: string, text: string, schema: any): Promise<{ data: T; confidence: number }>;
  classifyDocument(textPreview: string, filename: string): Promise<{ documentType: string; confidence: number }>;
  parseFieldVoice(audioBuffer: Buffer, context: any): Promise<{ structuredResult: any }>;
  parseFieldText(rawText: string, context: any): Promise<{ structuredResult: any }>;
  analyzeInspectionPhoto(imageBuffer: Buffer, context: any): Promise<{ category: string; detectedTags: string[]; ocrText: string }>;
}
```
Provides adapters for:
- `AnthropicProvider` (Claude Opus/Sonnet 3.5/3.7)
- `GeminiProvider` (Gemini 1.5/2.0 Flash & Pro)
- `OpenAIProvider` (GPT-4o)
- `MockDevelopmentProvider` (Instant local offline development using deterministic regex & fuzzy matching)

---

## 3. Storage & Infrastructure Layout
- **Object Storage Directory Structure**:
  ```
  s3://inspectai-bucket/
  ├── projects/{projectId}/
  │   ├── master-documents/
  │   │   ├── itp/
  │   │   ├── datasheets/
  │   │   └── gad/
  │   └── inspections/{inspectionId}/
  │       ├── rfi/
  │       ├── calibration-certs/
  │       ├── photos/
  │       │   ├── raw/
  │       │   ├── optimized/
  │       │   └── thumbs/
  │       └── reports/
  │           ├── draft-v1.docx
  │           ├── draft-v2.docx
  │           ├── final.docx
  │           └── final.pdf
  ```
- Containerized via Docker:
  - `inspectai-backend`: Node.js Express server
  - `inspectai-frontend`: Nginx serving React build
  - `inspectai-postgres`: PostgreSQL 16
  - `inspectai-minio`: Local S3-compatible storage (for self-hosted setups)

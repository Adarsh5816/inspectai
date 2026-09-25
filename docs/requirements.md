# INSPECTAI - Requirements Specification
**AI-Powered Inspection Report Automation System**

## 1. System Vision & Purpose
INSPECTAI is a production-grade web application and Telegram bot system built to automate the preparation, validation, and generation of industrial/vendor inspection reports. It transforms raw upstream documents (RFI, ITP, Datasheets, GA Drawings, Calibration Certificates) into structured project databases and generates formal, audit-compliant inspection reports matching exact customer formats (such as Intertek Form MI-1220-01).

---

## 2. User Personas & Roles
1. **Inspector (Field User)**: Performs physical inspections on-site, enters measurements, test results, holding times, takes photos, notes observations, and records attendees via Telegram and mobile web.
2. **Reviewer / QA Manager**: Reviews incoming extractions, validates discrepancies, checks calibration validity, examines warnings, inspects draft Word documents, and signs off.
3. **Admin**: Manages system users, Telegram authorizations, AI extraction thresholds, project configurations, and audit policies.
4. **Viewer / Client**: Read-only access to view completed inspections, audit trails, and download approved PDF/DOCX reports.

---

## 3. Core Functional Requirements

### 3.1 Document Ingestion & Classification (FR-DOC)
- **FR-DOC-01**: Ingest PDF, DOCX, and image formats through Web UI and Telegram bot.
- **FR-DOC-02**: Automatically classify incoming documents into distinct types:
  - `RFI` (Request for Inspection)
  - `ITP` (Inspection and Test Plan)
  - `DATASHEET` (Valve / Equipment Datasheet)
  - `GAD` (General Arrangement Drawing)
  - `FAT_PROCEDURE` / `TEST_PROCEDURE`
  - `CALIBRATION_CERTIFICATE`
  - `MATERIAL_CERTIFICATE` (MTC 3.1 / 3.2)
  - `OTHER`
- **FR-DOC-03**: If classification confidence is below configurable threshold (default 90%), request human confirmation with interactive buttons.
- **FR-DOC-04**: Maintain full provenance for every extracted field: document name, page number, confidence score, and extraction timestamp.

### 3.2 RFI Structured Extraction (FR-RFI)
- **FR-RFI-01**: Extract header metadata:
  - Project Number (`P30339B`), Project Name (`EPC for SE AiP5 Project (On plot) - ASAB/SAHIL (Package 1)`)
  - Customer (`ADNOC Onshore`), EPC Contractor (`Archirodon`), Supplier (`KSB MIL Controls Limited`), Sub-supplier (`Specialised Coating Services`)
  - PO Number (`04108-PM-INST-008`), Requisition Number, RFI Number (`P30339B-RFI-INST-008-ARC-INT-KSB-0109`), Revision (`Rev.0`)
  - Inspection Location, Inspection Dates (`15th, 16th, 17th & 22nd Sep 2026`), Working Hours
  - Contact Persons (Alex Davis, Gautham Sai, Sreejith A, Hossam)
  - Applicable ITP Reference (`P30339B-30-99-52-4607 Rev C / Rev 2`)
- **FR-RFI-02**: Extract inspection activities requested (Clause numbers, descriptions, witness/review levels).
- **FR-RFI-03**: Extract itemization table: PO Item No (`'79`, `'80`), Tag No (`14-01-FCV-1601-01A`), Valve Serial No (`25009567`), Job No (`CD13E085`), Valve Description, Ordered/Presented Quantities.
- **FR-RFI-04**: Preserve missing fields as `null`, never synthesize fake values.

### 3.3 ITP Structured Extraction (FR-ITP)
- **FR-ITP-01**: Extract document metadata: ITP Number, Title, Revision, Project, Supplier, PO Number, Order Number.
- **FR-ITP-02**: Parse tabular clauses across all sections (e.g., Section 1 Pre-inspection, Section 6 In-Process, Section 7 Assembly Tests, Section 8 Painting, Section 9 Final Inspection).
- **FR-ITP-03**: For each clause, extract:
  - Clause Number (`7.1`, `7.2`, `8.13`, etc.)
  - Activity Description (`Body mount Leakage test`, `Seat Leakage`, etc.)
  - Extent of Examination (`100%`, `Spot checks`, etc.)
  - Reference Document (`AGES-SP-04-002`, `API 598`, `FCI 70.2`, `ISO 15848-2`)
  - Acceptance Criteria (exact verbatim technical text)
  - Verifying Document (`Report`, `TC`, `3.2 COC`)
  - Quality Intervention Matrix: Sub-vendor, Supplier (KSB), TPIA (Intertek), EPC Contractor (Archirodon), Client (ADNOC) with codes (`H`, `W`, `W(10%)`, `R`, `RW`, `M`, `A`)
  - Inspection Level (`I`, `II`, `III`, `IV`)

### 3.4 Inspection Checklist & Result Engine (FR-RES)
- **FR-RES-01**: Intersect RFI requested activities with ITP master requirements to generate today's actionable inspection checklist.
- **FR-RES-02**: Support inspection lifecycle statuses:
  - `PENDING`, `IN_PROGRESS`, `ACCEPTABLE`, `NOT_ACCEPTABLE`, `ON_HOLD`, `NOT_APPLICABLE`, `REQUIRES_REVIEW`
- **FR-RES-03**: **CRITICAL RULE**: System must NEVER assume or default an inspection result to "Passed" or "Acceptable" based on ITP acceptance criteria. All results start as `PENDING`.
- **FR-RES-04**: Field result captures:
  - Actual test date, start time, end time
  - Result status (`ACCEPTABLE`, `NOT_ACCEPTABLE`, etc.)
  - Specific measurements: Test medium (`Water`, `Air`, `Nitrogen`), Test pressure (`59 kg/cm²`), Holding time (`8 min`), Observed leakage (`None`), Stroke opening/closing times, Ambient temperature, Humidity, Lux levels
  - Linked instrument serial numbers
  - Linked photos
  - Entered by & Confirmed by stamps

### 3.5 Calibration Certificate Management (FR-CAL)
- **FR-CAL-01**: Extract instrument parameters: Instrument Name, Manufacturer, Model, Serial No (`M509`, `MQC599`), Certificate No, Calibration Date, Due Date / Expiry Date (`27/02/2027`), Range, Accuracy.
- **FR-CAL-02**: Deterministic validation: Check whether instrument calibration expiry date is `>=` inspection date.
- **FR-CAL-03**: Raise Critical Warning if an expired instrument is selected for an inspection activity.

### 3.6 Photo & Evidence Management (FR-PHT)
- **FR-PHT-01**: Ingest photos via Telegram and Web UI.
- **FR-PHT-02**: Attach metadata: Project, Inspection, Tag / Item No, Activity Clause, Category (`Name Plate`, `Body No Verification`, `Leak Test`, `Calibration`, `Stroke Test`, `FE Test`, `Dimension`, etc.), Caption, Geo/Timestamp.
- **FR-PHT-03**: AI Vision assistance to suggest photo category and OCR text (nameplate tag/serial detection).
- **FR-PHT-04**: Store pristine original image in object storage; generate optimized scaled thumbnails and report-embeddable formats.

### 3.7 Deterministic Validation Engine (FR-VAL)
- **FR-VAL-01**: Cross-document checks:
  - RFI ITP reference vs Uploaded ITP document number and revision
  - Project PO and project number consistency
  - Tag number and serial number consistency across RFI, datasheet, and inspection logs
- **FR-VAL-02**: Completeness checks:
  - Any required witness/hold activity lacking actual inspection results
  - Missing mandatory test parameters (e.g. pressure test lacking holding time or medium)
  - Missing photographic evidence for critical witness activities
  - Missing attendees or unrecorded hours/distances
- **FR-VAL-03**: Chronology checks:
  - Inspection date after previous visit date and before next visit date
  - Calibration validity on inspection date

### 3.8 Report Generation Engine (FR-REP)
- **FR-REP-01**: Use the master Word template (`KSB MIL CONTROLS LIMITED 15 Sept 26-Inspection Report Format.docx`) preserving all fonts, headers, footers, tables, styles, and margins.
- **FR-REP-02**: Populate Page 1 Customer & Supplier Data, Inspection Disposition, Summary Narrative.
- **FR-REP-03**: Populate Page 2 Inspection Time, Travel Hours, Distance, Attendees Table, Materials Table.
- **FR-REP-04**: Populate Page 3 Documents Used Table and Scope of Inspection Activity Table.
- **FR-REP-05**: Populate Page 4 Equipment & Instrumentation Calibration Table, Non-conformance list, Quality observations.
- **FR-REP-06**: Dynamically format photographic appendix with 2-up or 3-up table layout, high-res images, and descriptive captions matching the master template format.
- **FR-REP-07**: Export both DOCX (editable) and PDF (archival) versions.

### 3.9 Telegram Bot Interface (FR-TG)
- **FR-TG-01**: Authorization mapping: Telegram User ID -> System User Account -> Assigned Projects.
- **FR-TG-02**: Interactive guided commands (`/start`, `/new`, `/projects`, `/inspections`, `/result`, `/photo`, `/cert`, `/validate`, `/generate`, `/review`, `/final`).
- **FR-TG-03**: Support document upload (PDF/DOCX) with instant extraction summary and confirmation buttons.
- **FR-TG-04**: Support natural language text & voice messages ("Valve 1006 body leakage acceptable at 59 kg/cm2 water medium 8 min holding") parsing into structured preview with `[Confirm]` / `[Edit]` / `[Cancel]` buttons.

---

## 4. Non-Functional Requirements
- **NFR-01 Security**: JWT authentication, bcrypt password hashing, role-based access control, parameterized SQL queries, signed S3 URLs.
- **NFR-02 Reliability**: Zero data loss, immutable audit events, versioned report drafts.
- **NFR-03 AI Provider Agnosticism**: Standardized abstraction layer (`AIProviderInterface`) allowing pluggable models (Gemini, Claude, OpenAI, or local offline LLMs).
- **NFR-04 Performance**: PDF extraction `< 5s`, Report DOCX generation `< 4s`, Web UI load `< 1s`.
- **NFR-05 Portability**: 100% containerized with Docker & docker-compose.

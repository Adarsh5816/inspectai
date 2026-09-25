# INSPECTAI - Technical Implementation Plan
**AI-Powered Inspection Report Automation System**

## 1. Executive Summary & Goal
Build and deploy `INSPECTAI`, a complete full-stack web and Telegram bot system automating the end-to-end industrial inspection report lifecycle for control valves and vendor equipment. The system parses engineering documents (RFI, ITP, Calibration, Procedures), generates interactive checklists, validates field evidence against deterministic rules, and outputs 14-page audit-grade DOCX/PDF inspection reports matching the customer template.

---

## 2. Architecture & Tech Stack
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS + Lucide Icons (Responsive, B2B industrial SaaS layout)
- **Backend API**: Node.js + Express + TypeScript (Modular controller-service-repository architecture)
- **Database**: PostgreSQL 16 + Prisma ORM (Fully normalized with UUIDs, audit logging)
- **Object Storage**: S3-compatible (MinIO / AWS S3 / Local file vault adapter)
- **Telegram Bot**: `node-telegram-bot-api` with webhook & long-poll fallback, inline keyboards, voice/photo handlers
- **AI Abstraction Layer**: Pluggable provider system (Gemini, Claude, OpenAI, and high-accuracy Local Rules/Regex engine)
- **Document & Report Processing**:
  - `pdf-parse` v2 + custom tabular parser for RFI/ITP extraction
  - `jszip` + XML DOM builder for pristine 14-page Word template population
  - Dynamic image embedding for multi-page photo appendices
  - LibreOffice / Puppeteer for PDF export
- **Deployment**: Docker, Dockerfile, docker-compose.yml, db migrations, seeds

---

## 3. Work Breakdown & Implementation Phases

### Phase 1: Foundation & Document Analysis (Completed)
- ✅ Reference files analyzed (ITP 24-page PDF, RFI-109, RFI-113, Calibration certs, 14-page DOCX template)
- ✅ Architecture, database schema, schemas, validation rules, telegram flows, and template mappings authored in `docs/`

### Phase 2: Database & Backend Core
- **Database & Prisma**:
  - Configure `prisma/schema.prisma` with 13 relational models.
  - Setup SQLite/PostgreSQL configuration with automatic fallback for immediate local execution.
  - Seed database with sample project (`P30339B`), reference ITP (`CD13E-ITP-CV-001`), RFI (`RFI-0109`), valves (`14-01-FCV-1601-01A`, `14-01-FCV-1601-01B`), and calibration instruments (`MQC599`, `FC25004354`).
- **Backend Server (`server/`)**:
  - Express server with TypeScript, JWT authentication, role guards (`ADMIN`, `INSPECTOR`, `REVIEWER`, `VIEWER`).
  - REST endpoints for Projects, Documents, Inspections, Activities, Results, Photos, Calibration, Validation, and Reports.
  - Audit event logger middleware.

### Phase 3: Document Processing & AI Services
- **Document Processing Service (`server/services/documentService.ts`)**:
  - Auto-classification (`RFI`, `ITP`, `CALIBRATION`, `DATASHEET`, etc.).
  - RFI extraction parser: Header, contact persons, activities requested, valve itemization table.
  - ITP extraction parser: Clauses, acceptance criteria, intervention levels (H/W/R/A).
  - Calibration parser: Instrument, serial number, certificate number, expiry date.
  - Confidence scoring and provenance mapping (source doc + page).
- **AI Abstraction Service (`server/services/aiService.ts`)**:
  - Pluggable interface for LLM, Vision, and Voice.
  - Development provider using robust NLP regex/rule-based parsing for offline operation without requiring external API keys.

### Phase 4: Inspection Engine & Deterministic Validation
- **Inspection Engine (`server/services/inspectionService.ts`)**:
  - Checklist generation intersecting RFI requests with ITP clauses.
  - Lifecycle state transitions (`PENDING` -> `ACCEPTABLE`, etc.).
  - Anti-hallucination guard: Zero unconfirmed or invented test measurements.
- **Validation Engine (`server/services/validationService.ts`)**:
  - Executes 18 deterministic rules (VAL-DOC-001 through VAL-REP-003).
  - Evaluates blocking errors and warnings for drafts and final reports.

### Phase 5: Report Generation Engine (DOCX & PDF)
- **DOCX Template Assembler (`server/services/reportService.ts`)**:
  - Load master Word template `KSB MIL CONTROLS LIMITED 15 Sept 26-Inspection Report Format.docx`.
  - Populate executive summary, attendees, materials, documents used, scope of inspection, calibration details.
  - Build dynamic Section 6.0 photograph matrix with proper captions and image relationships.
  - Versioned report management (`Draft v1`, `Draft v2`, `Final`).
  - PDF generation export.

### Phase 6: Telegram Bot Field Workflow
- **Telegram Bot Service (`server/services/telegramBotService.ts`)**:
  - User authorization guard against `telegramUserId`.
  - Commands: `/start`, `/new`, `/status`, `/checklist`, `/result`, `/photo`, `/cert`, `/validate`, `/draft`, `/approve`.
  - Inline keyboards for interactive confirmation.
  - Document upload listener with automatic parsing.
  - Free-text and voice note parsing into structured test results.

### Phase 7: Web Dashboard UI
- **React 19 Frontend (`client/`)**:
  - **Dashboard Overview**: Active inspections, KPIs, quick actions.
  - **Inspection Workspace**: Real-time progress bar, equipment cards, activity checklist with status badges.
  - **Result Entry Modal**: Numeric inputs for test pressure, holding time, medium dropdown, remarks.
  - **Document Center**: Document upload, extraction viewer with provenance highlighting.
  - **Photo Gallery**: Tagged photo grid, category filters, OCR verification chip.
  - **Calibration Vault**: Instrument status, validity indicator (green/red), expiry countdown.
  - **Validation & Report Review**: Live warning list, side-by-side report review, one-click draft and final DOCX/PDF downloads.
  - **Audit Trail**: Real-time timeline of all project events.

### Phase 8: Testing, Dockerization & Verification
- Automated unit and integration tests:
  - Document parser tests (RFI, ITP, Calibration).
  - Validation engine test suite.
  - Report generator DOCX structure verification.
- Dockerfile & docker-compose.yml configuration.
- End-to-end user journey test verifying the complete 25-step acceptance criteria.

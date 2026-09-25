# INSPECTAI - Database Schema Specification

## 1. Entity Relationship Overview
The database uses PostgreSQL with Prisma ORM. All primary keys are UUIDs (`v4`), with indexed foreign keys, timestamps, and relational integrity constraints.

```
                      +-------------------+
                      |       User        |
                      +---------+---------+
                                | 1
                                |
                                | *
                      +---------v---------+
                      |      Project      |
                      +----+---------+----+
                           |         |
                  1        |         | 1
           +---------------+         +---------------+
           |                                         |
           | *                                       | *
+----------v----------+                   +----------v----------+
|      Document       |                   |     Inspection      |
+----------+----------+                   +----+-----------+----+
           |                                   |           |
           | 1                                 | 1         | 1
           |                                   |           |
           | *                                 | *         | *
+----------v----------+               +--------v---+   +---v---------+
| DocumentExtraction  |               | Attendee   |   | Observation |
+---------------------+               +------------+   +-------------+
                                               |
                                               | 1
                                               |
                   +---------------------------+---------------------------+
                   |                           |                           |
                   | *                         | *                         | *
         +---------v---------+       +---------v---------+       +---------v---------+
         |  InspectionItem   |       |InspectionActivity |       |    Instrument     |
         +---------+---------+       +---------+---------+       +---------+---------+
                   |                           |                           |
                   | 1                         | 1                         | 1
                   |                           |                           |
                   | *                         | *                         | *
                   +-------------+-------------+                           |
                                 |                                         |
                                 v *                                       | *
                      +---------------------+                    +---------v---------+
                      |  InspectionResult   |                    | CalibrationCert   |
                      +----------+----------+                    +-------------------+
                                 |
                                 | 1
                                 |
                                 | *
                      +----------v----------+
                      |        Photo        |
                      +---------------------+
```

---

## 2. Relational Schema Definition (Prisma Models)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  ADMIN
  INSPECTOR
  REVIEWER
  VIEWER
}

enum DocumentType {
  RFI
  ITP
  DATASHEET
  GAD
  FAT_PROCEDURE
  TEST_PROCEDURE
  CALIBRATION_CERTIFICATE
  MATERIAL_CERTIFICATE
  INSPECTION_REPORT
  OTHER
}

enum InspectionStatus {
  DRAFT
  IN_PROGRESS
  UNDER_REVIEW
  APPROVED
  COMPLETED
  CANCELLED
}

enum ActivityStatus {
  PENDING
  IN_PROGRESS
  ACCEPTABLE
  NOT_ACCEPTABLE
  ON_HOLD
  NOT_APPLICABLE
  REQUIRES_REVIEW
}

enum InterventionType {
  H       // Hold
  W       // Witness 100%
  W_10    // Witness 10%
  R       // Review
  RW      // Random Witness
  M       // Monitoring
  A       // Approval
}

enum ObservationType {
  POSITIVE
  NEGATIVE
}

enum ObservationCriticality {
  CRITICAL
  NON_CRITICAL
}

// -------------------------------------------------------------
// 1. User & Authorization
// -------------------------------------------------------------
model User {
  id              String         @id @default(uuid())
  email           String         @unique
  passwordHash    String
  fullName        String
  role            Role           @default(INSPECTOR)
  organization    String?        // e.g., "Intertek", "ADNOC Onshore"
  telegramUserId  String?        @unique
  telegramUsername String?
  isActive        Boolean        @default(true)
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  createdProjects Project[]      @relation("ProjectCreator")
  assignedInspections Inspection[] @relation("InspectorAssignments")
  auditEvents     AuditEvent[]
  reportsCreated  ReportVersion[]
}

// -------------------------------------------------------------
// 2. Project
// -------------------------------------------------------------
model Project {
  id              String         @id @default(uuid())
  projectNumber   String         @unique // e.g. "P30339B"
  projectName     String         // e.g. "EPC for SE AiP5 Project (On plot) - ASAB/SAHIL (Package 1)"
  customerName    String         // e.g. "ADNOC Onshore"
  customerAddress String?
  epcContractor   String?        // e.g. "Archirodon"
  supplierName    String         // e.g. "KSB MIL Controls Limited"
  supplierAddress String?
  subSupplierName String?        // e.g. "Specialised Coating Services"
  poNumber        String         // e.g. "04108-PM-INST-008"
  createdById     String
  createdBy       User           @relation("ProjectCreator", fields: [createdById], references: [id])
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  documents       Document[]
  inspections     Inspection[]
  instruments     Instrument[]
}

// -------------------------------------------------------------
// 3. Document Repository & Provenance
// -------------------------------------------------------------
model Document {
  id              String         @id @default(uuid())
  projectId       String
  project         Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  documentType    DocumentType
  documentNumber  String?        // e.g. "P30339B-30-99-52-4607"
  revision        String?        // e.g. "Rev C", "Rev 2"
  title           String
  originalFilename String
  storageKey      String         // S3 URI / path
  mimeType        String
  fileSizeBytes   Int
  pageCount       Int            @default(1)
  isVerified      Boolean        @default(false)
  uploadedAt      DateTime       @default(now())

  extractions     DocumentExtraction[]
  inspectionRFIs  Inspection[]   @relation("InspectionRFI")
  inspectionITPs  Inspection[]   @relation("InspectionITP")
}

model DocumentExtraction {
  id              String         @id @default(uuid())
  documentId      String
  document        Document       @relation(fields: [documentId], references: [id], onDelete: Cascade)
  extractedData   Json           // Normalized JSON conforming to document-schema.json
  rawText         String?        // Full extracted text
  confidence      Float          @default(1.0)
  provenanceMap   Json?          // Field-by-field source page & bbox
  extractedAt     DateTime       @default(now())
}

// -------------------------------------------------------------
// 4. Inspection (Master Session)
// -------------------------------------------------------------
model Inspection {
  id              String           @id @default(uuid())
  projectId       String
  project         Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  reportNumber    String           // e.g. "KTI-IR-P30339B-0109-01"
  rfiDocumentId   String?
  rfiDocument     Document?        @relation("InspectionRFI", fields: [rfiDocumentId], references: [id])
  itpDocumentId   String?
  itpDocument     Document?        @relation("InspectionITP", fields: [itpDocumentId], references: [id])
  inspectionType  String           // e.g. "FAT", "Stage Inspection", "Pre-Inspection"
  location        String           // e.g. "Meladoor, Annamanada, Kerala"
  startDate       DateTime
  endDate         DateTime?
  previousVisitDate DateTime?
  nextVisitDate   DateTime?
  workingHours    Float            @default(8.0)
  travelHours     Float            @default(0.0)
  travelDistanceKm Float           @default(0.0)
  inspectorId     String
  inspector       User             @relation("InspectorAssignments", fields: [inspectorId], references: [id])
  status          InspectionStatus @default(DRAFT)
  disposition     String?          // "Accept", "Nonconformance(s) Identified", "Hold"
  summaryNarrative String?         // Final inspection conclusion
  recommendedAction String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  items           InspectionItem[]
  activities      InspectionActivity[]
  results         InspectionResult[]
  attendees       Attendee[]
  observations    Observation[]
  photos          Photo[]
  reports         ReportVersion[]
  auditEvents     AuditEvent[]
}

// -------------------------------------------------------------
// 5. Inspection Items (Valves / Equipment)
// -------------------------------------------------------------
model InspectionItem {
  id              String         @id @default(uuid())
  inspectionId    String
  inspection      Inspection     @relation(fields: [inspectionId], references: [id], onDelete: Cascade)
  poItemNo        String         // e.g. "'79", "'80"
  tagNumber       String         // e.g. "14-01-FCV-1601-01A"
  serialNumber    String         // e.g. "25009567"
  jobNo           String?        // e.g. "CD13E085"
  itemName        String         // e.g. "Control Valve"
  valveSeries     String?        // e.g. "41611"
  sizeInch        String?        // e.g. "24''"
  rating          String?        // e.g. "ASME #600 RF"
  bodyMaterial    String?        // e.g. "Gr WCC"
  areaLocation    String?        // e.g. "ASAB"
  orderedQty      Int            @default(1)
  presentedQty    Int            @default(1)
  acceptedThisVisit Int          @default(1)
  acceptedToDate  Int            @default(1)

  results         InspectionResult[]
  photos          Photo[]
}

// -------------------------------------------------------------
// 6. Inspection Activities (From ITP)
// -------------------------------------------------------------
model InspectionActivity {
  id              String           @id @default(uuid())
  inspectionId    String
  inspection      Inspection       @relation(fields: [inspectionId], references: [id], onDelete: Cascade)
  clauseNumber    String           // e.g. "7.1", "7.2(b)", "8.13"
  activityName    String           // e.g. "Body mount Leakage test"
  extentOfExam    String           // e.g. "100%", "Spot checks"
  referenceDoc    String?          // e.g. "AGES-SP-04-002, API 598"
  acceptanceCriteria String        // Verbatim technical requirements
  verifyingDoc    String?          // e.g. "Report", "TC"
  interventionSupplier InterventionType?
  interventionTPIA InterventionType?
  interventionClient InterventionType?
  isMandatoryInRFI Boolean         @default(true)
  status          ActivityStatus   @default(PENDING)

  results         InspectionResult[]
  photos          Photo[]
}

// -------------------------------------------------------------
// 7. Inspection Results (Field Measurement Evidence)
// -------------------------------------------------------------
model InspectionResult {
  id              String             @id @default(uuid())
  inspectionId    String
  inspection      Inspection         @relation(fields: [inspectionId], references: [id], onDelete: Cascade)
  itemId          String
  item            InspectionItem     @relation(fields: [itemId], references: [id], onDelete: Cascade)
  activityId      String
  activity        InspectionActivity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  status          ActivityStatus     @default(PENDING)
  testDate        DateTime           @default(now())
  testMedium      String?            // e.g. "Water", "Air", "Nitrogen"
  testPressure    Float?             // Numerical value
  pressureUnit    String?            // "kg/cm²", "bar", "psi"
  holdingTimeMin  Float?             // e.g. 8.0 minutes
  leakageObserved String?            // "None", "0 ml/min", etc.
  strokeOpenSec   Float?
  strokeCloseSec  Float?
  ambientTempC    Float?
  humidityPercent Float?
  luxLevel        Float?
  remarks         String?
  confirmedByUser Boolean            @default(false)
  enteredVia      String             // "TELEGRAM_VOICE", "TELEGRAM_TEXT", "WEB_UI"
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt

  photos          Photo[]
}

// -------------------------------------------------------------
// 8. Calibration & Instruments
// -------------------------------------------------------------
model Instrument {
  id              String           @id @default(uuid())
  projectId       String
  project         Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  instrumentName  String           // e.g. "Stop Watch", "FE Testing Machine"
  manufacturer    String?          // e.g. "Racer", "PC Progetti"
  model           String?
  serialNumber    String           // e.g. "MQC599", "M509"
  certificates    CalibrationCert[]
}

model CalibrationCert {
  id              String         @id @default(uuid())
  instrumentId    String
  instrument      Instrument     @relation(fields: [instrumentId], references: [id], onDelete: Cascade)
  certificateNo   String         // e.g. "SLT/26/02/415/008"
  calibratedDate  DateTime
  expiryDate      DateTime       // e.g. 2027-02-27
  rangeDescription String?       // e.g. "0-60 min", "0-100 bar"
  accuracy        String?
  storageKey      String?        // PDF scan
  createdAt       DateTime       @default(now())
}

// -------------------------------------------------------------
// 9. Attendees
// -------------------------------------------------------------
model Attendee {
  id              String         @id @default(uuid())
  inspectionId    String
  inspection      Inspection     @relation(fields: [inspectionId], references: [id], onDelete: Cascade)
  name            String         // e.g. "Adarsh MS", "Shibu C", "Alex Davis"
  company         String         // e.g. "Intertek", "KTI", "KSB MIL"
  representedOrg  String         // e.g. "ADNOC", "ARCHIRODON", "Vendor"
  title           String         // e.g. "Inspection Engineer"
  email           String?
  phone           String?
}

// -------------------------------------------------------------
// 10. Observations & Non-conformances
// -------------------------------------------------------------
model Observation {
  id              String                 @id @default(uuid())
  inspectionId    String
  inspection      Inspection             @relation(fields: [inspectionId], references: [id], onDelete: Cascade)
  itemDescription String                 // e.g. "Control Valve"
  obsType         ObservationType        @default(POSITIVE)
  criticality     ObservationCriticality @default(NON_CRITICAL)
  category        String                 // e.g. "Documentation", "Testing", "Visual"
  subCategory     String?                // e.g. "Dimensional Inspection"
  comments        String
  ncrNumber       String?                // Optional NCR tag
  dateRaised      DateTime?
  dateClosed      DateTime?
  createdAt       DateTime               @default(now())
}

// -------------------------------------------------------------
// 11. Photos & Evidence
// -------------------------------------------------------------
model Photo {
  id              String              @id @default(uuid())
  inspectionId    String
  inspection      Inspection          @relation(fields: [inspectionId], references: [id], onDelete: Cascade)
  itemId          String?
  item            InspectionItem?     @relation(fields: [itemId], references: [id])
  activityId      String?
  activity        InspectionActivity? @relation(fields: [activityId], references: [id])
  resultId        String?
  result          InspectionResult?   @relation(fields: [resultId], references: [id])
  storageKey      String              // S3 path
  thumbnailKey    String?
  originalFilename String
  category        String              // "Name Plate", "Leak Test", "Calibration", etc.
  caption         String              // Description in report
  aiSuggestedCategory String?
  detectedTags    String[]
  ocrExtractedText String?
  confirmedByUser Boolean             @default(true)
  sortOrder       Int                 @default(0)
  uploadedAt      DateTime            @default(now())
}

// -------------------------------------------------------------
// 12. Report Versions & Archive
// -------------------------------------------------------------
model ReportVersion {
  id              String         @id @default(uuid())
  inspectionId    String
  inspection      Inspection     @relation(fields: [inspectionId], references: [id], onDelete: Cascade)
  versionNumber   Int            // 1, 2, 3...
  isFinal         Boolean        @default(false)
  docxStorageKey  String
  pdfStorageKey   String?
  snapshotData    Json           // Full immutable JSON snapshot of all fields at generation time
  generatedById   String
  generatedBy     User           @relation(fields: [generatedById], references: [id])
  generatedAt     DateTime       @default(now())
}

// -------------------------------------------------------------
// 13. Audit Trail
// -------------------------------------------------------------
model AuditEvent {
  id              String         @id @default(uuid())
  inspectionId    String?
  inspection      Inspection?    @relation(fields: [inspectionId], references: [id], onDelete: Cascade)
  userId          String?
  user            User?          @relation(fields: [userId], references: [id])
  action          String         // e.g. "DOCUMENT_UPLOADED", "RESULT_ENTERED", "REPORT_GENERATED"
  entityType      String         // "Document", "InspectionResult", "Report"
  entityId        String?
  details         Json?
  ipAddress       String?
  timestamp       DateTime       @default(now())
}
```

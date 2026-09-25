# INSPECTAI - Report Template Mapping Specification
**Master Template:** `KSB MIL CONTROLS LIMITED 15 Sept 26-Inspection Report Format.docx`
**Form Identification:** Intertek Form MI-1220-01 (Revision 0 / DRAFT D)

---

## 1. Master Template Structural Anatomy

The analysis of the 14-page template reveals the following XML architecture:
- **Total Tables**: 20 tables embedded across 4 major sections and photo appendices.
- **Headers & Footers**:
  - `word/header1.xml`: Running page header with `Report No:`, `Date of Report:`, `Customer:`, Page X of Y.
  - `word/footer1.xml`: Running footer with Form MI-1220-01, Revision 0, Date.
- **Images**: 33 photographic evidence slots embedded in table grids with captions underneath.

---

## 2. Table-by-Table & Field-by-Field Mapping Matrix

### Page 1: Executive Summary & Administrative Header
| Template Field / Block | XML / Table Location | Target Content / Style | Data Source in System |
|---|---|---|---|
| **Report No** | Header (`header1.xml`) | `Report No: 001` | `Inspection.reportNumber` |
| **Date of Report** | Header (`header1.xml`) | `Date of Report: 15 Sept 2026` | `Inspection.startDate` (formatted) |
| **Customer Name** | Table 1, Row 1, Col 1 | `Name: ADNOC Onshore` | `Project.customerName` |
| **Customer Address** | Table 1, Row 2, Col 1 | `P.O. Box 270, Abu Dhabi, UAE` | `Project.customerAddress` |
| **Customer Attn** | Table 1, Row 3, Col 1 | `Attn: Islam Khalifa` | `Project.customerContact` |
| **Customer Email** | Table 1, Row 5, Col 1 | `E-Mail: i.khalifa@adco.ae` | `Project.customerEmail` |
| **Intertek Project No** | Table 1, Row 1, Col 2 | `Intertek Project No. 106792-25` | `Project.intertekProjectNo` |
| **Requisition No** | Table 1, Row 3, Col 2 | `Requisition No: P30339B-RFI-...` | `RFI.rfiNumber` |
| **Contract Coordinator**| Table 1, Row 6, Col 2 | `Chethan Ramesh` | `Project.coordinatorName` |
| **Inspection Performed**| Table 2, Row 1, Col 1 | Checkbox: `With Customer Supplier` | `Inspection.performedWith` |
| **Date(s) of Visit(s)**| Table 2, Row 1, Col 2 | `15/09/2026` | `Inspection.inspectionDates` |
| **PO Number** | Table 2, Row 2, Col 1 | `04108-PM-INST-008` | `Project.poNumber` |
| **Date of Previous Visit**| Table 2, Row 2, Col 2 | `NA` | `Inspection.previousVisitDate` |
| **Supplier Name & Addr**| Table 2, Row 3, Col 1 | `KSB MIL CONTROLS LIMITED...` | `Project.supplierName`, `supplierAddress` |
| **Date of Next Visit** | Table 2, Row 3, Col 2 | `16/09/2026` | `Inspection.nextVisitDate` |
| **Project Name** | Table 2, Row 5, Col 1 | `EPC for SE AiP5 Project...` | `Project.projectName` |
| **Inspection Location** | Table 2, Row 5, Col 2 | `Meladoor, Annamanada...` | `Inspection.location` |
| **Materials Inspected** | Table 2, Row 6, Col 1 | `Control Valve` | `Inspection.materialSummary` |
| **Primary Contact** | Table 2, Row 6, Col 2 | `Mr. Alex Davis...` | `Project.supplierContact` |
| **Inspection Disposition**| Table 3, Row 1 | Checkbox: `[X] Accept` | `Inspection.disposition` |
| **Inspection Summary** | Paragraphs below Table 3 | Narrative referencing ITP and clauses | `Inspection.summaryNarrative` |
| **Recommended Action** | Paragraph | Inspection release or follow-up | `Inspection.recommendedAction` |

---

### Page 2: Operational Times, Attendees & Materials Inspected
| Template Field / Block | XML / Table Location | Target Content / Style | Data Source in System |
|---|---|---|---|
| **Inspection Time** | Table 4, Row 1, Col 1 | `HOURS: 8` | `Inspection.workingHours` |
| **Travel Hours** | Table 4, Row 1, Col 2 | `5` | `Inspection.travelHours` |
| **Travel Distance** | Table 4, Row 1, Col 3 | `160 KM` | `Inspection.travelDistanceKm` |
| **Attendees Table** | Table 5 (3 columns: Name, Company Represented, Title) | Dynamic rows: `Adarsh MS`, `Shibu C`, `Sabari Giri` | `Inspection.attendees` |
| **Generic Materials** | Table 6 (Tag No, Description) | `14-01-FCV-1601-01A`, `14-01-FCV-1601-01B` | `InspectionItem.tagNumber`, `description` |
| **Materials Inspected Detail**| Table 7 (PO Item No, Tag/Serial No, Item Name, Ordered Qty, Presented Qty, Accepted Visit, Accepted to Date) | `'79 14-01-FCV-1601-01A Control Valve 1 1 1 1` | `InspectionItem` records |

---

### Page 3: Documents Used & Scope of Inspection
| Template Field / Block | XML / Table Location | Target Content / Style | Data Source in System |
|---|---|---|---|
| **Documents Used Table**| Table 8 (Doc No, Revision, Title, Approval Status) | `P30339B-RFI-... (Rev 1)`, `P30339B-30-99-52-4607 (Rev C)`, `AGES-SP-04-002`, `14-01-5046431 (GA)` | Active project documents referenced |
| **Scope of Inspection**| Table 9 (ITP Line No, ITP Activity Description, Items, Results) | `Clause 7.3 (c) Actuator Chamber - Acceptable`<br>`Clause 7.4 (a) Stroke Checking - Acceptable`<br>`Clause 7.12 Fugitive Emission - Acceptable` | `InspectionActivity` and linked `InspectionResult` |

---

### Page 4: Metrology, Quality Observations & Attachments
| Template Field / Block | XML / Table Location | Target Content / Style | Data Source in System |
|---|---|---|---|
| **Equipment & Calibration**| Table 10 (Equipment Description, Serial No, Cal Cert No, Expiry Date) | `Stop Watch MQC599 SLT/26/02/415/008 27/02/2027`<br>`FE Rig FC25004354 101209 11/02/2027`<br>`Tape MIL-QC-1319 SLT/26/04/480/021 16/10/2026` | `Instrument` and `CalibrationCert` |
| **Non-conformances** | Table 11 (NCR #, Description, Date Raised, Date Closed) | `- - -` or listed NCRs | `Observation` (critical items) |
| **Quality Observations** | Table 12 & Form checkboxes | Positive/Negative, Critical/Non-Critical, Category, Comments | `Observation` records |
| **Attachments Checklist** | Table 13 | Annexure list, Calibration certs reviewed | Selected attachment references |

---

### Pages 5–14: Inspection Evidence Photographs (Section 6.0)
| Template Block | Layout Structure | Format & Content | Data Source in System |
|---|---|---|---|
| **Photo Matrix Grid** | 2 columns x 3 rows per page (6 photos per page) | Embedded JPEG image, width ~2.8 inches, height proportional | `Photo.storageKey` |
| **Photo Caption Cell** | Single cell directly below each image | 1-line or 2-line bold label (e.g. `Control Valve Name Plate verification`, `Air Cut off Signal`, `FE Test 80 kg/cm²`) | `Photo.caption` |
| **Dynamic Scaling** | Auto-pagination | If inspection has 24 photos, generate 4 photo pages automatically; if 12 photos, generate 2 pages | Photo collection filtered by inspection |

---

## 3. Template Transformation & Replacement Strategy
1. **Preserve Master Styling**: Rather than building DOCX from scratch, use `KSB MIL CONTROLS LIMITED 15 Sept 26-Inspection Report Format.docx` as an input template.
2. **XML Manipulation Engine**:
   - Parse `word/document.xml` using a DOM parser / JSZip.
   - Replace text placeholder nodes in Table 1 through Table 13.
   - Replace row templates in Table 5 (Attendees), Table 7 (Materials Inspected), Table 8 (Documents Used), Table 9 (Scope), and Table 10 (Calibration).
   - Reconstruct the Section 6.0 photo tables with actual inspection photos and captions.
   - Rebuild `word/_rels/document.xml.rels` with generated `rId` relationship identifiers pointing to `word/media/image*.jpeg`.
   - Update `word/header1.xml` with report number and customer name.
3. **Safety & Fallback**:
   - Original master template remains untouched as read-only asset in `templates/`.
   - Every generation operation writes to an isolated file path in the project vault.

# INSPECTAI - Deterministic Validation Rules

## 1. Overview
The Validation Engine enforces data integrity, safety, and compliance before any draft or final inspection report is generated.
Rules are categorized into:
- **BLOCKING_ERROR**: Prevents generation of FINAL reports (draft may be generated with prominent watermarks).
- **WARNING**: Requires explicit human acknowledgment/confirmation before final sign-off.
- **INFO**: Noteworthy discrepancy highlighted for quality awareness.

---

## 2. Rule Specifications

### Category 1: Document & Cross-Reference Integrity
| Rule ID | Rule Name | Description | Severity | Trigger Condition |
|---|---|---|---|---|
| `VAL-DOC-001` | ITP Reference Match | RFI specified ITP number must match uploaded/selected ITP document | BLOCKING_ERROR | `rfi.itp_reference.number != itp.document_number` |
| `VAL-DOC-002` | ITP Revision Match | RFI specified ITP revision must match uploaded/selected ITP revision | WARNING | `rfi.itp_reference.revision != itp.revision` |
| `VAL-DOC-003` | PO Number Consistency | PO number must match across RFI, ITP, and Project details | BLOCKING_ERROR | `rfi.po_number != project.po_number` |
| `VAL-DOC-004` | Project Code Consistency | Project code must be identical across all ingested records | BLOCKING_ERROR | `rfi.project_number != project.project_number` |
| `VAL-DOC-005` | Supplier Consistency | Supplier name in RFI must match project supplier record | WARNING | Levenshtein similarity < 0.85 |

### Category 2: Chronology & Date Integrity
| Rule ID | Rule Name | Description | Severity | Trigger Condition |
|---|---|---|---|---|
| `VAL-DAT-001` | Inspection Date Window | Actual inspection date must fall within dates specified in RFI | WARNING | `actual_date < rfi.start_date` OR `actual_date > rfi.end_date` |
| `VAL-DAT-002` | Chronological Sequence | Report date cannot precede the inspection start date | BLOCKING_ERROR | `report_date < inspection.start_date` |
| `VAL-DAT-003` | Previous Visit Chronology | Date of previous visit must strictly precede current visit | BLOCKING_ERROR | `previous_visit_date >= inspection.start_date` |
| `VAL-DAT-004` | Next Visit Chronology | Date of next scheduled visit must strictly succeed current visit | WARNING | `next_visit_date <= inspection.start_date` |

### Category 3: Activity & Result Completeness (Anti-Hallucination)
| Rule ID | Rule Name | Description | Severity | Trigger Condition |
|---|---|---|---|---|
| `VAL-ACT-001` | Unconfirmed Result Block | No activity can be finalized if status is still PENDING | BLOCKING_ERROR | `count(activities where status == 'PENDING') > 0` (for final report) |
| `VAL-ACT-002` | Mandatory Witness Completed | All activities marked 'W' or 'H' in RFI must have recorded results | BLOCKING_ERROR | Required witness clause has no matching `InspectionResult` |
| `VAL-ACT-003` | Mandatory Test Medium | Pressure tests (hydro/pneumatic) must record the test medium | BLOCKING_ERROR | Clause in `[7.1, 7.2, 7.3, 6.1]` and `test_medium is null` |
| `VAL-ACT-004` | Mandatory Test Pressure | Pressure tests must record positive numeric test pressure and unit | BLOCKING_ERROR | Clause in `[7.1, 7.2, 7.3, 6.1]` and (`test_pressure <= 0` or null) |
| `VAL-ACT-005` | Mandatory Holding Time | Pressure/leakage tests must record holding time | WARNING | Clause in `[7.1, 7.2, 7.3]` and `holding_time_min is null` |
| `VAL-ACT-006` | Non-Acceptable Justification | If result is NOT_ACCEPTABLE or ON_HOLD, observations/remarks must be provided | BLOCKING_ERROR | `status in ['NOT_ACCEPTABLE', 'ON_HOLD']` and `length(remarks) < 10` |

### Category 4: Calibration & Metrology
| Rule ID | Rule Name | Description | Severity | Trigger Condition |
|---|---|---|---|---|
| `VAL-CAL-001` | Instrument Expiry Before Inspection | Calibration certificate expiry date must be AFTER the inspection date | BLOCKING_ERROR | `cert.expiry_date < inspection.startDate` |
| `VAL-CAL-002` | Serial Number Linkage | Instrument used in test must have a verified calibration certificate | WARNING | Instrument serial in test result not found in `Instrument` table |
| `VAL-CAL-003` | Expiring Within 7 Days | Instrument calibration expires within 7 days of inspection | WARNING | `0 <= cert.expiry_date - inspection.startDate <= 7 days` |

### Category 5: Equipment & Photographic Evidence
| Rule ID | Rule Name | Description | Severity | Trigger Condition |
|---|---|---|---|---|
| `VAL-PHT-001` | Mandatory Nameplate Photo | Nameplate / Tag verification photo must exist for each inspected valve | WARNING | Valve tag has no photo in category `Name Plate` or `Tag Verification` |
| `VAL-PHT-002` | Witness Activity Evidence | Critical witness tests (e.g. Shell Test, FE Test) should have at least 1 photo | WARNING | Activity 7.12 (FE) or 7.1 (Leakage) has zero linked photos |
| `VAL-PHT-003` | Photo OCR Tag Mismatch | OCR detected tag on photo does not match assigned valve tag number | WARNING | `photo.ocr_detected_tag != item.tag_number` |

### Category 6: Report Metadata & Attendee Verification
| Rule ID | Rule Name | Description | Severity | Trigger Condition |
|---|---|---|---|---|
| `VAL-REP-001` | Missing Attendees | Inspection must record at least 1 client/TPI and 1 vendor representative | WARNING | `attendees.length < 2` |
| `VAL-REP-002` | Missing Hours/Distance | Inspector hours and travel distance must be populated | WARNING | `inspection_hours <= 0` OR `travel_hours is null` |
| `VAL-REP-003` | Missing Documents Used | At least RFI and ITP must be listed in Documents Used section | BLOCKING_ERROR | Documents used table has fewer than 2 referenced documents |

---

## 3. Validation Execution Flow
1. **Real-Time Workspace Validation**: Evaluated on every field entry, photo upload, and status transition. Visible in Web Dashboard as a dynamic validation card with progress percentage and warning chips.
2. **Draft Report Gate**:
   - `BLOCKING_ERROR`: Allowed, but generates a prominent watermark: `DRAFT - CONTAINS ERRORS`.
   - `WARNING`: Highlighted on the Review screen.
3. **Final Report Sign-Off Gate**:
   - Zero `BLOCKING_ERROR` permitted.
   - All `WARNING` items must be explicitly confirmed/overridden with an inspector justification note in the audit trail.

# INSPECTAI - Telegram Bot Field Workflow Specification

## 1. Telegram Interaction Architecture

```
User (Inspector in Field)
          |
          v
[Telegram Mobile / Desktop Client]
          |
          | HTTPS Webhook POST
          v
[Backend Telegram Handler]
          |
          +--> [Authorization Guard] (Validates telegram_user_id)
          |
          +--> [Session State Machine] (Tracks current step / active inspection)
          |
          +--> [AI Field Natural Language Parser] (Voice / Free text -> Structured)
          |
          +--> [Interactive Confirmation Keyboards] (Never auto-commits unconfirmed data)
          |
          v
[Database & File Vault]
```

---

## 2. Command Set
- `/start` - Check authorization, show main welcome menu & active inspection.
- `/new` - Initiate new inspection workflow (prompts for RFI / ITP upload).
- `/today` - Shortcut to today's active inspection session.
- `/status` - Summary of items, progress %, completed vs pending activities.
- `/checklist` - Display current activities with status icons (⏳ Pending, ✅ Acceptable, ❌ Not Acceptable).
- `/result` - Enter a test result interactively or by voice/text.
- `/photo` - Instructions for uploading evidence photos.
- `/cert` - Upload or check calibration certificates.
- `/observation` - Record quality observation or note.
- `/attendee` - Add/modify inspector or vendor attendees.
- `/validate` - Run deterministic validation check and show blocking errors & warnings.
- `/draft` - Generate draft Word report and send preview link.
- `/approve` - Confirm final report generation.
- `/cancel` - Abort active interactive step.

---

## 3. Step-by-Step Conversational Workflows

### Scenario 1: New Inspection Setup via Telegram
```
User: /new

Bot:
📋 *NEW INSPECTION WORKFLOW*
Please select a Project or send an RFI PDF document to begin.
[Button: Select P30339B] [Button: Create New Project]

User uploads: P30339B-RFI-INST-008-ARC-INT-KSB-0109 Rev.0.pdf

Bot:
🔍 *Analyzing RFI Document...*
✅ Document Classified: *RFI (Confidence: 99%)*

*Extracted Details:*
• Project: `P30339B` - EPC for SE AiP5 Project
• RFI No: `P30339B-RFI-INST-008-ARC-INT-KSB-0109 Rev.0`
• Supplier: `KSB MIL CONTROLS LIMITED`
• Inspection Type: `FAT (Assembly Test & Painting)`
• Dates: `15th, 16th, 17th & 22nd Sep 2026`
• Tags Detected:
  - `14-01-FCV-1601-01A` (24" ASME #600)
  - `14-01-FCV-1601-01B` (24" ASME #600)
• ITP Ref: `P30339B-30-99-52-4607`

Do you want to link the master ITP now?
[Button: Use Existing ITP Rev C] [Button: Upload New ITP PDF]

User clicks: [Use Existing ITP Rev C]

Bot:
🎉 *Inspection Session Created!*
Report ID: `IR-P30339B-20260915-01`
Activities loaded: 14 checklist items
Tags: 2 valves

Use /checklist to view items or start sending results via text or voice!
```

---

### Scenario 2: Voice & Free-Text Inspection Result Capture
```
User sends Voice Note:
(Audio: "Valve 1601-01A body leakage test acceptable. Medium water. Pressure 59 kg per square centimetre. Holding time eight minutes. Zero leakage observed.")

Bot (Transcribes & AI-Structures):
🎙️ *Voice Result Processed*

• Valve Tag: `14-01-FCV-1601-01A`
• ITP Clause: `7.1 (Body Mount Leakage Test)`
• Result: ✅ *ACCEPTABLE*
• Medium: `Water`
• Test Pressure: `59 kg/cm²`
• Holding Time: `8 minutes`
• Leakage: `None`

⚠️ *Please confirm this result to save it:*
[Button: ✅ Confirm & Save] [Button: ✏️ Edit] [Button: ❌ Cancel]

User clicks: [✅ Confirm & Save]

Bot:
✅ *Result recorded successfully!*
Updated Progress: 1/14 activities completed (7%)
Next suggested test: `7.2 Seat Leakage`
```

---

### Scenario 3: Photo Evidence Upload with AI Assist
```
User sends photo of valve nameplate.

Bot:
📸 *Photo Received*
Analyzing image with AI vision...

• Suggested Category: `Name Plate / Tag Verification`
• Detected Text: `TAG: 14-01-FCV-1601-01A`, `SL: 25009567`
• Match Status: 🎯 *MATCHES PO ITEM #79*

Select valve and confirm category:
[Button: 14-01-FCV-1601-01A] [Button: 14-01-FCV-1601-01B]
[Button: Change Category] [Button: Confirm]

User clicks: [Confirm]

Bot:
✅ Photo saved and tagged to `14-01-FCV-1601-01A` under `Name Plate`!
```

---

### Scenario 4: Validation & Draft Report Request
```
User: /draft

Bot:
🔍 *Running Inspection Validation...*

*Validation Summary:*
• Items: 2/2 Complete
• Activities: 14/14 Recorded
• Attendees: 3 Recorded (Adarsh MS, Shibu C, Sabari Giri)
• Instruments: 3 Validated
  - Stopwatch MQC599: Valid till 27/02/2027 ✅
  - FE Rig FC25004354: Valid till 11/02/2027 ✅
• Photos: 18 photos attached
• Observations: 1 recorded

⚠️ *Warnings (0 Errors, 1 Warning):*
- Note: ITP revision on RFI states Rev C, latest ITP is Rev 2.

📄 *Draft Word Report Generated!*
Document: `IR-P30339B-20260915-01_Draft_v1.docx` (14 pages)

[Button: 📥 Download DOCX] [Button: 🌐 Review in Web Dashboard] [Button: ✍️ Sign & Approve Final]
```

# INSPECTAI - AI-Powered Inspection Report Automation System

An end-to-end industrial inspection management and report generation platform designed for oil & gas and engineering projects (ADNOC, CPECC, KSB, etc.).

## Features
- **Automatic RFI / ITP Extraction**: Ingests vendor RFIs and ITPs to extract Project Names, Project Numbers, ITP Numbers, Valves/Materials, and Inspection Activities.
- **Daily Inspection Checklist**: Interactive tracking of executed activities with test pressure, medium, holding time, and photo attachment.
- **Offered Materials Management**: Choose which valves/equipment are offered per visit.
- **Section 5.0 Equipment & Instrumentation**: Calibration tracking with 1-click loading of standard calibrated vendor tools (Pressure Gauge, Vernier Caliper, Stopwatch, etc.).
- **Dynamic DOCX Report Generator**: Replaces all Page 1 metadata, Summary Narratives, Scope of Inspection, Documents Used, Equipment lists, Attendees, and high-res Inspection Photos in Word documents matching official templates (e.g. KSB-Sept-15-Format).
- **100% Valid OpenXML Generation**: Guarantees documents open cleanly in Microsoft Word without recovery errors.

---

## Quick Start (Local Development)

### 1. Backend Server
```bash
cd server
npm install
npx prisma db push
npx prisma generate
npx tsx src/index.ts
```
The backend starts on `http://localhost:4000`.

### 2. Frontend Client
```bash
cd client
npm install
npm run dev
```
The frontend starts on `http://localhost:3000`.

---

## Deploy with Docker

```bash
docker compose up -d --build
```
Access the application at `http://localhost:4000`.

---

## Pushing to GitHub

1. Initialize git in the root folder:
   ```bash
   git init
   git branch -M main
   git add .
   git commit -m "Initial commit: INSPECTAI inspection report automation platform"
   ```
2. Link your GitHub repository:
   ```bash
   git remote add origin https://github.com/<YOUR-USERNAME>/<YOUR-REPO-NAME>.git
   git push -u origin main
   ```

---

## Hosting in a Test Environment

### Option A: Railway / Render (Easiest)
1. Push this repository to GitHub.
2. Log into [Railway.app](https://railway.app) or [Render.com](https://render.com).
3. Click **"New Project"** -> **"Deploy from GitHub repo"**.
4. Select your repository.
5. Railway/Render will automatically detect the `Dockerfile` and build both the frontend and backend.
6. Set the environment variable:
   - `JWT_SECRET`: Any random secure string.

### Option B: DigitalOcean / Linode / Any Ubuntu VPS
1. SSH into your VPS:
   ```bash
   git clone https://github.com/<YOUR-USERNAME>/<YOUR-REPO-NAME>.git
   cd <YOUR-REPO-NAME>
   docker compose up -d --build
   ```
2. The application will be live on `http://<your-vps-ip>:4000`.

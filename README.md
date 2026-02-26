# Digital Brochure Platform

A full-stack local platform for converting PDFs into beautiful, interactive digital flipbooks.

## Quick Start

```bash
# Install all dependencies (run once)
npm run install:all

# Start both backend + frontend (dev mode)
npm run dev
```

- **Frontend** → http://localhost:5173
- **Backend API** → http://localhost:3001

## Features

### User-facing (Viewer)
- Beautiful page-by-page PDF viewer with zoom controls
- Table of Contents sidebar (auto-generated or manually configured)
- Clickable QR codes detected automatically on each page
- Clickable hotspot areas that navigate to other pages or open URLs
- Keyboard navigation (← →)
- Cover page with book animation

### Admin
- Upload PDF brochures
- **QR Code Manager**: view auto-detected QR codes, edit URLs, export/import CSV
- **Hotspot Editor**: draw interactive areas on any page, link to pages or URLs
- **TOC Editor**: add/edit table of contents entries

## Architecture

```
digital_brochure/
├── backend/                  # Node.js + Express API (port 3001)
│   ├── routes/
│   │   ├── brochures.js     # CRUD for brochures
│   │   └── metadata.js      # TOC, QR codes, hotspots
│   ├── storage/
│   │   ├── pdfs/            # Uploaded PDF files
│   │   └── metadata/        # JSON metadata per brochure
│   └── server.js
├── frontend/                 # React + Vite (port 5173)
│   └── src/
│       ├── pages/
│       │   ├── Home.jsx     # Brochures library
│       │   ├── Cover.jsx    # Brochure cover page
│       │   ├── Viewer.jsx   # PDF viewer with hotspot overlay
│       │   ├── Admin.jsx    # Admin dashboard
│       │   └── BrochureAdmin.jsx  # Per-brochure editing
│       ├── components/
│       │   ├── TOC.jsx           # TOC sidebar
│       │   ├── HotspotLayer.jsx  # Clickable overlay
│       │   ├── HotspotEditor.jsx # Draw hotspots (admin)
│       │   └── QRManager.jsx     # QR code table (admin)
│       └── utils/
│           ├── api.js         # API client
│           ├── pdfLoader.js   # pdf.js wrapper
│           └── qrDetector.js  # jsQR wrapper
└── package.json              # Root: runs both via concurrently
```

## Data Model (per brochure JSON)

```json
{
  "id": "uuid",
  "title": "My Brochure",
  "filename": "uuid.pdf",
  "pageCount": 12,
  "toc": [{ "title": "Intro", "page": 1 }],
  "qrCodes": [{
    "id": "uuid", "page": 3, "url": "https://...",
    "location": { "x": 0.1, "y": 0.2, "w": 0.15, "h": 0.15 }
  }],
  "hotspots": [{
    "id": "uuid", "page": 6, "label": "Area 1",
    "action": { "type": "page", "value": "4" },
    "location": { "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.2 }
  }]
}
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/brochures | List all |
| POST | /api/brochures | Upload PDF |
| GET | /api/brochures/:id | Get one |
| PUT | /api/brochures/:id | Update title/desc |
| DELETE | /api/brochures/:id | Delete |
| GET | /api/metadata/:id | Full metadata |
| PUT | /api/metadata/:id | Update metadata |
| POST | /api/metadata/:id/qr-scan | Save QR scan results |
| PUT | /api/metadata/:id/qr/:qrId | Edit QR URL |
| GET | /api/metadata/:id/export.csv | Export QR as CSV |
| POST | /api/metadata/:id/hotspots | Add hotspot |
| PUT | /api/metadata/:id/hotspots/:id | Update hotspot |
| DELETE | /api/metadata/:id/hotspots/:id | Delete hotspot |
| PUT | /api/metadata/:id/toc | Update TOC |

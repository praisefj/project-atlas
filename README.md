# Project Atlas

Dark-mode situational awareness, live OSINT auto-geocoding, geofence mapping, and hazard-aware road routing platform built with React, Leaflet, Node.js, and Express.

## Quick Start

Run both the Express API (port 5000) and Vite frontend (port 5173) together:

    npm start

- Frontend UI: http://localhost:5173
- Backend API: http://localhost:5000
- Default Operator Command PIN: 2026

## Core Capabilities

- Zoom-Adaptive Radial Hotspots & Geofences: Concentric glowing radar zones contract dynamically as you zoom in, paired with multi-vertex polygon geofences.
- Two-Tier Verification & Operator Lock: Field reports enter as UNVERIFIED and promote to VERIFIED at 3 confirmations (Confirm +1) or under Operator Command Mode (PIN: 2026).
- Hazard-Aware Safe Navigation (Safe Nav): Computes OSRM road-snapped detours avoiding verified point radars and polygon geofences.
- Automated OSINT Ingestion & SitRep Export: Filters regional RSS feeds within a 21-day window, auto-pins landmarks, tracks telemetry in Stats, and exports Markdown SITREP briefings.
- Live GPS Beacon (Locate Me): Centers on your current location, checks proximity to active verified hazards, and snaps route origins or reports to live coordinates.
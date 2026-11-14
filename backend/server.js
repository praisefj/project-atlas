require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;
const INCIDENTS_FILE = path.join(__dirname, "data", "incidents.json");
const NEWS_FILE = path.join(__dirname, "data", "news.json");

app.use(cors());
app.use(express.json());

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

async function fetchOsrmCorridor(waypointsLatLng) {
  const coordString = waypointsLatLng
    .map(([lat, lng]) => `${lng.toFixed(5)},${lat.toFixed(5)}`)
    .join(";");

  const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;
  const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new Error("OSRM request failed");

  const data = await response.json();
  if (data.code !== "Ok" || !data.routes || !data.routes.length) {
    throw new Error("No road route returned");
  }

  const best = data.routes[0];
  return {
    coordinates: best.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distanceKm: Number((best.distance / 1000).toFixed(1)),
    durationMins: Math.max(2, Math.round(best.duration / 60)),
    snappedToRoads: true
  };
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", project: "Project Atlas Tactical API" });
});

app.get("/api/incidents", (req, res) => {
  res.json(readJson(INCIDENTS_FILE));
});

app.post("/api/incidents", (req, res) => {
  const { title, category, severity, lat, lng, radiusMeters, notes } = req.body;
  if (!title || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: "Title, latitude, and longitude are required." });
  }

  const incidents = readJson(INCIDENTS_FILE);
  const newIncident = {
    id: `inc-${Date.now()}`,
    title: title.trim(),
    category: category || "Flooding",
    severity: severity || "Medium",
    verified: false,
    radiusMeters: Number(radiusMeters) || 1000,
    lat: Number(lat),
    lng: Number(lng),
    notes: (notes || "").trim(),
    createdAt: new Date().toISOString()
  };

  incidents.unshift(newIncident);
  writeJson(INCIDENTS_FILE, incidents);
  res.status(201).json(newIncident);
});

app.patch("/api/incidents/:id/verify", (req, res) => {
  const incidents = readJson(INCIDENTS_FILE);
  const target = incidents.find((item) => item.id === req.params.id);
  if (!target) {
    return res.status(404).json({ error: "Incident not found." });
  }

  target.verified = !target.verified;
  writeJson(INCIDENTS_FILE, incidents);
  res.json(target);
});

app.delete("/api/incidents/:id", (req, res) => {
  const incidents = readJson(INCIDENTS_FILE);
  const filtered = incidents.filter((item) => item.id !== req.params.id);
  if (filtered.length === incidents.length) {
    return res.status(404).json({ error: "Incident not found." });
  }
  writeJson(INCIDENTS_FILE, filtered);
  res.json({ deleted: req.params.id });
});

app.get("/api/news", (req, res) => {
  res.json(readJson(NEWS_FILE));
});

app.post("/api/news", (req, res) => {
  const { source, tag, headline } = req.body;
  if (!headline) {
    return res.status(400).json({ error: "Headline is required." });
  }
  const items = readJson(NEWS_FILE);
  const entry = {
    id: `news-${Date.now()}`,
    source: (source || "Field Dispatch").trim(),
    tag: (tag || "INTEL").toUpperCase(),
    headline: headline.trim(),
    timestamp: "Just now"
  };
  items.unshift(entry);
  writeJson(NEWS_FILE, items);
  res.status(201).json(entry);
});

app.post("/api/routes/suggest", async (req, res) => {
  const { lat, lng, radiusMeters = 1000, title = "Hazard Zone" } = req.body;
  const cLat = Number(lat);
  const cLng = Number(lng);
  if (Number.isNaN(cLat) || Number.isNaN(cLng)) {
    return res.status(400).json({ error: "Valid coordinates required." });
  }

  const safeOffset = Math.max((Number(radiusMeters) / 111320) * 1.85, 0.014);
  const approachSpan = safeOffset * 1.65;

  const entryPoint = [cLat - approachSpan, cLng - approachSpan * 0.45];
  const exitPoint = [cLat + approachSpan, cLng + approachSpan * 0.45];

  const eastWaypoints = [
    entryPoint,
    [cLat - safeOffset * 0.15, cLng + safeOffset * 1.3],
    exitPoint
  ];

  const westWaypoints = [
    entryPoint,
    [cLat + safeOffset * 0.15, cLng - safeOffset * 1.3],
    exitPoint
  ];

  let eastRoute;
  let westRoute;

  try {
    [eastRoute, westRoute] = await Promise.all([
      fetchOsrmCorridor(eastWaypoints),
      fetchOsrmCorridor(westWaypoints)
    ]);
  } catch {
    eastRoute = {
      coordinates: eastWaypoints,
      distanceKm: Number(((Number(radiusMeters) * 3.8) / 1000).toFixed(1)),
      durationMins: 8,
      snappedToRoads: false
    };
    westRoute = {
      coordinates: westWaypoints,
      distanceKm: Number(((Number(radiusMeters) * 4.3) / 1000).toFixed(1)),
      durationMins: 11,
      snappedToRoads: false
    };
  }

  res.json({
    target: title,
    clearanceMeters: Math.round(Number(radiusMeters) * 1.85),
    snappedToRoads: eastRoute.snappedToRoads,
    routes: [
      {
        id: "route-alpha",
        name: "Corridor Alpha (East Road Bypass)",
        status: "Clear / Recommended",
        distanceKm: eastRoute.distanceKm,
        durationMins: eastRoute.durationMins,
        color: "#10b981",
        summary: "Follows eastern arterial roads outside the active danger perimeter.",
        coordinates: eastRoute.coordinates
      },
      {
        id: "route-beta",
        name: "Corridor Beta (West Road Detour)",
        status: "Secondary Alternate",
        distanceKm: westRoute.distanceKm,
        durationMins: westRoute.durationMins,
        color: "#38bdf8",
        summary: "Routes along western connecting streets clear of the core radius.",
        coordinates: westRoute.coordinates
      }
    ]
  });
});

app.listen(PORT, () => {
  console.log(`Project Atlas Tactical API running on http://localhost:${PORT}`);
});
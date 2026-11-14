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

function haversineMeters([lat1, lng1], [lat2, lng2]) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function densifyCoords(coords, maxStepMeters = 150) {
  if (!coords || coords.length < 2) return coords || [];
  const dense = [coords[0]];
  for (let i = 0; i < coords.length - 1; i++) {
    const start = coords[i];
    const end = coords[i + 1];
    const dist = haversineMeters(start, end);
    const steps = Math.max(1, Math.ceil(dist / maxStepMeters));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      dense.push([
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t
      ]);
    }
  }
  return dense;
}

function findIntersectedHazards(routeCoords, verifiedHazards) {
  const sampled = densifyCoords(routeCoords, 150);
  return verifiedHazards.filter((hazard) => {
    const bufferRadius = (Number(hazard.radiusMeters) || 1000) * 1.1;
    return sampled.some(
      (pt) => haversineMeters(pt, [hazard.lat, hazard.lng]) <= bufferRadius
    );
  });
}

async function fetchOsrmCorridor(waypointsLatLng) {
  const coordString = waypointsLatLng
    .map(([lat, lng]) => `${lng.toFixed(5)},${lat.toFixed(5)}`)
    .join(";");

  const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
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

// Single-zone perimeter bypass
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
    mode: "ZONE_BYPASS",
    target: title,
    snappedToRoads: eastRoute.snappedToRoads,
    avoidedZones: [title],
    blockedRoute: null,
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

// Full A-to-B Multi-Hazard Safe Navigation
app.post("/api/routes/navigate", async (req, res) => {
  const { origin, destination, label = "Custom Corridor" } = req.body;
  if (!Array.isArray(origin) || !Array.isArray(destination)) {
    return res.status(400).json({ error: "Origin and destination coordinates required." });
  }

  const start = [Number(origin[0]), Number(origin[1])];
  const end = [Number(destination[0]), Number(destination[1])];
  const verifiedHazards = readJson(INCIDENTS_FILE).filter((h) => h.verified);

  let directRoute;
  try {
    directRoute = await fetchOsrmCorridor([start, end]);
  } catch {
    directRoute = {
      coordinates: [start, end],
      distanceKm: Number((haversineMeters(start, end) / 1000).toFixed(1)),
      durationMins: Math.max(5, Math.round(haversineMeters(start, end) / 500)),
      snappedToRoads: false
    };
  }

  const intersected = findIntersectedHazards(directRoute.coordinates, verifiedHazards);

  // If direct road touches zero verified zones, return direct safe corridor immediately
  if (intersected.length === 0) {
    return res.json({
      mode: "A_TO_B",
      target: label,
      snappedToRoads: directRoute.snappedToRoads,
      avoidedZones: [],
      blockedRoute: null,
      routes: [
        {
          id: "route-alpha",
          name: "Direct Safe Corridor (No Hazards Intersected)",
          status: "100% Clear",
          distanceKm: directRoute.distanceKm,
          durationMins: directRoute.durationMins,
          color: "#10b981",
          summary: "Direct route avoids all verified red and amber zones.",
          coordinates: directRoute.coordinates
        }
      ]
    });
  }

  // Sort intersected hazards along travel vector from start -> end
  const avgLatRad = (((start[0] + end[0]) / 2) * Math.PI) / 180;
  const cosLat = Math.cos(avgLatRad);
  const dLat = end[0] - start[0];
  const dLng = (end[1] - start[1]) * cosLat;
  const vecLen = Math.hypot(dLat, dLng) || 1;
  const uLat = dLat / vecLen;
  const uLng = dLng / vecLen;

  // Perpendicular unit vectors in degrees
  const leftLat = -uLng;
  const leftLng = uLat / cosLat;
  const rightLat = uLng;
  const rightLng = -uLat / cosLat;

  const orderedHazards = [...intersected].sort((a, b) => {
    const projA = (a.lat - start[0]) * uLat + (a.lng - start[1]) * cosLat * uLng;
    const projB = (b.lat - start[0]) * uLat + (b.lng - start[1]) * cosLat * uLng;
    return projA - projB;
  });

  const leftWaypoints = [start];
  const rightWaypoints = [start];

  orderedHazards.forEach((h) => {
    const clearanceDeg = Math.max(((Number(h.radiusMeters) || 1000) * 1.7) / 111320, 0.013);
    leftWaypoints.push([h.lat + leftLat * clearanceDeg, h.lng + leftLng * clearanceDeg]);
    rightWaypoints.push([h.lat + rightLat * clearanceDeg, h.lng + rightLng * clearanceDeg]);
  });

  leftWaypoints.push(end);
  rightWaypoints.push(end);

  let leftRoute;
  let rightRoute;

  try {
    [leftRoute, rightRoute] = await Promise.all([
      fetchOsrmCorridor(leftWaypoints),
      fetchOsrmCorridor(rightWaypoints)
    ]);
  } catch {
    leftRoute = {
      coordinates: leftWaypoints,
      distanceKm: Number((directRoute.distanceKm * 1.25).toFixed(1)),
      durationMins: Math.round(directRoute.durationMins * 1.25),
      snappedToRoads: false
    };
    rightRoute = {
      coordinates: rightWaypoints,
      distanceKm: Number((directRoute.distanceKm * 1.32).toFixed(1)),
      durationMins: Math.round(directRoute.durationMins * 1.32),
      snappedToRoads: false
    };
  }

  const leftHits = findIntersectedHazards(leftRoute.coordinates, verifiedHazards).length;
  const rightHits = findIntersectedHazards(rightRoute.coordinates, verifiedHazards).length;

  const candidates = [
    {
      label: "North/West Safe Flank",
      route: leftRoute,
      hits: leftHits
    },
    {
      label: "South/East Safe Flank",
      route: rightRoute,
      hits: rightHits
    }
  ].sort((a, b) => a.hits - b.hits || a.route.durationMins - b.route.durationMins);

  const primary = candidates[0];
  const secondary = candidates[1];

  res.json({
    mode: "A_TO_B",
    target: label,
    snappedToRoads: primary.route.snappedToRoads,
    avoidedZones: orderedHazards.map((h) => h.title),
    blockedRoute: {
      distanceKm: directRoute.distanceKm,
      durationMins: directRoute.durationMins,
      coordinates: directRoute.coordinates
    },
    routes: [
      {
        id: "route-alpha",
        name: `Primary Safe Corridor (${primary.label})`,
        status: primary.hits === 0 ? "Clear of Verified Zones" : `${primary.hits} Edge Proximity`,
        distanceKm: primary.route.distanceKm,
        durationMins: primary.route.durationMins,
        color: "#10b981",
        summary: `Bypasses ${orderedHazards.length} active hazard zone(s) (+${Math.max(1, primary.route.durationMins - directRoute.durationMins)} min vs blocked direct road).`,
        coordinates: primary.route.coordinates
      },
      {
        id: "route-beta",
        name: `Alternate Corridor (${secondary.label})`,
        status: secondary.hits === 0 ? "Secondary Safe Option" : `${secondary.hits} Edge Proximity`,
        distanceKm: secondary.route.distanceKm,
        durationMins: secondary.route.durationMins,
        color: "#38bdf8",
        summary: "Backup diversion corridor on opposite perimeter flank.",
        coordinates: secondary.route.coordinates
      }
    ]
  });
});

app.listen(PORT, () => {
  console.log(`Project Atlas Tactical API running on http://localhost:${PORT}`);
});
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;
const INCIDENTS_FILE = path.join(__dirname, "data", "incidents.json");
const NEWS_FILE = path.join(__dirname, "data", "news.json");
const MAX_ARTICLE_AGE_MS = 21 * 24 * 60 * 60 * 1000; // 21-day freshness window

app.use(cors());
app.use(express.json());

// Port Harcourt & Rivers State Landmark Gazetteer for Auto-Geocoding
const PH_LANDMARKS = [
  { keys: ["trans-amadi", "trans amadi"], name: "Trans-Amadi Industrial Layout", lat: 4.8195, lng: 7.0365 },
  { keys: ["rumuokoro"], name: "Rumuokoro Junction", lat: 4.8674, lng: 6.9988 },
  { keys: ["garrison"], name: "Garrison Junction", lat: 4.8032, lng: 7.0115 },
  { keys: ["peter odili"], name: "Peter Odili Road", lat: 4.7965, lng: 7.0432 },
  { keys: ["east-west road", "east west road"], name: "East-West Road", lat: 4.8720, lng: 6.9750 },
  { keys: ["aba road", "aba expressway"], name: "Aba-PH Expressway", lat: 4.8280, lng: 7.0185 },
  { keys: ["oyigbo"], name: "Oyigbo Axis", lat: 4.8781, lng: 7.1285 },
  { keys: ["eleme", "akpajo"], name: "Eleme / Akpajo Junction", lat: 4.7985, lng: 7.1180 },
  { keys: ["woji"], name: "Woji District", lat: 4.8235, lng: 7.0545 },
  { keys: ["choba", "uniport"], name: "Choba / Uniport Axis", lat: 4.8965, lng: 6.9125 },
  { keys: ["mile 1", "mile one", "diobu"], name: "Mile 1 / Diobu", lat: 4.7915, lng: 7.0015 },
  { keys: ["mile 3", "mile three"], name: "Mile 3 Axis", lat: 4.8045, lng: 6.9910 },
  { keys: ["new gra", "gra phase"], name: "New GRA", lat: 4.8240, lng: 7.0055 },
  { keys: ["eliozu"], name: "Eliozu Flyover", lat: 4.8595, lng: 7.0225 },
  { keys: ["rukpokwu"], name: "Rukpokwu Axis", lat: 4.9045, lng: 7.0010 },
  { keys: ["rumuola"], name: "Rumuola Junction", lat: 4.8325, lng: 7.0045 },
  { keys: ["rumuodara"], name: "Rumuodara Junction", lat: 4.8475, lng: 7.0315 },
  { keys: ["elelenwo"], name: "Elelenwo", lat: 4.8355, lng: 7.0685 },
  { keys: ["borokiri", "old township"], name: "Borokiri / Town", lat: 4.7565, lng: 7.0345 },
  { keys: ["ada george", "agip"], name: "Ada George / Agip", lat: 4.8255, lng: 6.9815 },
  { keys: ["omagwa", "international airport"], name: "Omagwa Airport Corridor", lat: 5.0155, lng: 6.9495 },
  { keys: ["bonny"], name: "Bonny Island", lat: 4.4516, lng: 7.1707 },
  { keys: ["port harcourt", "rivers state"], name: "Port Harcourt Metro", lat: 4.8156, lng: 7.0498 }
];

// Restricted with when:14d / when:7d so only current stories are returned
const RSS_SOURCES = [
  {
    name: "Google News PH Hazards",
    url: "https://news.google.com/rss/search?q=%22Port+Harcourt%22+(flood+OR+rain+OR+traffic+OR+fire+OR+road+OR+blockade)+when:14d&hl=en-NG&gl=NG&ceid=NG:en"
  },
  {
    name: "Google News Rivers Alert",
    url: "https://news.google.com/rss/search?q=%22Rivers+State%22+(flood+OR+weather+OR+accident+OR+outage+OR+emergency)+when:14d&hl=en-NG&gl=NG&ceid=NG:en"
  },
  {
    name: "Google News PH Local",
    url: "https://news.google.com/rss/search?q=%22Port+Harcourt%22+when:7d&hl=en-NG&gl=NG&ceid=NG:en"
  },
  {
    name: "Vanguard Nigeria",
    url: "https://www.vanguardngr.com/feed/"
  }
];

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function decodeXml(raw = "") {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;|&#8212;/g, "-")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatRelativeTime(publishedMs) {
  if (!publishedMs || Number.isNaN(publishedMs)) return "Recent";
  const diffMins = Math.max(1, Math.floor((Date.now() - publishedMs) / 60000));
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function parseRssItems(xml, fallbackSource) {
  const items = [];
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const now = Date.now();

  for (const block of itemMatches.slice(0, 25)) {
    const titleMatch = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    const sourceMatch = block.match(/<source\b[^>]*>([\s\S]*?)<\/source>/i);
    const descMatch = block.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i);
    const pubDateMatch = block.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i);

    const title = decodeXml(titleMatch ? titleMatch[1] : "");
    const link = decodeXml(linkMatch ? linkMatch[1] : "");
    const source = decodeXml(sourceMatch ? sourceMatch[1] : fallbackSource);
    const description = decodeXml(descMatch ? descMatch[1] : "");
    const pubDateRaw = decodeXml(pubDateMatch ? pubDateMatch[1] : "");
    const publishedMs = pubDateRaw ? Date.parse(pubDateRaw) : NaN;

    // Skip stale articles older than 21 days (blocks 2025 archive results)
    if (!Number.isNaN(publishedMs) && now - publishedMs > MAX_ARTICLE_AGE_MS) {
      continue;
    }

    if (title) {
      items.push({
        title,
        link,
        source,
        description,
        publishedMs: Number.isNaN(publishedMs) ? now : publishedMs
      });
    }
  }
  return items;
}

function detectLandmark(text) {
  const lower = text.toLowerCase();
  for (const lm of PH_LANDMARKS) {
    if (lm.keys.some((k) => lower.includes(k))) {
      return lm;
    }
  }
  return null;
}

function classifyHazard(text) {
  const lower = text.toLowerCase();

  if (/(flood|rain|rainstorm|submerge|waterlog|overflow|weather|nimet|tide)/.test(lower)) {
    return {
      category: "Flooding",
      tag: "WEATHER",
      severity: /(severe|heavy|submerge|wash|emergency|alert)/.test(lower) ? "High" : "Medium",
      radiusMeters: 1300
    };
  }
  if (/(fire|explosion|tanker|inferno|gas|leak|spill|shoot|clash|security)/.test(lower)) {
    return {
      category: "Hazard",
      tag: "ALERT",
      severity: "High",
      radiusMeters: 1100
    };
  }
  if (/(traffic|gridlock|blockade|protest|diversion|crash|accident|closed|shutdown)/.test(lower)) {
    return {
      category: "Road Blockage",
      tag: "TRANSIT",
      severity: /(accident|crash|blockade|shutdown)/.test(lower) ? "High" : "Medium",
      radiusMeters: 950
    };
  }
  if (/(power|blackout|grid|transformer|bridge|collapse|pipeline|water supply)/.test(lower)) {
    return {
      category: "Infrastructure",
      tag: "INTEL",
      severity: "Medium",
      radiusMeters: 900
    };
  }
  return null;
}

async function runOsintIngestion() {
  const now = Date.now();

  // Automatically purge any previously ingested stale/2025 OSINT items
  const existingNews = readJson(NEWS_FILE).filter((n) => {
    if (n.timestamp === "Just ingested") return false;
    if (n.publishedAt && now - Date.parse(n.publishedAt) > MAX_ARTICLE_AGE_MS) return false;
    return true;
  });

  const existingIncidents = readJson(INCIDENTS_FILE).filter((inc) => {
    if (!inc.autoGeocoded) return true;
    const refTime = inc.publishedAt ? Date.parse(inc.publishedAt) : Date.parse(inc.createdAt);
    if (!Number.isNaN(refTime) && now - refTime > MAX_ARTICLE_AGE_MS) return false;
    return true;
  });

  const seenHeadlines = new Set(existingNews.map((n) => n.headline.toLowerCase()));
  const seenIncidentTitles = new Set(existingIncidents.map((i) => i.title.toLowerCase()));

  let fetchedItems = [];
  let liveFeedSucceeded = false;

  const results = await Promise.allSettled(
    RSS_SOURCES.map(async (feed) => {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "ProjectAtlasOSINT/1.0" },
        signal: AbortSignal.timeout(5500)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      return parseRssItems(xml, feed.name);
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled" && r.value.length > 0) {
      liveFeedSucceeded = true;
      fetchedItems.push(...r.value);
    }
  }

  // Sort newest articles first
  fetchedItems.sort((a, b) => b.publishedMs - a.publishedMs);

  let newNewsCount = 0;
  let newPinsCount = 0;
  let latestAutoPin = null;

  for (const item of fetchedItems) {
    const combinedText = `${item.title} ${item.description}`;
    const landmark = detectLandmark(combinedText);
    const hazard = classifyHazard(combinedText);

    if (!landmark) continue;

    const cleanTitle = item.title.replace(/\s+-\s+[^-]+$/, "").trim();
    if (seenHeadlines.has(cleanTitle.toLowerCase())) continue;

    seenHeadlines.add(cleanTitle.toLowerCase());
    newNewsCount++;

    const publishedIso = new Date(item.publishedMs).toISOString();
    const relTime = formatRelativeTime(item.publishedMs);

    existingNews.unshift({
      id: `news-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      source: item.source || "OSINT Feed",
      tag: hazard ? hazard.tag : "INTEL",
      headline: cleanTitle,
      landmark: landmark.name,
      url: item.link || "",
      publishedAt: publishedIso,
      timestamp: relTime
    });

    if (hazard && !seenIncidentTitles.has(cleanTitle.toLowerCase())) {
      seenIncidentTitles.add(cleanTitle.toLowerCase());
      newPinsCount++;

      const jitterLat = (Math.random() - 0.5) * 0.002;
      const jitterLng = (Math.random() - 0.5) * 0.002;

      const autoIncident = {
        id: `inc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        title: cleanTitle,
        category: hazard.category,
        severity: hazard.severity,
        verified: false,
        autoGeocoded: true,
        sourceName: item.source || "OSINT Feed",
        sourceUrl: item.link || "",
        radiusMeters: hazard.radiusMeters,
        lat: Number((landmark.lat + jitterLat).toFixed(5)),
        lng: Number((landmark.lng + jitterLng).toFixed(5)),
        notes: `Published ${relTime} via ${item.source || "news wire"} (${landmark.name}). Awaiting operator verification.`,
        publishedAt: publishedIso,
        createdAt: new Date().toISOString()
      };

      existingIncidents.unshift(autoIncident);
      if (!latestAutoPin) latestAutoPin = autoIncident;
    }
  }

  writeJson(NEWS_FILE, existingNews.slice(0, 60));
  writeJson(INCIDENTS_FILE, existingIncidents);

  return {
    liveFeedSucceeded,
    newNewsCount,
    newPinsCount,
    latestAutoPin
  };
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
    autoGeocoded: false,
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

app.post("/api/osint/sync", async (req, res) => {
  try {
    const summary = await runOsintIngestion();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: "OSINT sync failed", details: err.message });
  }
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

  const avgLatRad = (((start[0] + end[0]) / 2) * Math.PI) / 180;
  const cosLat = Math.cos(avgLatRad);
  const dLat = end[0] - start[0];
  const dLng = (end[1] - start[1]) * cosLat;
  const vecLen = Math.hypot(dLat, dLng) || 1;
  const uLat = dLat / vecLen;
  const uLng = dLng / vecLen;

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
    { label: "North/West Safe Flank", route: leftRoute, hits: leftHits },
    { label: "South/East Safe Flank", route: rightRoute, hits: rightHits }
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
  setInterval(() => {
    runOsintIngestion().catch(() => {});
  }, 10 * 60 * 1000);
});
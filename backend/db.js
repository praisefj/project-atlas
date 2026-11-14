const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const INCIDENTS_FILE = path.join(__dirname, "data", "incidents.json");
const ZONES_FILE = path.join(__dirname, "data", "zones.json");
const NEWS_FILE = path.join(__dirname, "data", "news.json");
const SCHEMA_FILE = path.join(__dirname, "schema.sql");
const VERIFY_THRESHOLD = 3;

let pool = null;
let usePostgis = false;

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function toPolygonWkt(coords) {
  const ring = coords.map(([lat, lng]) => [Number(lng), Number(lat)]);
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
  }
  const pairs = ring.map(([lng, lat]) => `${lng} ${lat}`).join(", ");
  return `POLYGON((${pairs}))`;
}

function toLineStringWkt(coords) {
  const pairs = coords.map(([lat, lng]) => `${Number(lng)} ${Number(lat)}`).join(", ");
  return `LINESTRING(${pairs})`;
}

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    usePostgis = false;
    return { mode: "json" };
  }

  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost")
        ? false
        : { rejectUnauthorized: false }
    });

    const schemaSql = fs.readFileSync(SCHEMA_FILE, "utf-8");
    await pool.query(schemaSql);
    usePostgis = true;

    const { rows: incCount } = await pool.query("SELECT COUNT(*)::int AS c FROM incidents");
    if (incCount[0].c === 0) {
      for (const item of readJson(INCIDENTS_FILE)) {
        await createIncident(item);
      }
    }

    const { rows: zoneCount } = await pool.query("SELECT COUNT(*)::int AS c FROM zones");
    if (zoneCount[0].c === 0) {
      for (const z of readJson(ZONES_FILE)) {
        await createZone(z);
      }
    }

    const { rows: newsCount } = await pool.query("SELECT COUNT(*)::int AS c FROM news");
    if (newsCount[0].c === 0) {
      for (const n of readJson(NEWS_FILE).reverse()) {
        await createNews(n);
      }
    }

    return { mode: "postgis" };
  } catch (err) {
    console.error("PostGIS connection failed, falling back to JSON:", err.message);
    usePostgis = false;
    return { mode: "json" };
  }
}

function getStorageMode() {
  return usePostgis ? "postgis" : "json";
}

function mapIncidentRow(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    severity: row.severity,
    verified: row.verified,
    confirmations: Number(row.confirmations) || (row.verified ? VERIFY_THRESHOLD : 1),
    autoGeocoded: row.auto_geocoded,
    landmark: row.landmark || undefined,
    sourceName: row.source_name || undefined,
    sourceUrl: row.source_url || "",
    radiusMeters: Number(row.radius_meters) || 1000,
    lat: Number(row.lat),
    lng: Number(row.lng),
    notes: row.notes || "",
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
  };
}

async function getIncidents() {
  if (!usePostgis) {
    return readJson(INCIDENTS_FILE).map((item) => ({
      ...item,
      confirmations: Number(item.confirmations) || (item.verified ? VERIFY_THRESHOLD : 1)
    }));
  }
  const { rows } = await pool.query("SELECT * FROM incidents ORDER BY created_at DESC");
  return rows.map(mapIncidentRow);
}

async function createIncident(data) {
  const item = {
    id: data.id || `inc-${Date.now()}`,
    title: String(data.title).trim(),
    category: data.category || "Flooding",
    severity: data.severity || "Medium",
    verified: Boolean(data.verified),
    confirmations: Number(data.confirmations) || (data.verified ? VERIFY_THRESHOLD : 1),
    autoGeocoded: Boolean(data.autoGeocoded),
    landmark: data.landmark || null,
    sourceName: data.sourceName || null,
    sourceUrl: data.sourceUrl || "",
    radiusMeters: Number(data.radiusMeters) || 1000,
    lat: Number(data.lat),
    lng: Number(data.lng),
    notes: (data.notes || "").trim(),
    publishedAt: data.publishedAt || null,
    createdAt: data.createdAt || new Date().toISOString()
  };

  if (!usePostgis) {
    const list = readJson(INCIDENTS_FILE);
    list.unshift(item);
    writeJson(INCIDENTS_FILE, list);
    return item;
  }

  const { rows } = await pool.query(
    `INSERT INTO incidents
      (id, title, category, severity, verified, confirmations, auto_geocoded, landmark, source_name, source_url, radius_meters, lat, lng, geom, notes, published_at, created_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, ST_SetSRID(ST_MakePoint($13, $12), 4326), $14, $15, $16)
     RETURNING *`,
    [
      item.id,
      item.title,
      item.category,
      item.severity,
      item.verified,
      item.confirmations,
      item.autoGeocoded,
      item.landmark,
      item.sourceName,
      item.sourceUrl,
      item.radiusMeters,
      item.lat,
      item.lng,
      item.notes,
      item.publishedAt,
      item.createdAt
    ]
  );
  return mapIncidentRow(rows[0]);
}

async function updateIncident(id, patch) {
  if (!usePostgis) {
    const list = readJson(INCIDENTS_FILE);
    const target = list.find((i) => i.id === id);
    if (!target) return null;
    Object.assign(target, patch);
    writeJson(INCIDENTS_FILE, list);
    return target;
  }

  const currentList = await getIncidents();
  const current = currentList.find((i) => i.id === id);
  if (!current) return null;
  const merged = { ...current, ...patch };

  const { rows } = await pool.query(
    `UPDATE incidents
     SET severity = $2, radius_meters = $3, verified = $4, confirmations = $5
     WHERE id = $1
     RETURNING *`,
    [id, merged.severity, merged.radiusMeters, merged.verified, merged.confirmations]
  );
  return rows[0] ? mapIncidentRow(rows[0]) : null;
}

async function deleteIncident(id) {
  if (!usePostgis) {
    const list = readJson(INCIDENTS_FILE);
    const filtered = list.filter((i) => i.id !== id);
    if (filtered.length === list.length) return false;
    writeJson(INCIDENTS_FILE, filtered);
    return true;
  }
  const { rowCount } = await pool.query("DELETE FROM incidents WHERE id = $1", [id]);
  return rowCount > 0;
}

async function replaceIncidents(list) {
  if (!usePostgis) {
    writeJson(INCIDENTS_FILE, list);
    return;
  }
  const existing = await getIncidents();
  const existingIds = new Set(existing.map((e) => e.id));
  const keepIds = new Set(list.map((i) => i.id));

  for (const oldItem of existing) {
    if (!keepIds.has(oldItem.id)) {
      await deleteIncident(oldItem.id);
    }
  }
  for (const item of list) {
    if (!existingIds.has(item.id)) {
      await createIncident(item);
    }
  }
}

function mapZoneRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    severity: row.severity,
    verified: row.verified,
    coordinates: row.coordinates,
    notes: row.notes || "",
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
  };
}

async function getZones() {
  if (!usePostgis) return readJson(ZONES_FILE);
  const { rows } = await pool.query("SELECT * FROM zones ORDER BY created_at DESC");
  return rows.map(mapZoneRow);
}

async function createZone(data) {
  const zone = {
    id: data.id || `zone-${Date.now()}`,
    name: String(data.name).trim(),
    category: data.category || "Flooding",
    severity: data.severity || "High",
    verified: Boolean(data.verified),
    coordinates: data.coordinates.map(([lat, lng]) => [Number(lat), Number(lng)]),
    notes: (data.notes || "").trim(),
    createdAt: data.createdAt || new Date().toISOString()
  };

  if (!usePostgis) {
    const list = readJson(ZONES_FILE);
    list.unshift(zone);
    writeJson(ZONES_FILE, list);
    return zone;
  }

  const wkt = toPolygonWkt(zone.coordinates);
  const { rows } = await pool.query(
    `INSERT INTO zones (id, name, category, severity, verified, coordinates, geom, notes, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, ST_GeomFromText($7, 4326), $8, $9)
     RETURNING *`,
    [
      zone.id,
      zone.name,
      zone.category,
      zone.severity,
      zone.verified,
      JSON.stringify(zone.coordinates),
      wkt,
      zone.notes,
      zone.createdAt
    ]
  );
  return mapZoneRow(rows[0]);
}

async function toggleZoneVerify(id) {
  if (!usePostgis) {
    const list = readJson(ZONES_FILE);
    const target = list.find((z) => z.id === id);
    if (!target) return null;
    target.verified = !target.verified;
    writeJson(ZONES_FILE, list);
    return target;
  }
  const { rows } = await pool.query(
    "UPDATE zones SET verified = NOT verified WHERE id = $1 RETURNING *",
    [id]
  );
  return rows[0] ? mapZoneRow(rows[0]) : null;
}

async function deleteZone(id) {
  if (!usePostgis) {
    const list = readJson(ZONES_FILE);
    const filtered = list.filter((z) => z.id !== id);
    if (filtered.length === list.length) return false;
    writeJson(ZONES_FILE, filtered);
    return true;
  }
  const { rowCount } = await pool.query("DELETE FROM zones WHERE id = $1", [id]);
  return rowCount > 0;
}

async function getNews() {
  if (!usePostgis) return readJson(NEWS_FILE);
  const { rows } = await pool.query("SELECT * FROM news ORDER BY created_at DESC LIMIT 60");
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    tag: r.tag,
    headline: r.headline,
    landmark: r.landmark || undefined,
    url: r.url || "",
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : undefined,
    timestamp: r.timestamp_label || "Recent"
  }));
}

async function createNews(data) {
  const entry = {
    id: data.id || `news-${Date.now()}`,
    source: String(data.source || "Field Dispatch").trim(),
    tag: String(data.tag || "INTEL").toUpperCase(),
    headline: String(data.headline).trim(),
    landmark: data.landmark || null,
    url: data.url || "",
    publishedAt: data.publishedAt || null,
    timestamp: data.timestamp || "Just now"
  };

  if (!usePostgis) {
    const list = readJson(NEWS_FILE);
    list.unshift(entry);
    writeJson(NEWS_FILE, list.slice(0, 60));
    return entry;
  }

  await pool.query(
    `INSERT INTO news (id, source, tag, headline, landmark, url, published_at, timestamp_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [
      entry.id,
      entry.source,
      entry.tag,
      entry.headline,
      entry.landmark,
      entry.url,
      entry.publishedAt,
      entry.timestamp
    ]
  );
  return entry;
}

async function replaceNews(list) {
  if (!usePostgis) {
    writeJson(NEWS_FILE, list.slice(0, 60));
    return;
  }
  await pool.query("DELETE FROM news");
  for (const item of [...list].slice(0, 60).reverse()) {
    await createNews(item);
  }
}

async function querySpatialCollisions(routeCoords) {
  if (!usePostgis || !Array.isArray(routeCoords) || routeCoords.length < 2) {
    return null;
  }

  const lineWkt = toLineStringWkt(routeCoords);

  const [incRes, zoneRes] = await Promise.all([
    pool.query(
      `SELECT id, title, lat, lng, radius_meters AS "radiusMeters"
       FROM incidents
       WHERE verified = TRUE
         AND ST_DWithin(
           geom::geography,
           ST_GeomFromText($1, 4326)::geography,
           radius_meters * 1.1
         )`,
      [lineWkt]
    ),
    pool.query(
      `SELECT id, name AS title,
              ST_Y(ST_Centroid(geom)) AS lat,
              ST_X(ST_Centroid(geom)) AS lng,
              GREATEST(600, ROUND(SQRT(ST_Area(geom::geography) / PI())))::int AS "radiusMeters"
       FROM zones
       WHERE verified = TRUE
         AND ST_Intersects(geom, ST_GeomFromText($1, 4326))`,
      [lineWkt]
    )
  ]);

  return [...incRes.rows, ...zoneRes.rows];
}

module.exports = {
  VERIFY_THRESHOLD,
  initDatabase,
  getStorageMode,
  getIncidents,
  createIncident,
  updateIncident,
  deleteIncident,
  replaceIncidents,
  getZones,
  createZone,
  toggleZoneVerify,
  deleteZone,
  getNews,
  createNews,
  replaceNews,
  querySpatialCollisions
};
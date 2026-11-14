CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Flooding',
  severity TEXT NOT NULL DEFAULT 'Medium',
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  confirmations INTEGER NOT NULL DEFAULT 1,
  auto_geocoded BOOLEAN NOT NULL DEFAULT FALSE,
  landmark TEXT,
  source_name TEXT,
  source_url TEXT,
  radius_meters INTEGER NOT NULL DEFAULT 1000,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  geom GEOMETRY(Point, 4326) NOT NULL,
  notes TEXT DEFAULT '',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_geom ON incidents USING GIST (geom);

CREATE TABLE IF NOT EXISTS zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Flooding',
  severity TEXT NOT NULL DEFAULT 'High',
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  coordinates JSONB NOT NULL,
  geom GEOMETRY(Polygon, 4326) NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zones_geom ON zones USING GIST (geom);

CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  tag TEXT NOT NULL DEFAULT 'INTEL',
  headline TEXT NOT NULL,
  landmark TEXT,
  url TEXT DEFAULT '',
  published_at TIMESTAMPTZ,
  timestamp_label TEXT DEFAULT 'Recent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
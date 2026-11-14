require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;
const DATA_FILE = path.join(__dirname, "data", "incidents.json");

app.use(cors());
app.use(express.json());

function readIncidents() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

function writeIncidents(items) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2));
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", project: "Project Atlas API" });
});

app.get("/api/incidents", (req, res) => {
  res.json(readIncidents());
});

app.post("/api/incidents", (req, res) => {
  const { title, category, severity, lat, lng, notes } = req.body;
  if (!title || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: "Title, latitude, and longitude are required." });
  }

  const incidents = readIncidents();
  const newIncident = {
    id: `inc-${Date.now()}`,
    title: title.trim(),
    category: category || "Flooding",
    severity: severity || "Medium",
    lat: Number(lat),
    lng: Number(lng),
    notes: (notes || "").trim(),
    createdAt: new Date().toISOString()
  };

  incidents.unshift(newIncident);
  writeIncidents(incidents);
  res.status(201).json(newIncident);
});

app.delete("/api/incidents/:id", (req, res) => {
  const incidents = readIncidents();
  const filtered = incidents.filter((item) => item.id !== req.params.id);
  if (filtered.length === incidents.length) {
    return res.status(404).json({ error: "Incident not found." });
  }
  writeIncidents(filtered);
  res.json({ deleted: req.params.id });
});

app.listen(PORT, () => {
  console.log(`Project Atlas API running on http://localhost:${PORT}`);
});

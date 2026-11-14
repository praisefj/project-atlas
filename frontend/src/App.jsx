import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

const PH_CENTER = [4.8156, 7.0498];

const SEVERITY_THEME = {
  High: {
    core: "#ff2a55",
    glow: "0 0 16px #ff2a55, 0 0 36px #ff2a55, 0 0 64px rgba(255, 42, 85, 0.9)",
    ring: "#ff2a55"
  },
  Medium: {
    core: "#ff9900",
    glow: "0 0 14px #ff9900, 0 0 30px rgba(255, 153, 0, 0.85)",
    ring: "#ff9900"
  },
  Low: {
    core: "#00e5a8",
    glow: "0 0 12px #00e5a8, 0 0 26px rgba(0, 229, 168, 0.75)",
    ring: "#00e5a8"
  }
};

function createHotspotIcon(severity, verified) {
  const theme = SEVERITY_THEME[severity] || SEVERITY_THEME.Medium;
  const shadow = verified ? theme.glow : "0 0 10px rgba(251, 191, 36, 0.65)";
  const bg = verified ? theme.core : "#fbbf24";
  return L.divIcon({
    className: "",
    html: `<div class="warzone-core ${verified ? "" : "unverified"}" style="background:${bg};box-shadow:${shadow};"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function createEndpointIcon(label, color) {
  return L.divIcon({
    className: "",
    html: `<div style="background:#090e1a;border:2px solid ${color};color:${color};font-family:monospace;font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;white-space:nowrap;box-shadow:0 0 8px rgba(0,0,0,0.8);">${label}</div>`,
    iconSize: [46, 18],
    iconAnchor: [23, 9]
  });
}

function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const zonesLayerRef = useRef(null);
  const routesLayerRef = useRef(null);
  const draftMarkerRef = useRef(null);

  const [online, setOnline] = useState(false);
  const [activeTab, setActiveTab] = useState("feed");
  const [verifyFilter, setVerifyFilter] = useState("all");
  const [incidents, setIncidents] = useState([]);
  const [news, setNews] = useState([]);
  const [activeRoutePlan, setActiveRoutePlan] = useState(null);
  const [loadingRouteId, setLoadingRouteId] = useState(null);

  const [form, setForm] = useState({
    title: "",
    category: "Flooding",
    severity: "High",
    radiusMeters: "1200",
    lat: "4.8156",
    lng: "7.0498",
    notes: ""
  });

  const [newsForm, setNewsForm] = useState({
    source: "",
    tag: "INTEL",
    headline: ""
  });

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true
    }).setView(PH_CENTER, 12);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19
    }).addTo(map);

    zonesLayerRef.current = L.layerGroup().addTo(map);
    routesLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (e) => {
      const lat = e.latlng.lat.toFixed(5);
      const lng = e.latlng.lng.toFixed(5);
      setForm((prev) => ({ ...prev, lat, lng }));

      if (draftMarkerRef.current) {
        draftMarkerRef.current.setLatLng(e.latlng);
      } else {
        draftMarkerRef.current = L.marker(e.latlng, {
          icon: L.divIcon({
            className: "",
            html: `<div class="warzone-core" style="background:#38bdf8;box-shadow:0 0 18px #38bdf8;"></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9]
          })
        })
          .addTo(map)
          .bindPopup("Target coordinates locked for new report");
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/health").then((r) => r.json()),
      fetch("/api/incidents").then((r) => r.json()),
      fetch("/api/news").then((r) => r.json())
    ])
      .then(([health, incList, newsList]) => {
        setOnline(health.status === "ok");
        setIncidents(incList);
        setNews(newsList);
      })
      .catch(() => setOnline(false));
  }, []);

  const filteredIncidents = incidents.filter((item) => {
    if (verifyFilter === "verified") return item.verified;
    if (verifyFilter === "unverified") return !item.verified;
    return true;
  });

  useEffect(() => {
    if (!zonesLayerRef.current) return;
    zonesLayerRef.current.clearLayers();

    filteredIncidents.forEach((item) => {
      const theme = SEVERITY_THEME[item.severity] || SEVERITY_THEME.Medium;
      const radius = Number(item.radiusMeters) || 1000;
      const center = [item.lat, item.lng];

      if (item.verified) {
        const layers = [
          { scale: 1.65, fillOpacity: 0.05, strokeOpacity: 0.2, dash: "4 6" },
          { scale: 1.25, fillOpacity: 0.1, strokeOpacity: 0.35, dash: null },
          { scale: 0.9, fillOpacity: 0.18, strokeOpacity: 0.5, dash: null },
          { scale: 0.55, fillOpacity: 0.28, strokeOpacity: 0.65, dash: null },
          { scale: 0.25, fillOpacity: 0.45, strokeOpacity: 0.85, dash: null }
        ];

        layers.forEach((layer) => {
          L.circle(center, {
            radius: radius * layer.scale,
            color: theme.ring,
            weight: 1,
            opacity: layer.strokeOpacity,
            fillColor: theme.core,
            fillOpacity: layer.fillOpacity,
            dashArray: layer.dash
          }).addTo(zonesLayerRef.current);
        });
      } else {
        L.circle(center, {
          radius: radius,
          color: "#fbbf24",
          weight: 1.5,
          opacity: 0.65,
          fillColor: "#fbbf24",
          fillOpacity: 0.08,
          dashArray: "6 6"
        }).addTo(zonesLayerRef.current);
      }

      const statusText = item.verified ? "VERIFIED INTEL" : "UNVERIFIED REPORT";
      L.marker(center, { icon: createHotspotIcon(item.severity, item.verified) })
        .bindPopup(
          `<strong>${item.title}</strong><br/>` +
            `<span style="color:${item.verified ? "#34d399" : "#fbbf24"};font-size:11px;">${statusText}</span> &bull; ${item.severity} (${radius}m)<br/>` +
            `<small>${item.notes || ""}</small>`
        )
        .addTo(zonesLayerRef.current);
    });
  }, [filteredIncidents]);

  useEffect(() => {
    if (!routesLayerRef.current) return;
    routesLayerRef.current.clearLayers();

    if (!activeRoutePlan || !activeRoutePlan.routes.length) return;

    const allBounds = [];

    activeRoutePlan.routes.forEach((route) => {
      const poly = L.polyline(route.coordinates, {
        color: route.color,
        weight: 4.5,
        opacity: 0.92
      })
        .bindPopup(
          `<strong>${route.name}</strong><br/>` +
            `Distance: ${route.distanceKm} km &bull; Est. Time: ${route.durationMins} mins`
        )
        .addTo(routesLayerRef.current);

      allBounds.push(...route.coordinates);

      if (route.id === "route-alpha" && route.coordinates.length >= 2) {
        const startPt = route.coordinates[0];
        const endPt = route.coordinates[route.coordinates.length - 1];
        L.marker(startPt, { icon: createEndpointIcon("DIVERT", "#10b981") }).addTo(
          routesLayerRef.current
        );
        L.marker(endPt, { icon: createEndpointIcon("REJOIN", "#38bdf8") }).addTo(
          routesLayerRef.current
        );
      }

      poly.bringToFront();
    });

    if (allBounds.length && mapRef.current) {
      mapRef.current.fitBounds(allBounds, { padding: [50, 50] });
    }
  }, [activeRoutePlan]);

  async function handleCreateIncident(e) {
    e.preventDefault();
    if (!form.title.trim()) return;

    const response = await fetch("/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });

    if (response.ok) {
      const created = await response.json();
      setIncidents((prev) => [created, ...prev]);
      setForm((prev) => ({ ...prev, title: "", notes: "" }));
      if (draftMarkerRef.current) {
        draftMarkerRef.current.remove();
        draftMarkerRef.current = null;
      }
      setActiveTab("feed");
      mapRef.current?.flyTo([created.lat, created.lng], 14);
    }
  }

  async function handleToggleVerify(id) {
    const response = await fetch(`/api/incidents/${id}/verify`, {
      method: "PATCH"
    });
    if (response.ok) {
      const updated = await response.json();
      setIncidents((prev) =>
        prev.map((item) => (item.id === id ? updated : item))
      );
    }
  }

  async function handleSuggestRoutes(item) {
    setLoadingRouteId(item.id);
    try {
      const response = await fetch("/api/routes/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: item.lat,
          lng: item.lng,
          radiusMeters: item.radiusMeters,
          title: item.title
        })
      });
      if (response.ok) {
        const plan = await response.json();
        setActiveRoutePlan(plan);
      }
    } finally {
      setLoadingRouteId(null);
    }
  }

  async function handleDeleteIncident(id) {
    const response = await fetch(`/api/incidents/${id}`, { method: "DELETE" });
    if (response.ok) {
      setIncidents((prev) => prev.filter((item) => item.id !== id));
    }
  }

  async function handlePostNews(e) {
    e.preventDefault();
    if (!newsForm.headline.trim()) return;
    const response = await fetch("/api/news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newsForm)
    });
    if (response.ok) {
      const created = await response.json();
      setNews((prev) => [created, ...prev]);
      setNewsForm({ source: "", tag: "INTEL", headline: "" });
    }
  }

  const verifiedCount = incidents.filter((i) => i.verified).length;
  const pendingCount = incidents.length - verifiedCount;

  return (
    <div className="atlas-layout">
      <aside className="sidebar">
        <div className="topbar">
          <div className="topbar-row">
            <h1>Project Atlas</h1>
            <span className={`live-pill ${online ? "" : "offline"}`}>
              {online ? "GRID LIVE" : "OFFLINE"}
            </span>
          </div>

          <div className="kpi-strip">
            <div className="kpi-box">
              <div className="kpi-val danger">{verifiedCount}</div>
              <div className="kpi-label">Verified Zones</div>
            </div>
            <div className="kpi-box">
              <div className="kpi-val warn">{pendingCount}</div>
              <div className="kpi-label">Pending Verify</div>
            </div>
            <div className="kpi-box">
              <div className="kpi-val ok">{news.length}</div>
              <div className="kpi-label">Intel Wires</div>
            </div>
          </div>
        </div>

        <nav className="nav-tabs">
          <button
            className={`nav-tab ${activeTab === "feed" ? "active" : ""}`}
            onClick={() => setActiveTab("feed")}
          >
            Zones &amp; Routes
          </button>
          <button
            className={`nav-tab ${activeTab === "report" ? "active" : ""}`}
            onClick={() => setActiveTab("report")}
          >
            + Log Report
          </button>
          <button
            className={`nav-tab ${activeTab === "news" ? "active" : ""}`}
            onClick={() => setActiveTab("news")}
          >
            Intel Wire
          </button>
        </nav>

        <div className="sidebar-body">
          {activeTab === "feed" && (
            <>
              <div className="filter-bar">
                <button
                  className={`filter-chip ${verifyFilter === "all" ? "active" : ""}`}
                  onClick={() => setVerifyFilter("all")}
                >
                  All ({incidents.length})
                </button>
                <button
                  className={`filter-chip ${verifyFilter === "verified" ? "active" : ""}`}
                  onClick={() => setVerifyFilter("verified")}
                >
                  Verified ({verifiedCount})
                </button>
                <button
                  className={`filter-chip ${verifyFilter === "unverified" ? "active" : ""}`}
                  onClick={() => setVerifyFilter("unverified")}
                >
                  Pending ({pendingCount})
                </button>
              </div>

              {activeRoutePlan && (
                <div className="route-panel">
                  <div className="route-panel-head">
                    <span>
                      BYPASS ({activeRoutePlan.snappedToRoads ? "ROAD-SNAPPED" : "GRID"}):{" "}
                      {activeRoutePlan.target}
                    </span>
                    <button
                      className="icon-del"
                      onClick={() => setActiveRoutePlan(null)}
                      title="Clear routes"
                    >
                      &times;
                    </button>
                  </div>
                  {activeRoutePlan.routes.map((r) => (
                    <div key={r.id} className="route-option">
                      <strong style={{ color: r.color }}>{r.name}</strong>
                      <div style={{ color: "#94a3b8", marginTop: "2px" }}>
                        {r.status} &bull; {r.distanceKm} km &bull; ~{r.durationMins} mins
                      </div>
                      <div style={{ color: "#cbd5e1", marginTop: "3px" }}>
                        {r.summary}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {filteredIncidents.map((item) => (
                <div key={item.id} className={`incident-card ${item.severity}`}>
                  <div className="card-header">
                    <span
                      className="card-title"
                      onClick={() =>
                        mapRef.current?.flyTo([item.lat, item.lng], 14)
                      }
                    >
                      {item.title}
                    </span>
                    <button
                      className="icon-del"
                      onClick={() => handleDeleteIncident(item.id)}
                      title="Delete report"
                    >
                      &times;
                    </button>
                  </div>

                  <div className="badge-row">
                    <span
                      className={`tag ${item.verified ? "verified" : "unverified"}`}
                    >
                      {item.verified ? "VERIFIED" : "UNVERIFIED"}
                    </span>
                    <span className="tag">{item.category}</span>
                    <span className="tag">{item.radiusMeters}m radius</span>
                  </div>

                  {item.notes && <p className="card-notes">{item.notes}</p>}

                  <div className="card-actions">
                    <button
                      className="btn-sm verify-btn"
                      onClick={() => handleToggleVerify(item.id)}
                    >
                      {item.verified ? "Revoke Verify" : "Verify Report"}
                    </button>
                    <button
                      className="btn-sm route-btn"
                      onClick={() => handleSuggestRoutes(item)}
                      disabled={loadingRouteId === item.id}
                    >
                      {loadingRouteId === item.id ? "Routing..." : "Suggest Bypass"}
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {activeTab === "report" && (
            <form className="form-stack" onSubmit={handleCreateIncident}>
              <p className="card-notes">
                Click anywhere on the dark map to lock GPS coordinates. All new
                submissions enter as <strong>UNVERIFIED</strong> until confirmed.
              </p>

              <div>
                <label className="form-label">Incident Headline</label>
                <input
                  placeholder="e.g., Flash Flood along Eleme Junction"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>

              <div className="row-2">
                <div>
                  <label className="form-label">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value })
                    }
                  >
                    <option>Flooding</option>
                    <option>Road Blockage</option>
                    <option>Hazard</option>
                    <option>Infrastructure</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Threat Intensity</label>
                  <select
                    value={form.severity}
                    onChange={(e) =>
                      setForm({ ...form, severity: e.target.value })
                    }
                  >
                    <option>High</option>
                    <option>Medium</option>
                    <option>Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="form-label">Impact Zone Radius (meters)</label>
                <input
                  type="number"
                  min="200"
                  max="10000"
                  step="100"
                  value={form.radiusMeters}
                  onChange={(e) =>
                    setForm({ ...form, radiusMeters: e.target.value })
                  }
                  required
                />
              </div>

              <div className="row-2">
                <div>
                  <label className="form-label">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={form.lat}
                    onChange={(e) => setForm({ ...form, lat: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="form-label">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={form.lng}
                    onChange={(e) => setForm({ ...form, lng: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="form-label">Field Intel &amp; Landmarks</label>
                <textarea
                  rows="3"
                  placeholder="Describe road conditions, water depth, or eyewitness details..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>

              <button className="btn-primary" type="submit">
                Submit Unverified Report
              </button>
            </form>
          )}

          {activeTab === "news" && (
            <>
              <form className="form-stack" onSubmit={handlePostNews}>
                <div className="row-2">
                  <input
                    placeholder="Source (e.g., Channels / NIMET)"
                    value={newsForm.source}
                    onChange={(e) =>
                      setNewsForm({ ...newsForm, source: e.target.value })
                    }
                  />
                  <select
                    value={newsForm.tag}
                    onChange={(e) =>
                      setNewsForm({ ...newsForm, tag: e.target.value })
                    }
                  >
                    <option value="INTEL">INTEL</option>
                    <option value="WEATHER">WEATHER</option>
                    <option value="TRANSIT">TRANSIT</option>
                    <option value="ALERT">ALERT</option>
                  </select>
                </div>
                <input
                  placeholder="Post breaking regional update..."
                  value={newsForm.headline}
                  onChange={(e) =>
                    setNewsForm({ ...newsForm, headline: e.target.value })
                  }
                  required
                />
                <button className="btn-primary" type="submit">
                  Broadcast to Intel Wire
                </button>
              </form>

              {news.map((n) => (
                <div key={n.id} className="news-card">
                  <div className="news-meta">
                    <span>
                      [{n.tag}] {n.source}
                    </span>
                    <span>{n.timestamp}</span>
                  </div>
                  <p className="news-headline">{n.headline}</p>
                </div>
              ))}
            </>
          )}
        </div>
      </aside>

      <div className="map-wrapper">
        <main ref={mapContainerRef} className="map-container" />
        <div className="map-legend">
          <div className="legend-item">
            <span
              className="dot"
              style={{ background: "#ff2a55", boxShadow: "0 0 8px #ff2a55" }}
            />
            <span>High Intensity (Verified)</span>
          </div>
          <div className="legend-item">
            <span
              className="dot"
              style={{ background: "#ff9900", boxShadow: "0 0 8px #ff9900" }}
            />
            <span>Moderate Hazard (Verified)</span>
          </div>
          <div className="legend-item">
            <span
              className="dot"
              style={{ background: "#fbbf24", border: "1px dashed #fff" }}
            />
            <span>Pending Verification</span>
          </div>
          <div className="legend-item">
            <span className="dot" style={{ background: "#10b981" }} />
            <span>Suggested Bypass Route</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
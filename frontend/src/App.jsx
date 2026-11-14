import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

const PH_CENTER = [4.8156, 7.0498];

const PH_PRESETS = [
  {
    name: "Oyigbo -> Town / Garrison",
    origin: [4.8781, 7.1285],
    destination: [4.7775, 7.0135]
  },
  {
    name: "Uniport (Choba) -> Port Harcourt",
    origin: [4.9012, 6.9205],
    destination: [4.7925, 7.0155]
  },
  {
    name: "Rumuokoro -> Peter Odili Rd",
    origin: [4.8674, 6.9988],
    destination: [4.7965, 7.0432]
  },
  {
    name: "Eleme Junction -> Woji Axis",
    origin: [4.8552, 7.0645],
    destination: [4.8185, 7.0525]
  }
];

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
    html: `<div style="background:#090e1a;border:2px solid ${color};color:${color};font-family:monospace;font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;white-space:nowrap;box-shadow:0 0 10px rgba(0,0,0,0.85);">${label}</div>`,
    iconSize: [58, 18],
    iconAnchor: [29, 9]
  });
}

function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const zonesLayerRef = useRef(null);
  const routesLayerRef = useRef(null);
  const navPinsLayerRef = useRef(null);
  const draftMarkerRef = useRef(null);
  const clickModeRef = useRef("report");
  const navStepRef = useRef("origin");

  const [online, setOnline] = useState(false);
  const [activeTab, setActiveTab] = useState("feed");
  const [clickMode, setClickMode] = useState("report");
  const [verifyFilter, setVerifyFilter] = useState("all");
  const [incidents, setIncidents] = useState([]);
  const [news, setNews] = useState([]);
  const [activeRoutePlan, setActiveRoutePlan] = useState(null);
  const [loadingRouteId, setLoadingRouteId] = useState(null);
  const [syncingOsint, setSyncingOsint] = useState(false);
  const [osintToast, setOsintToast] = useState("");

  const [navForm, setNavForm] = useState({
    originLat: "4.8781",
    originLng: "7.1285",
    destLat: "4.7775",
    destLng: "7.0135"
  });

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
    clickModeRef.current = clickMode;
  }, [clickMode]);

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
    navPinsLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (e) => {
      const lat = e.latlng.lat.toFixed(5);
      const lng = e.latlng.lng.toFixed(5);

      if (clickModeRef.current === "nav") {
        setActiveTab("nav");
        if (navStepRef.current === "origin") {
          setNavForm((prev) => ({ ...prev, originLat: lat, originLng: lng }));
          navStepRef.current = "dest";
        } else {
          setNavForm((prev) => ({ ...prev, destLat: lat, destLng: lng }));
          navStepRef.current = "origin";
        }
        return;
      }

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
    if (!navPinsLayerRef.current) return;
    navPinsLayerRef.current.clearLayers();

    if (clickMode !== "nav" && activeTab !== "nav") return;

    const oLat = Number(navForm.originLat);
    const oLng = Number(navForm.originLng);
    const dLat = Number(navForm.destLat);
    const dLng = Number(navForm.destLng);

    if (!Number.isNaN(oLat) && !Number.isNaN(oLng)) {
      L.marker([oLat, oLng], {
        icon: createEndpointIcon("ORIGIN A", "#10b981")
      }).addTo(navPinsLayerRef.current);
    }
    if (!Number.isNaN(dLat) && !Number.isNaN(dLng)) {
      L.marker([dLat, dLng], {
        icon: createEndpointIcon("DEST B", "#38bdf8")
      }).addTo(navPinsLayerRef.current);
    }
  }, [navForm, clickMode, activeTab]);

  async function loadGridData() {
    const [health, incList, newsList] = await Promise.all([
      fetch("/api/health").then((r) => r.json()),
      fetch("/api/incidents").then((r) => r.json()),
      fetch("/api/news").then((r) => r.json())
    ]);
    setOnline(health.status === "ok");
    setIncidents(incList);
    setNews(newsList);
  }

  useEffect(() => {
    loadGridData().catch(() => setOnline(false));
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

    if (activeRoutePlan.blockedRoute?.coordinates?.length) {
      L.polyline(activeRoutePlan.blockedRoute.coordinates, {
        color: "#ff2a55",
        weight: 3.5,
        opacity: 0.7,
        dashArray: "6 8"
      })
        .bindPopup(
          `<strong>Blocked Direct Route</strong><br/>Intersects verified hazard zone(s)`
        )
        .addTo(routesLayerRef.current);
      allBounds.push(...activeRoutePlan.blockedRoute.coordinates);
    }

    activeRoutePlan.routes.forEach((route) => {
      const poly = L.polyline(route.coordinates, {
        color: route.color,
        weight: route.id === "route-alpha" ? 5 : 3.5,
        opacity: route.id === "route-alpha" ? 0.95 : 0.75,
        dashArray: route.id === "route-alpha" ? null : "8 8"
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
        L.marker(startPt, { icon: createEndpointIcon("START A", "#10b981") }).addTo(
          routesLayerRef.current
        );
        L.marker(endPt, { icon: createEndpointIcon("DEST B", "#38bdf8") }).addTo(
          routesLayerRef.current
        );
      }

      poly.bringToFront();
    });

    if (allBounds.length && mapRef.current) {
      mapRef.current.fitBounds(allBounds, { padding: [55, 55] });
    }
  }, [activeRoutePlan]);

  async function handleSyncOsint() {
    setSyncingOsint(true);
    try {
      const res = await fetch("/api/osint/sync", { method: "POST" });
      if (res.ok) {
        const summary = await res.json();
        await loadGridData();
        setOsintToast(
          `OSINT Sync: +${summary.newNewsCount} intel wire(s), +${summary.newPinsCount} auto-pinned zone(s)`
        );
        if (summary.latestAutoPin && mapRef.current) {
          mapRef.current.flyTo(
            [summary.latestAutoPin.lat, summary.latestAutoPin.lng],
            13
          );
        }
      }
    } finally {
      setSyncingOsint(false);
    }
  }

  async function runSafeNavigation(origin, destination, label = "Custom Corridor") {
    setLoadingRouteId("nav");
    try {
      const response = await fetch("/api/routes/navigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, destination, label })
      });
      if (response.ok) {
        const plan = await response.json();
        setActiveRoutePlan(plan);
      }
    } finally {
      setLoadingRouteId(null);
    }
  }

  async function handleNavSubmit(e) {
    e.preventDefault();
    await runSafeNavigation(
      [Number(navForm.originLat), Number(navForm.originLng)],
      [Number(navForm.destLat), Number(navForm.destLng)],
      "Custom A -> B Corridor"
    );
  }

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

  const renderRoutePanel = () => {
    if (!activeRoutePlan) return null;
    return (
      <div className="route-panel">
        <div className="route-panel-head">
          <span>
            {activeRoutePlan.snappedToRoads ? "ROAD-SNAPPED" : "GRID"}:{" "}
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

        {activeRoutePlan.avoidedZones?.length > 0 && (
          <div className="avoided-banner">
            Avoided {activeRoutePlan.avoidedZones.length} active zone(s):{" "}
            {activeRoutePlan.avoidedZones.join(", ")}
          </div>
        )}

        {activeRoutePlan.routes.map((r) => (
          <div key={r.id} className="route-option">
            <strong style={{ color: r.color }}>{r.name}</strong>
            <div style={{ color: "#94a3b8", marginTop: "2px" }}>
              {r.status} &bull; {r.distanceKm} km &bull; ~{r.durationMins} mins
            </div>
            <div style={{ color: "#cbd5e1", marginTop: "3px" }}>{r.summary}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="atlas-layout">
      <aside className="sidebar">
        <div className="topbar">
          <div className="topbar-row">
            <h1>Project Atlas</h1>
            <div className="top-actions">
              <button
                className="sync-btn"
                onClick={handleSyncOsint}
                disabled={syncingOsint}
                title="Scan live Nigerian news & weather feeds for Port Harcourt landmarks"
              >
                {syncingOsint ? "SCANNING..." : "SYNC OSINT"}
              </button>
              <span className={`live-pill ${online ? "" : "offline"}`}>
                {online ? "LIVE" : "OFFLINE"}
              </span>
            </div>
          </div>

          {osintToast && (
            <div className="osint-toast">
              <span>{osintToast}</span>
              <button
                className="icon-del"
                onClick={() => setOsintToast("")}
                title="Dismiss"
              >
                &times;
              </button>
            </div>
          )}

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
            Zones
          </button>
          <button
            className={`nav-tab ${activeTab === "nav" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("nav");
              setClickMode("nav");
            }}
          >
            Safe Nav
          </button>
          <button
            className={`nav-tab ${activeTab === "report" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("report");
              setClickMode("report");
            }}
          >
            + Report
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

              {renderRoutePanel()}

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
                    {item.autoGeocoded && (
                      <span className="tag osint">AUTO-OSINT</span>
                    )}
                    <span className="tag">{item.category}</span>
                    <span className="tag">{item.radiusMeters}m</span>
                  </div>

                  {item.notes && <p className="card-notes">{item.notes}</p>}

                  {item.sourceUrl && (
                    <a
                      className="source-link"
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Inspect Source Dispatch &rarr;
                    </a>
                  )}

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

          {activeTab === "nav" && (
            <>
              <p className="card-notes">
                Click the map to alternate between setting <strong>Origin A</strong>{" "}
                and <strong>Destination B</strong>, or select a Port Harcourt
                corridor preset below.
              </p>

              <div>
                <span className="form-label">Quick Port Harcourt Corridors</span>
                <div className="preset-grid">
                  {PH_PRESETS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      className="preset-btn"
                      onClick={() => {
                        setNavForm({
                          originLat: String(p.origin[0]),
                          originLng: String(p.origin[1]),
                          destLat: String(p.destination[0]),
                          destLng: String(p.destination[1])
                        });
                        runSafeNavigation(p.origin, p.destination, p.name);
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              <form className="form-stack" onSubmit={handleNavSubmit}>
                <div className="row-2">
                  <div>
                    <label className="form-label">Origin A Lat</label>
                    <input
                      type="number"
                      step="any"
                      value={navForm.originLat}
                      onChange={(e) =>
                        setNavForm({ ...navForm, originLat: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Origin A Lng</label>
                    <input
                      type="number"
                      step="any"
                      value={navForm.originLng}
                      onChange={(e) =>
                        setNavForm({ ...navForm, originLng: e.target.value })
                      }
                      required
                    />
                  </div>
                </div>

                <div className="row-2">
                  <div>
                    <label className="form-label">Destination B Lat</label>
                    <input
                      type="number"
                      step="any"
                      value={navForm.destLat}
                      onChange={(e) =>
                        setNavForm({ ...navForm, destLat: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Destination B Lng</label>
                    <input
                      type="number"
                      step="any"
                      value={navForm.destLng}
                      onChange={(e) =>
                        setNavForm({ ...navForm, destLng: e.target.value })
                      }
                      required
                    />
                  </div>
                </div>

                <button
                  className="btn-primary"
                  type="submit"
                  disabled={loadingRouteId === "nav"}
                >
                  {loadingRouteId === "nav"
                    ? "Scanning Verified Zones..."
                    : "Compute Hazard-Free Route"}
                </button>
              </form>

              {renderRoutePanel()}
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
              <button
                type="button"
                className="btn-primary"
                onClick={handleSyncOsint}
                disabled={syncingOsint}
              >
                {syncingOsint
                  ? "Fetching Live RSS & Weather Feeds..."
                  : "Pull Live Port Harcourt News & Weather"}
              </button>

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
                  placeholder="Post manual regional update..."
                  value={newsForm.headline}
                  onChange={(e) =>
                    setNewsForm({ ...newsForm, headline: e.target.value })
                  }
                  required
                />
                <button className="btn-sm" type="submit">
                  + Add Manual Intel Wire
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
                  {n.url && (
                    <a
                      className="source-link"
                      href={n.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Original Story &rarr;
                    </a>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </aside>

      <div className="map-wrapper">
        <main ref={mapContainerRef} className="map-container" />

        <div className="map-hud-top">
          <button
            className={`hud-btn ${clickMode === "report" ? "active" : ""}`}
            onClick={() => setClickMode("report")}
          >
            Click Mode: Pin Incident
          </button>
          <button
            className={`hud-btn ${clickMode === "nav" ? "active" : ""}`}
            onClick={() => {
              setClickMode("nav");
              setActiveTab("nav");
            }}
          >
            Click Mode: Set A &rarr; B
          </button>
        </div>

        <div className="map-legend">
          <div className="legend-item">
            <span
              className="dot"
              style={{ background: "#ff2a55", boxShadow: "0 0 8px #ff2a55" }}
            />
            <span>High Intensity / Blocked Direct</span>
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
            <span>Pending / Auto-OSINT Pin</span>
          </div>
          <div className="legend-item">
            <span className="dot" style={{ background: "#10b981" }} />
            <span>Safe Detour Corridor</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

const PH_CENTER = [4.8156, 7.0498];

const TIME_WINDOWS = [
  { id: "all", label: "ALL", maxAgeMs: Infinity },
  { id: "7d", label: "7D", maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
  { id: "24h", label: "24H", maxAgeMs: 24 * 60 * 60 * 1000 },
  { id: "12h", label: "12H", maxAgeMs: 12 * 60 * 60 * 1000 },
  { id: "6h", label: "6H", maxAgeMs: 6 * 60 * 60 * 1000 }
];

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
    glow: "0 0 14px #ff2a55, 0 0 30px #ff2a55, 0 0 52px rgba(255, 42, 85, 0.85)",
    ring: "#ff2a55"
  },
  Medium: {
    core: "#ff9900",
    glow: "0 0 12px #ff9900, 0 0 26px rgba(255, 153, 0, 0.8)",
    ring: "#ff9900"
  },
  Low: {
    core: "#00e5a8",
    glow: "0 0 10px #00e5a8, 0 0 22px rgba(0, 229, 168, 0.7)",
    ring: "#00e5a8"
  }
};

function getZoomRadarScale(zoom) {
  if (zoom <= 12) return 1;
  return Math.max(0.015, Math.pow(0.46, zoom - 12));
}

function createHotspotIcon(severity, verified, zoom) {
  const theme = SEVERITY_THEME[severity] || SEVERITY_THEME.Medium;
  const shadow = verified ? theme.glow : "0 0 8px rgba(251, 191, 36, 0.65)";
  const bg = verified ? theme.core : "#fbbf24";
  const size = Math.max(9, Math.min(18, Math.round(18 - Math.max(0, zoom - 12) * 1.6)));
  const half = Math.round(size / 2);

  return L.divIcon({
    className: "",
    html: `<div class="warzone-core ${verified ? "" : "unverified"}" style="width:${size}px;height:${size}px;background:${bg};box-shadow:${shadow};"></div>`,
    iconSize: [size, size],
    iconAnchor: [half, half]
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
  const draftPolyLayerRef = useRef(null);
  const draftMarkerRef = useRef(null);
  const clickModeRef = useRef("report");
  const navStepRef = useRef("origin");

  const [online, setOnline] = useState(false);
  const [mapZoom, setMapZoom] = useState(12);
  const [cursorGps, setCursorGps] = useState({ lat: 4.8156, lng: 7.0498 });
  const [timeWindow, setTimeWindow] = useState("all");
  const [activeTab, setActiveTab] = useState("feed");
  const [clickMode, setClickMode] = useState("report");
  const [reportType, setReportType] = useState("point");
  const [verifyFilter, setVerifyFilter] = useState("all");
  const [incidents, setIncidents] = useState([]);
  const [zones, setZones] = useState([]);
  const [news, setNews] = useState([]);
  const [landmarks, setLandmarks] = useState([]);
  const [draftPolygon, setDraftPolygon] = useState([]);
  const [activeRoutePlan, setActiveRoutePlan] = useState(null);
  const [loadingRouteId, setLoadingRouteId] = useState(null);
  const [syncingOsint, setSyncingOsint] = useState(false);
  const [osintToast, setOsintToast] = useState("");

  const [operatorPin, setOperatorPin] = useState("");
  const [isOperator, setIsOperator] = useState(false);
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  const [pinInput, setPinInput] = useState("");

  const [layersVisible, setLayersVisible] = useState({
    verified: true,
    unverified: true,
    geofences: true
  });

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
    draftPolyLayerRef.current = L.layerGroup().addTo(map);

    map.on("zoom zoomend", () => {
      setMapZoom(map.getZoom());
    });

    map.on("mousemove", (e) => {
      setCursorGps({
        lat: Number(e.latlng.lat.toFixed(5)),
        lng: Number(e.latlng.lng.toFixed(5))
      });
    });

    map.on("click", (e) => {
      const lat = Number(e.latlng.lat.toFixed(5));
      const lng = Number(e.latlng.lng.toFixed(5));

      if (clickModeRef.current === "draw") {
        setDraftPolygon((prev) => [...prev, [lat, lng]]);
        return;
      }

      if (clickModeRef.current === "nav") {
        setActiveTab("nav");
        if (navStepRef.current === "origin") {
          setNavForm((prev) => ({
            ...prev,
            originLat: String(lat),
            originLng: String(lng)
          }));
          navStepRef.current = "dest";
        } else {
          setNavForm((prev) => ({
            ...prev,
            destLat: String(lat),
            destLng: String(lng)
          }));
          navStepRef.current = "origin";
        }
        return;
      }

      setForm((prev) => ({ ...prev, lat: String(lat), lng: String(lng) }));
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
    if (!draftPolyLayerRef.current) return;
    draftPolyLayerRef.current.clearLayers();

    if (draftPolygon.length === 0) return;

    draftPolygon.forEach((pt, idx) => {
      L.marker(pt, {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:12px;height:12px;border-radius:50%;background:#c084fc;border:2px solid #fff;box-shadow:0 0 10px #a855f7;"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6]
        })
      })
        .bindPopup(`Vertex #${idx + 1}`)
        .addTo(draftPolyLayerRef.current);
    });

    if (draftPolygon.length === 2) {
      L.polyline(draftPolygon, {
        color: "#c084fc",
        weight: 2.5,
        dashArray: "6 6"
      }).addTo(draftPolyLayerRef.current);
    } else if (draftPolygon.length >= 3) {
      L.polygon(draftPolygon, {
        color: "#c084fc",
        weight: 2.5,
        fillColor: "#a855f7",
        fillOpacity: 0.22,
        dashArray: "6 6"
      }).addTo(draftPolyLayerRef.current);
    }
  }, [draftPolygon]);

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
    const [health, incList, zoneList, newsList, lmList] = await Promise.all([
      fetch("/api/health").then((r) => r.json()),
      fetch("/api/incidents").then((r) => r.json()),
      fetch("/api/zones").then((r) => r.json()),
      fetch("/api/news").then((r) => r.json()),
      fetch("/api/landmarks").then((r) => r.json())
    ]);
    setOnline(health.status === "ok");
    setIncidents(incList);
    setZones(zoneList);
    setNews(newsList);
    setLandmarks(lmList);
  }

  useEffect(() => {
    loadGridData().catch(() => setOnline(false));
    const timer = setInterval(() => {
      loadGridData().catch(() => setOnline(false));
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const activeTimeSpec =
    TIME_WINDOWS.find((tw) => tw.id === timeWindow) || TIME_WINDOWS[0];

  const isWithinWindow = (record) => {
    if (activeTimeSpec.maxAgeMs === Infinity) return true;
    const rawTs = record.publishedAt || record.createdAt;
    if (!rawTs) return true;
    const parsed = Date.parse(rawTs);
    if (Number.isNaN(parsed)) return true;
    return Date.now() - parsed <= activeTimeSpec.maxAgeMs;
  };

  const filteredIncidents = incidents.filter((item) => {
    if (!isWithinWindow(item)) return false;
    if (verifyFilter === "verified") return item.verified;
    if (verifyFilter === "unverified") return !item.verified;
    return true;
  });

  const filteredZones = zones.filter((z) => {
    if (!isWithinWindow(z)) return false;
    if (verifyFilter === "verified") return z.verified;
    if (verifyFilter === "unverified") return !z.verified;
    return true;
  });

  useEffect(() => {
    if (!zonesLayerRef.current) return;
    zonesLayerRef.current.clearLayers();

    const zoomScale = getZoomRadarScale(mapZoom);

    if (layersVisible.geofences) {
      filteredZones.forEach((zone) => {
        if (!Array.isArray(zone.coordinates) || zone.coordinates.length < 3) return;
        const theme = SEVERITY_THEME[zone.severity] || SEVERITY_THEME.High;

        if (zone.verified) {
          L.polygon(zone.coordinates, {
            color: theme.ring,
            weight: 2,
            opacity: 0.85,
            fillColor: theme.core,
            fillOpacity: 0.26
          })
            .bindPopup(
              `<strong>${zone.name}</strong><br/>` +
                `<span style="color:#34d399;font-size:11px;">VERIFIED GEOFENCE</span> &bull; ${zone.category}<br/>` +
                `<small>${zone.notes || ""}</small>`
            )
            .addTo(zonesLayerRef.current);
        } else {
          L.polygon(zone.coordinates, {
            color: "#fbbf24",
            weight: 2,
            opacity: 0.75,
            fillColor: "#fbbf24",
            fillOpacity: 0.14,
            dashArray: "6 6"
          })
            .bindPopup(
              `<strong>${zone.name}</strong><br/>` +
                `<span style="color:#fbbf24;font-size:11px;">UNVERIFIED GEOFENCE</span> &bull; ${zone.category}`
            )
            .addTo(zonesLayerRef.current);
        }
      });
    }

    filteredIncidents.forEach((item) => {
      if (item.verified && !layersVisible.verified) return;
      if (!item.verified && !layersVisible.unverified) return;

      const theme = SEVERITY_THEME[item.severity] || SEVERITY_THEME.Medium;
      const baseRadius = Number(item.radiusMeters) || 1000;
      const effectiveRadius = baseRadius * zoomScale;
      const center = [item.lat, item.lng];

      if (item.verified) {
        const layers = [
          { scale: 1.55, fillOpacity: 0.05, strokeOpacity: 0.22, dash: "4 6" },
          { scale: 1.15, fillOpacity: 0.11, strokeOpacity: 0.36, dash: null },
          { scale: 0.8, fillOpacity: 0.19, strokeOpacity: 0.52, dash: null },
          { scale: 0.48, fillOpacity: 0.3, strokeOpacity: 0.68, dash: null },
          { scale: 0.22, fillOpacity: 0.48, strokeOpacity: 0.88, dash: null }
        ];

        layers.forEach((layer) => {
          L.circle(center, {
            radius: effectiveRadius * layer.scale,
            color: theme.ring,
            weight: 1,
            opacity: layer.strokeOpacity,
            fillColor: theme.core,
            fillOpacity: layer.fillOpacity,
            dashArray: layer.dash
          }).addTo(zonesLayerRef.current);
        });
      } else {
        const unverifiedRadius = Math.min(baseRadius, 280) * zoomScale;
        L.circle(center, {
          radius: unverifiedRadius,
          color: "#fbbf24",
          weight: 1.25,
          opacity: 0.65,
          fillColor: "#fbbf24",
          fillOpacity: 0.12,
          dashArray: "4 4"
        }).addTo(zonesLayerRef.current);
      }

      const statusText = item.verified
        ? "VERIFIED INTEL"
        : `UNVERIFIED (${item.confirmations || 1}/3 CONFIRMS)`;
      L.marker(center, {
        icon: createHotspotIcon(item.severity, item.verified, mapZoom)
      })
        .bindPopup(
          `<strong>${item.title}</strong><br/>` +
            `<span style="color:${item.verified ? "#34d399" : "#fbbf24"};font-size:11px;">${statusText}</span> &bull; ${item.severity} (${baseRadius}m zone)<br/>` +
            `<small>${item.notes || ""}</small>`
        )
        .addTo(zonesLayerRef.current);
    });
  }, [filteredIncidents, filteredZones, mapZoom, layersVisible]);

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

  async function handleOperatorAuth(e) {
    e.preventDefault();
    const res = await fetch("/api/operator/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pinInput })
    });
    if (res.ok) {
      setOperatorPin(pinInput);
      setIsOperator(true);
      setShowPinPrompt(false);
      setPinInput("");
      setOsintToast("Operator Command Mode unlocked.");
    } else {
      setOsintToast("Invalid Command PIN (default: 2026).");
    }
  }

  function handleLockOperator() {
    setIsOperator(false);
    setOperatorPin("");
    setOsintToast("Operator Mode locked (Public/Field Scout view).");
  }

  function requireOperatorUi() {
    if (isOperator) return true;
    setShowPinPrompt(true);
    setOsintToast("Unlock Operator Mode (PIN: 2026) to manage zones.");
    return false;
  }

  async function handleSyncOsint() {
    setSyncingOsint(true);
    try {
      const res = await fetch("/api/osint/sync", { method: "POST" });
      if (res.ok) {
        const summary = await res.json();
        await loadGridData();
        setOsintToast(
          `OSINT Sync: +${summary.newNewsCount} intel wire(s), +${summary.newPinsCount} landmark pin(s)`
        );
        if (summary.latestAutoPin && mapRef.current) {
          mapRef.current.flyTo(
            [summary.latestAutoPin.lat, summary.latestAutoPin.lng],
            14
          );
        }
      }
    } finally {
      setSyncingOsint(false);
    }
  }

  async function handleExportSitrep() {
    const res = await fetch("/api/sitrep");
    if (!res.ok) return;
    const data = await res.json();
    const blob = new Blob([data.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = data.filename;
    link.click();
    URL.revokeObjectURL(url);
    setOsintToast(`Exported briefing: ${data.filename}`);
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

  async function handleCreateSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;

    if (reportType === "polygon") {
      if (draftPolygon.length < 3) return;
      const response = await fetch("/api/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.title,
          category: form.category,
          severity: form.severity,
          coordinates: draftPolygon,
          notes: form.notes
        })
      });
      if (response.ok) {
        const created = await response.json();
        setZones((prev) => [created, ...prev]);
        setDraftPolygon([]);
        setForm((prev) => ({ ...prev, title: "", notes: "" }));
        setClickMode("report");
        setActiveTab("feed");
      }
      return;
    }

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
      mapRef.current?.flyTo([created.lat, created.lng], 15);
    }
  }

  async function handleCorroborate(id) {
    const response = await fetch(`/api/incidents/${id}/corroborate`, {
      method: "POST"
    });
    if (response.ok) {
      const updated = await response.json();
      setIncidents((prev) =>
        prev.map((item) => (item.id === id ? updated : item))
      );
      if (updated.verified) {
        setOsintToast(`Threshold reached (3/3): "${updated.title}" auto-verified!`);
      }
    }
  }

  async function handleSeverityChange(id, severity) {
    if (!requireOperatorUi()) return;
    const response = await fetch(`/api/incidents/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-operator-pin": operatorPin
      },
      body: JSON.stringify({ severity })
    });
    if (response.ok) {
      const updated = await response.json();
      setIncidents((prev) =>
        prev.map((item) => (item.id === id ? updated : item))
      );
    }
  }

  async function handleToggleVerify(id) {
    if (!requireOperatorUi()) return;
    const response = await fetch(`/api/incidents/${id}/verify`, {
      method: "PATCH",
      headers: { "x-operator-pin": operatorPin }
    });
    if (response.ok) {
      const updated = await response.json();
      setIncidents((prev) =>
        prev.map((item) => (item.id === id ? updated : item))
      );
    }
  }

  async function handleToggleZoneVerify(id) {
    if (!requireOperatorUi()) return;
    const response = await fetch(`/api/zones/${id}/verify`, {
      method: "PATCH",
      headers: { "x-operator-pin": operatorPin }
    });
    if (response.ok) {
      const updated = await response.json();
      setZones((prev) => prev.map((z) => (z.id === id ? updated : z)));
    }
  }

  async function handleDeleteZone(id) {
    if (!requireOperatorUi()) return;
    const response = await fetch(`/api/zones/${id}`, {
      method: "DELETE",
      headers: { "x-operator-pin": operatorPin }
    });
    if (response.ok) {
      setZones((prev) => prev.filter((z) => z.id !== id));
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
    if (!requireOperatorUi()) return;
    const response = await fetch(`/api/incidents/${id}`, {
      method: "DELETE",
      headers: { "x-operator-pin": operatorPin }
    });
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

  const verifiedCount =
    incidents.filter((i) => i.verified).length +
    zones.filter((z) => z.verified).length;
  const pendingCount =
    incidents.filter((i) => !i.verified).length +
    zones.filter((z) => !z.verified).length;
  const totalCount = incidents.length + zones.length;
  const radarPct = Math.max(2, Math.round(getZoomRadarScale(mapZoom) * 100));

  // Threat Analytics Computations
  const allItems = [...incidents, ...zones];
  const highVerified = allItems.filter((x) => x.verified && x.severity === "High").length;
  const threatStatus =
    highVerified >= 3
      ? { label: "CRITICAL", bg: "rgba(255,42,85,0.2)", color: "#ff2a55" }
      : highVerified >= 1
      ? { label: "HIGH ALERT", bg: "rgba(255,153,0,0.2)", color: "#ff9900" }
      : { label: "GUARDED", bg: "rgba(16,185,129,0.2)", color: "#34d399" };

  const categories = ["Flooding", "Road Blockage", "Hazard", "Infrastructure"];
  const catColors = {
    Flooding: "#38bdf8",
    "Road Blockage": "#f59e0b",
    Hazard: "#ff2a55",
    Infrastructure: "#a855f7"
  };

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
              {isOperator ? (
                <button
                  className="sync-btn op-unlocked"
                  onClick={handleLockOperator}
                  title="Operator Mode Active — Click to lock"
                >
                  OP: UNLOCKED
                </button>
              ) : (
                <button
                  className="sync-btn op-locked"
                  onClick={() => setShowPinPrompt((prev) => !prev)}
                  title="Unlock Operator Command Mode (PIN: 2026)"
                >
                  OP: LOCKED
                </button>
              )}
              <button
                className="sync-btn sitrep"
                onClick={handleExportSitrep}
                title="Download Markdown Situation Report"
              >
                SITREP
              </button>
              <button
                className="sync-btn"
                onClick={handleSyncOsint}
                disabled={syncingOsint}
                title="Scan live Nigerian news & weather feeds for Port Harcourt landmarks"
              >
                {syncingOsint ? "SCAN..." : "OSINT"}
              </button>
            </div>
          </div>

          {showPinPrompt && !isOperator && (
            <form className="pin-bar" onSubmit={handleOperatorAuth}>
              <input
                type="password"
                placeholder="Enter Command PIN (2026)"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                autoFocus
              />
              <button className="btn-sm verify-btn" type="submit">
                Unlock
              </button>
            </form>
          )}

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
              <div className="kpi-val ok">{online ? news.length : "OFF"}</div>
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
              setClickMode(reportType === "polygon" ? "draw" : "report");
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
          <button
            className={`nav-tab ${activeTab === "stats" ? "active" : ""}`}
            onClick={() => setActiveTab("stats")}
          >
            Stats
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
                  All ({totalCount})
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

              {filteredZones.length > 0 && (
                <>
                  <div className="section-label">
                    Polygon Geofences ({filteredZones.length})
                  </div>
                  {filteredZones.map((zone) => (
                    <div key={zone.id} className={`incident-card ${zone.severity}`}>
                      <div className="card-header">
                        <span
                          className="card-title"
                          onClick={() => {
                            if (zone.coordinates?.length && mapRef.current) {
                              mapRef.current.fitBounds(zone.coordinates, {
                                padding: [60, 60]
                              });
                            }
                          }}
                        >
                          {zone.name}
                        </span>
                        <button
                          className="icon-del"
                          onClick={() => handleDeleteZone(zone.id)}
                          title={
                            isOperator
                              ? "Delete polygon zone"
                              : "Operator PIN required to delete"
                          }
                        >
                          &times;
                        </button>
                      </div>

                      <div className="badge-row">
                        <span
                          className={`tag ${zone.verified ? "verified" : "unverified"}`}
                        >
                          {zone.verified ? "VERIFIED" : "UNVERIFIED"}
                        </span>
                        <span className="tag geofence">
                          GEOFENCE ({zone.coordinates.length} PTS)
                        </span>
                        <span className="tag">{zone.category}</span>
                      </div>

                      {zone.notes && <p className="card-notes">{zone.notes}</p>}

                      <div className="card-actions">
                        <button
                          className="btn-sm verify-btn"
                          onClick={() => handleToggleZoneVerify(zone.id)}
                        >
                          {zone.verified
                            ? isOperator
                              ? "Revoke Verify"
                              : "Locked (OP)"
                            : isOperator
                            ? "Verify Geofence"
                            : "Verify (OP PIN)"}
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}

              <div className="section-label">
                Point Radars ({filteredIncidents.length})
              </div>
              {filteredIncidents.map((item) => (
                <div key={item.id} className={`incident-card ${item.severity}`}>
                  <div className="card-header">
                    <span
                      className="card-title"
                      onClick={() =>
                        mapRef.current?.flyTo([item.lat, item.lng], 15)
                      }
                    >
                      {item.title}
                    </span>
                    <button
                      className="icon-del"
                      onClick={() => handleDeleteIncident(item.id)}
                      title={
                        isOperator
                          ? "Delete report"
                          : "Operator PIN required to delete"
                      }
                    >
                      &times;
                    </button>
                  </div>

                  <div className="badge-row">
                    <span
                      className={`tag ${item.verified ? "verified" : "unverified"}`}
                    >
                      {item.verified
                        ? `VERIFIED (${item.confirmations || 3}/3)`
                        : `UNVERIFIED (${item.confirmations || 1}/3)`}
                    </span>
                    {item.autoGeocoded && (
                      <span className="tag osint">AUTO-OSINT</span>
                    )}
                    <span className="tag">{item.category}</span>
                    <span className="tag">{item.radiusMeters}m</span>
                    {isOperator && (
                      <select
                        className="sev-select"
                        value={item.severity}
                        onChange={(e) =>
                          handleSeverityChange(item.id, e.target.value)
                        }
                        title="Escalate or de-escalate threat intensity"
                      >
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                      </select>
                    )}
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
                    {!item.verified && (
                      <button
                        className="btn-sm confirm-btn"
                        onClick={() => handleCorroborate(item.id)}
                        title="Add field confirmation (auto-verifies at 3/3)"
                      >
                        Confirm (+1)
                      </button>
                    )}
                    <button
                      className="btn-sm verify-btn"
                      onClick={() => handleToggleVerify(item.id)}
                    >
                      {item.verified
                        ? isOperator
                          ? "Revoke"
                          : "Locked"
                        : isOperator
                        ? "Verify"
                        : "OP Verify"}
                    </button>
                    <button
                      className="btn-sm route-btn"
                      onClick={() => handleSuggestRoutes(item)}
                      disabled={loadingRouteId === item.id}
                    >
                      {loadingRouteId === item.id ? "Routing..." : "Bypass"}
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
            <form className="form-stack" onSubmit={handleCreateSubmit}>
              <div className="filter-bar">
                <button
                  type="button"
                  className={`filter-chip ${reportType === "point" ? "active" : ""}`}
                  onClick={() => {
                    setReportType("point");
                    setClickMode("report");
                  }}
                >
                  Point Radar
                </button>
                <button
                  type="button"
                  className={`filter-chip ${reportType === "polygon" ? "active" : ""}`}
                  onClick={() => {
                    setReportType("polygon");
                    setClickMode("draw");
                  }}
                >
                  Polygon Geofence
                </button>
              </div>

              <p className="card-notes">
                {reportType === "polygon"
                  ? `Click at least 3 boundary points on the map to trace a floodbasin or cordoned area (${draftPolygon.length} point(s) plotted).`
                  : "Click anywhere on the map to lock GPS coordinates. New reports auto-verify at 3 field confirmations or via Operator PIN."}
              </p>

              <div>
                <label className="form-label">
                  {reportType === "polygon" ? "Geofence Zone Name" : "Incident Headline"}
                </label>
                <input
                  placeholder={
                    reportType === "polygon"
                      ? "e.g., Aba Rd - Eleme Flood Corridor"
                      : "e.g., Flash Flood along Eleme Junction"
                  }
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

              {reportType === "point" ? (
                <>
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
                </>
              ) : (
                <div className="row-2">
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => setDraftPolygon((prev) => prev.slice(0, -1))}
                    disabled={draftPolygon.length === 0}
                  >
                    Undo Vertex
                  </button>
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => setDraftPolygon([])}
                    disabled={draftPolygon.length === 0}
                  >
                    Clear Polygon
                  </button>
                </div>
              )}

              <div>
                <label className="form-label">Field Intel &amp; Landmarks</label>
                <textarea
                  rows="3"
                  placeholder="Describe road conditions, water depth, or perimeter boundaries..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>

              <button
                className="btn-primary"
                type="submit"
                disabled={reportType === "polygon" && draftPolygon.length < 3}
              >
                {reportType === "polygon"
                  ? `Save Polygon Geofence (${draftPolygon.length}/3+ pts)`
                  : "Submit Unverified Report"}
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

          {activeTab === "stats" && (
            <>
              <div className="defcon-card">
                <div>
                  <div className="kpi-label">Port Harcourt Grid Posture</div>
                  <div style={{ fontSize: "0.84rem", marginTop: "3px" }}>
                    {highVerified} Verified High-Intensity Zone(s)
                  </div>
                </div>
                <span
                  className="defcon-badge"
                  style={{ background: threatStatus.bg, color: threatStatus.color }}
                >
                  {threatStatus.label}
                </span>
              </div>

              <div className="stat-card">
                <div className="section-label" style={{ marginTop: 0 }}>
                  Incidents by Hazard Category
                </div>
                {categories.map((cat) => {
                  const count = allItems.filter((i) => i.category === cat).length;
                  const pct = totalCount ? Math.round((count / totalCount) * 100) : 0;
                  return (
                    <div key={cat} className="stat-row">
                      <div className="stat-row-top">
                        <span>{cat}</span>
                        <span>
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{
                            width: `${pct}%`,
                            background: catColors[cat] || "#38bdf8"
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="stat-card">
                <div className="section-label" style={{ marginTop: 0 }}>
                  Verification &amp; Trust Telemetry
                </div>
                <div className="stat-row">
                  <div className="stat-row-top">
                    <span>Verified / Confirmed Zones</span>
                    <span>
                      {verifiedCount} / {totalCount}
                    </span>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${totalCount ? Math.round((verifiedCount / totalCount) * 100) : 0}%`,
                        background: "#10b981"
                      }}
                    />
                  </div>
                </div>
                <div className="stat-row">
                  <div className="stat-row-top">
                    <span>Auto-Geocoded OSINT Reports</span>
                    <span>{incidents.filter((i) => i.autoGeocoded).length}</span>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${incidents.length ? Math.round((incidents.filter((i) => i.autoGeocoded).length / incidents.length) * 100) : 0}%`,
                        background: "#38bdf8"
                      }}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </aside>

      <div className="map-wrapper">
        <main ref={mapContainerRef} className="map-container" />

        <div className="map-hud-left">
          <select
            defaultValue=""
            onChange={(e) => {
              const selected = landmarks.find((l) => l.name === e.target.value);
              if (selected && mapRef.current) {
                mapRef.current.flyTo([selected.lat, selected.lng], 14);
              }
            }}
          >
            <option value="" disabled>
              Jump to Sector...
            </option>
            {landmarks.map((lm) => (
              <option key={lm.name} value={lm.name}>
                {lm.name}
              </option>
            ))}
          </select>
          <button
            className={`layer-toggle ${layersVisible.verified ? "on" : ""}`}
            onClick={() =>
              setLayersVisible((p) => ({ ...p, verified: !p.verified }))
            }
          >
            Verified
          </button>
          <button
            className={`layer-toggle ${layersVisible.unverified ? "on" : ""}`}
            onClick={() =>
              setLayersVisible((p) => ({ ...p, unverified: !p.unverified }))
            }
          >
            Pending
          </button>
          <button
            className={`layer-toggle ${layersVisible.geofences ? "on" : ""}`}
            onClick={() =>
              setLayersVisible((p) => ({ ...p, geofences: !p.geofences }))
            }
          >
            Geofences
          </button>
        </div>

        <div className="map-hud-top">
          <span
            style={{
              fontFamily: "monospace",
              fontSize: "0.72rem",
              color: "#94a3b8",
              padding: "0.38rem 0.55rem",
              borderRight: "1px solid #1e293b"
            }}
          >
            Z{mapZoom} &bull; {radarPct}%
          </span>
          <button
            className={`hud-btn ${clickMode === "report" ? "active" : ""}`}
            onClick={() => {
              setClickMode("report");
              setReportType("point");
            }}
          >
            Pin
          </button>
          <button
            className={`hud-btn ${clickMode === "draw" ? "active" : ""}`}
            onClick={() => {
              setClickMode("draw");
              setReportType("polygon");
              setActiveTab("report");
            }}
          >
            Zone
          </button>
          <button
            className={`hud-btn ${clickMode === "nav" ? "active" : ""}`}
            onClick={() => {
              setClickMode("nav");
              setActiveTab("nav");
            }}
          >
            A &rarr; B
          </button>
        </div>

        {(clickMode === "draw" || draftPolygon.length > 0) && (
          <div className="draw-toolbar">
            <span style={{ color: "#d8b4fe", fontWeight: 700 }}>
              GEOFENCE: {draftPolygon.length} pt(s)
            </span>
            <button
              className="btn-sm"
              onClick={() => setDraftPolygon((prev) => prev.slice(0, -1))}
              disabled={draftPolygon.length === 0}
            >
              Undo
            </button>
            <button
              className="btn-sm"
              onClick={() => setDraftPolygon([])}
              disabled={draftPolygon.length === 0}
            >
              Clear
            </button>
            <button
              className="btn-sm verify-btn"
              onClick={() => {
                setReportType("polygon");
                setActiveTab("report");
              }}
              disabled={draftPolygon.length < 3}
            >
              Save
            </button>
          </div>
        )}

        <div className="timeline-hud">
          <span style={{ color: "#64748b", marginRight: "0.2rem" }}>
            WINDOW:
          </span>
          {TIME_WINDOWS.map((tw) => (
            <button
              key={tw.id}
              className={`time-pill ${timeWindow === tw.id ? "active" : ""}`}
              onClick={() => setTimeWindow(tw.id)}
            >
              {tw.label}
            </button>
          ))}
          <span className="gps-readout">
            {cursorGps.lat.toFixed(4)}&deg;N, {cursorGps.lng.toFixed(4)}&deg;E
          </span>
        </div>

        <div className="map-legend">
          <div className="legend-item">
            <span
              className="dot"
              style={{ background: "#ff2a55", boxShadow: "0 0 8px #ff2a55" }}
            />
            <span>High Intensity / Geofence</span>
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
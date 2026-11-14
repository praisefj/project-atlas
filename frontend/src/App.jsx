import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

const PH_CENTER = [4.8156, 7.0498];

const SEVERITY_COLORS = {
  High: "#ef4444",
  Medium: "#f59e0b",
  Low: "#10b981"
};

function createPinIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div class="atlas-pin" style="background:${color};"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
}

function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersLayerRef = useRef(null);
  const draftMarkerRef = useRef(null);

  const [online, setOnline] = useState(false);
  const [incidents, setIncidents] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [form, setForm] = useState({
    title: "",
    category: "Flooding",
    severity: "High",
    lat: "4.8156",
    lng: "7.0498",
    notes: ""
  });

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current).setView(PH_CENTER, 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (e) => {
      const lat = e.latlng.lat.toFixed(5);
      const lng = e.latlng.lng.toFixed(5);
      setForm((prev) => ({ ...prev, lat, lng }));

      if (draftMarkerRef.current) {
        draftMarkerRef.current.setLatLng(e.latlng);
      } else {
        draftMarkerRef.current = L.marker(e.latlng, {
          icon: createPinIcon("#38bdf8")
        })
          .addTo(map)
          .bindPopup("Selected coordinates for new report");
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
      fetch("/api/incidents").then((r) => r.json())
    ])
      .then(([health, list]) => {
        setOnline(health.status === "ok");
        setIncidents(list);
      })
      .catch(() => setOnline(false));
  }, []);

  const visibleIncidents =
    categoryFilter === "All"
      ? incidents
      : incidents.filter((item) => item.category === categoryFilter);

  useEffect(() => {
    if (!markersLayerRef.current) return;
    markersLayerRef.current.clearLayers();

    visibleIncidents.forEach((item) => {
      const color = SEVERITY_COLORS[item.severity] || "#3b82f6";
      L.marker([item.lat, item.lng], { icon: createPinIcon(color) })
        .bindPopup(
          `<strong>${item.title}</strong><br/>${item.category} &bull; ${item.severity}<br/><small>${item.notes || ""}</small>`
        )
        .addTo(markersLayerRef.current);
    });
  }, [visibleIncidents]);

  async function handleSubmit(e) {
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
      mapRef.current?.flyTo([created.lat, created.lng], 14);
    }
  }

  async function handleDelete(id) {
    const response = await fetch(`/api/incidents/${id}`, { method: "DELETE" });
    if (response.ok) {
      setIncidents((prev) => prev.filter((item) => item.id !== id));
    }
  }

  return (
    <div className="atlas-layout">
      <aside className="sidebar">
        <div className="header">
          <h1>Project Atlas</h1>
          <span className={`status-badge ${online ? "" : "offline"}`}>
            {online ? "API Online | Port Harcourt Grid" : "API Offline"}
          </span>
        </div>

        <section className="card">
          <h2>Log Field Incident</h2>
          <p className="hint">Click anywhere on the map to auto-fill coordinates.</p>
          <form className="form-grid" onSubmit={handleSubmit}>
            <input
              placeholder="Incident title (e.g., Aba Rd Flood)"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
            <div className="row-2">
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                <option>Flooding</option>
                <option>Road Blockage</option>
                <option>Infrastructure</option>
                <option>Hazard</option>
              </select>
              <select
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
              >
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </select>
            </div>
            <div className="row-2">
              <input
                type="number"
                step="any"
                placeholder="Latitude"
                value={form.lat}
                onChange={(e) => setForm({ ...form, lat: e.target.value })}
                required
              />
              <input
                type="number"
                step="any"
                placeholder="Longitude"
                value={form.lng}
                onChange={(e) => setForm({ ...form, lng: e.target.value })}
                required
              />
            </div>
            <textarea
              rows="2"
              placeholder="Field notes or affected landmarks..."
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
            <button className="primary" type="submit">
              Pin Incident to Atlas
            </button>
          </form>
        </section>

        <section className="card">
          <div className="incident-top" style={{ marginBottom: "0.75rem" }}>
            <h2>Active Reports ({visibleIncidents.length})</h2>
            <select
              style={{ width: "auto" }}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="All">All Categories</option>
              <option value="Flooding">Flooding</option>
              <option value="Road Blockage">Road Blockage</option>
              <option value="Infrastructure">Infrastructure</option>
              <option value="Hazard">Hazard</option>
            </select>
          </div>

          <div className="incident-list">
            {visibleIncidents.map((item) => (
              <div key={item.id} className={`incident-item ${item.severity}`}>
                <div className="incident-top">
                  <span
                    className="incident-title"
                    onClick={() => mapRef.current?.flyTo([item.lat, item.lng], 15)}
                  >
                    {item.title}
                  </span>
                  <button
                    className="delete-btn"
                    title="Remove incident"
                    onClick={() => handleDelete(item.id)}
                  >
                    &times;
                  </button>
                </div>
                <div className="incident-meta">
                  {item.category} &bull; {item.severity} &bull; ({item.lat}, {item.lng})
                </div>
              </div>
            ))}
          </div>
        </section>
      </aside>

      <main ref={mapContainerRef} className="map-container" />
    </div>
  );
}

export default App;
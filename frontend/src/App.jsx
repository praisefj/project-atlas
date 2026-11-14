import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [apiStatus, setApiStatus] = useState("Connecting to backend...");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setApiStatus(`${data.project} (${data.status})`))
      .catch(() => setApiStatus("Backend offline — start server.js on port 5000"));
  }, []);

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Project Atlas</h1>
      <p>
        API Status: <strong>{apiStatus}</strong>
      </p>
    </main>
  );
}

export default App;

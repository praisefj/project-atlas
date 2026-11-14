import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
if (API_BASE) {
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string" && input.startsWith("/api")) {
      return origFetch(`${API_BASE}${input}`, init);
    }
    return origFetch(input, init);
  };
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
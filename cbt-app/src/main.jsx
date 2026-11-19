// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { clearIndexedDbPersistence } from "firebase/firestore";
import { db } from "/firebase";
import "./index.css";

async function bootstrap() {
  // Remove the legacy cache that could contain question answer keys or admin results.
  await clearIndexedDbPersistence(db).catch(() => console.warn("Close older app tabs to finish clearing the legacy database cache."));
  ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
}
void bootstrap();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed", error);
    });
  });
}

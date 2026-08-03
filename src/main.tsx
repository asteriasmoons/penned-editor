import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { applyStoredAppearance } from "./appearance";
import { sendToNative } from "./NativeBridge";
import "./index.css";

window.addEventListener("error", (event) => {
  sendToNative("editorError", {
    message: event.message || "The editor crashed.",
    source: event.filename,
    line: event.lineno,
    column: event.colno,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  sendToNative("editorError", {
    message:
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "The editor hit an unhandled promise rejection.",
  });
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Vellix could not find the root editor element.");
}

applyStoredAppearance();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

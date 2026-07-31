import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { applyStoredAppearance } from "./appearance";
import "./index.css";

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

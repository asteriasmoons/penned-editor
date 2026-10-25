// Presentation only: this never dispatches an editor transaction or touches document JSON.
export function applyEditorAppearance(root, payload = {}) {
  const style = root.style;
  const light = payload.colorScheme === "light";
  const interfaceLight = payload.interfaceScheme === "light";
  root.dataset.pennedDocumentScheme = light ? "light" : "dark";
  root.dataset.pennedInterfaceScheme = interfaceLight ? "light" : "dark";
  style.colorScheme = light ? "light" : "dark";
  for (const [key, value] of Object.entries({
    "--vellix-neutral-rgb": light ? "33,29,41" : "255,255,255",
    "--vellix-secondary-text": light ? "#686171" : "#9b9b9f",
    "--vellix-property-accent": light ? "#7955a0" : "#b59ad9",
    "--vellix-link-color": light ? "#7833bc" : "#8fe9ff",
    "--vellix-table-default-header": light ? "#e7def2" : "#066db0",
    "--vellix-interface-surface": interfaceLight ? "#f5f2f9" : "#242424",
    "--vellix-interface-ink": interfaceLight ? "#211d29" : "#f3f3f3",
    "--vellix-interface-border": interfaceLight ? "#27213026" : "#ffffff1f",
    "--vellix-selection-fill": light ? "#d8c3ef" : "#0d5668",
  })) style.setProperty(key, value);
  if (typeof payload.textColor === "string" && payload.textColor.trim()) {
    style.setProperty("--vellix-primary-text", payload.textColor.trim());
    const hex = payload.textColor.trim().replace("#", "");
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      const rgb = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
      style.setProperty("--vellix-component-selected-text", rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 < 140 ? "#fff" : "#000");
    }
  }
  if (typeof payload.fontFamily === "string" && payload.fontFamily.trim()) style.setProperty("--vellix-font-family", payload.fontFamily.trim());
  if (typeof payload.pageBackground === "string" && payload.pageBackground.trim()) style.setProperty("--vellix-page-background", payload.pageBackground.trim());
}

export const GRID_CARD_DEFAULTS = {
  icon: "sparkle", iconColor: "#ffffff", backgroundColor: "#302d36",
  titleColor: null, textColor: null,
  title: "", alignment: "left", width: "full", height: 100,
};

export function opaqueHex(value, fallback) {
  if (typeof value !== "string") return fallback;
  const hex = value.trim();
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return hex.slice(0, 7);
  if (/^#[0-9a-f]{3,4}$/i.test(hex)) return `#${[...hex.slice(1, 4)].map(c => c + c).join("")}`;
  return fallback;
}

export function gridCardSettings(attrs = {}) {
  const height = Number(attrs.height);
  const iconColor = opaqueHex(attrs.iconColor ?? attrs.color, GRID_CARD_DEFAULTS.iconColor);
  const defaultBackground = attrs.color && gridCardInk(iconColor) === "#ffffff" ? "#e5e3e8" : GRID_CARD_DEFAULTS.backgroundColor;
  return {
    icon: typeof attrs.icon === "string" && attrs.icon.trim() ? attrs.icon.trim() : GRID_CARD_DEFAULTS.icon,
    iconColor,
    backgroundColor: opaqueHex(attrs.backgroundColor, defaultBackground),
    titleColor: opaqueHex(attrs.titleColor, null),
    textColor: opaqueHex(attrs.textColor, null),
    title: typeof attrs.title === "string" ? attrs.title : "",
    alignment: ["left", "center", "right"].includes(attrs.alignment) ? attrs.alignment : "left",
    width: attrs.width === "half" ? "half" : "full",
    height: Number.isFinite(height) ? Math.round(Math.min(1600, Math.max(100, height))) : 100,
  };
}

export function gridCardInk(background) {
  const [r, g, b] = [1, 3, 5].map(index => {
    const channel = Number.parseInt(background.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722 >= 0.179 ? "#000000" : "#ffffff";
}

export function solidCalloutAttributes(background, fallback = GRID_CARD_DEFAULTS.backgroundColor) {
  const color = opaqueHex(background, fallback);
  return `--penned-grid-bg:${color};--penned-grid-ink:${gridCardInk(color)};`;
}

export function gridCardDOMAttributes(attrs) {
  const settings = gridCardSettings(attrs);
  return {
    "data-type": "penned-grid-card",
    "data-grid-width": settings.width,
    "data-grid-alignment": settings.alignment,
    "data-grid-height": settings.height,
    "data-grid-background": settings.backgroundColor,
    "data-grid-title-color": settings.titleColor,
    "data-grid-text-color": settings.textColor,
    style: `--vellix-callout-color:${settings.iconColor};--penned-grid-bg:${settings.backgroundColor};--penned-grid-ink:${settings.textColor ?? gridCardInk(settings.backgroundColor)};--penned-grid-title-ink:${settings.titleColor ?? gridCardInk(settings.backgroundColor)};--penned-grid-height:${settings.height}px;`,
  };
}

export function newGridCard(id, paragraph) {
  return { type: "gridCard", attrs: { id, ...GRID_CARD_DEFAULTS, width: "half",
    iconColor: "#173633", backgroundColor: "#c4e5de", height: 140 }, content: [paragraph] };
}

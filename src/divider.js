export function dividerStyle(value) {
  switch (typeof value === "string" ? value.trim() : "") {
    case "tinyDots": return "dottedCircles";
    case "fourDots": return "fourCircles";
    case "dottedCircles": return "dottedCircles";
    case "fourCircles": return "fourCircles";
    case "thickLine": return "thickLine";
    case "washiTape": return "washiTape";
    default: return "thinLine";
  }
}

export function dividerColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : null;
}

export function washiTapeSize(value) {
  return value === "thin" ? "thin" : "thick";
}

function unsplashURL(value, host) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.host === host && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function dividerPhoto(value) {
  const imageURL = unsplashURL(value?.imageURL, "images.unsplash.com");
  if (!imageURL || typeof value.id !== "string" || !value.id) return null;
  return {
    id: value.id, imageURL,
    thumbURL: unsplashURL(value.thumbURL, "images.unsplash.com") || imageURL,
    photographer: typeof value.photographer === "string" ? value.photographer : "Photographer",
    photographerURL: unsplashURL(value.photographerURL, "unsplash.com") || "https://unsplash.com/?utm_source=vellix&utm_medium=referral",
    sourceURL: unsplashURL(value.sourceURL, "unsplash.com") || "https://unsplash.com/?utm_source=vellix&utm_medium=referral",
  };
}

export function dividerDOM(attrs, imageURL, htmlAttributes = {}) {
  const style = dividerStyle(attrs.style), color = dividerColor(attrs.color);
  const indent = Math.max(0, Math.min(6, Number(attrs.indent) || 0));
  const photo = style === "washiTape" ? dividerPhoto(attrs.remotePhoto) : null;
  const children = style === "washiTape" ? [
    ["span", { class: "vellix-divider-tape", "data-tape-image": imageURL ? "true" : null, "aria-hidden": "true" },
      ...(imageURL ? [["img", { src: imageURL, alt: "", draggable: "false" }]] : [])],
    ...(photo ? [["small", { class: "vellix-divider-credit" }, "Photo by ",
      ["a", { href: photo.photographerURL, target: "_blank", rel: "noopener noreferrer" }, photo.photographer],
      " on ", ["a", { href: photo.sourceURL, target: "_blank", rel: "noopener noreferrer" }, "Unsplash"]]] : []),
  ] : style === "fourCircles" ? [
    ["span", { class: "vellix-divider-four-circles", "aria-hidden": "true" },
      ...Array.from({ length: 4 }, () => ["span", { class: "vellix-divider-circle" }])],
  ] : [["span", { class: style === "dottedCircles" ? "vellix-divider-dots" : "vellix-divider-line", "aria-hidden": "true" }]];
  return ["div", {
    ...htmlAttributes, "data-vellix-divider": "true", "data-divider-style": style,
    "data-tape-size": style === "washiTape" ? washiTapeSize(attrs.tapeSize) : null,
    "data-divider-color": color,
    style: [htmlAttributes.style, color ? `--vellix-divider-color:${color}` : null,
      indent ? `--vellix-divider-indent:${indent * 18}px` : null].filter(Boolean).join(";") || null,
    role: "separator", "aria-label": style === "washiTape" ? "Washi Tape" : null,
  }, ...children];
}

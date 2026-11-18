import { Node, mergeAttributes } from "@tiptap/core";
import { attachmentURL } from "./attachments.js";
import { gridCardSettings, opaqueHex, solidCalloutAttributes } from "./grid-card.js";
import { calloutWidth } from "./callout-layout.js";

export const ICON_CALLOUT_DEFAULTS = {
  icon: "sparkle", iconColor: "#ffffff", backgroundColor: "#302d36", imagePath: null, textColor: null, imageTint: null,
};

export function iconCalloutSettings(attrs = {}) {
  const { icon, iconColor, backgroundColor } = gridCardSettings(attrs);
  const imagePath = typeof attrs.imagePath === "string" && attachmentURL({ relativePath: attrs.imagePath }) ? attrs.imagePath : null;
  return { icon, iconColor, backgroundColor, imagePath,
    textColor: opaqueHex(attrs.textColor, null), imageTint: opaqueHex(attrs.imageTint, null) };
}

export function iconCalloutSurface(settings) {
  return solidCalloutAttributes(settings.backgroundColor) + `--vellix-callout-color:${settings.iconColor};`
    + `--penned-callout-text:${settings.textColor ?? "initial"};`;
}

export function plainCalloutSettings(attrs = {}) {
  const height = Number(attrs.minimumHeight);
  return { color: opaqueHex(attrs.color, "#ffffff"), textColor: opaqueHex(attrs.textColor, null),
    widthPercent: calloutWidth(attrs.widthPercent),
    minimumHeight: Number.isFinite(height) && height > 0 ? Math.round(Math.min(1600, Math.max(44, height))) : null };
}

export function plainCalloutSurface(attrs) {
  const settings = plainCalloutSettings(attrs);
  return iconCalloutSurface({ backgroundColor: settings.color, textColor: settings.textColor, iconColor: "#ffffff" })
    + (settings.minimumHeight ? `--penned-plain-callout-min-height:${settings.minimumHeight}px;` : "");
}

export function iconCalloutImage(src, tint) {
  const image = ["img", { class: "penned-icon-callout-image", src, alt: "", draggable: "false" }];
  if (!tint) return image;
  return ["span", { class: "penned-icon-callout-tint",
    style: `--penned-callout-tint:${tint};--penned-callout-mask:url(${JSON.stringify(src)});`,
  }, image];
}

export function iconCalloutNode({ renderLibraryIcon }) {
  return Node.create({
    name: "iconCallout", group: "block", content: "block+", defining: true, isolating: true,
    addAttributes: () => Object.fromEntries(Object.entries(ICON_CALLOUT_DEFAULTS).map(([key, value]) =>
      [key, { default: value, rendered: false }])),
    parseHTML: () => [{
      tag: "div[data-type='penned-icon-callout']",
      contentElement: element => element.querySelector(":scope > .vellix-callout-text") ?? element,
      getAttrs: element => iconCalloutSettings({
        icon: element.dataset.calloutIcon, iconColor: element.dataset.calloutColor,
        backgroundColor: element.dataset.calloutBackground, imagePath: element.dataset.calloutImage,
        textColor: element.dataset.calloutTextColor, imageTint: element.dataset.calloutImageTint,
      }),
    }],
    renderHTML({ HTMLAttributes, node }) {
      const settings = iconCalloutSettings(node.attrs);
      const { icon, iconColor, backgroundColor, imagePath, textColor, imageTint } = settings;
      return ["div", mergeAttributes(HTMLAttributes, {
        class: "vellix-callout penned-icon-callout", "data-type": "penned-icon-callout",
        "data-callout-icon": icon, "data-callout-color": iconColor, "data-callout-background": backgroundColor,
        "data-callout-image": imagePath, style: iconCalloutSurface(settings),
        "data-callout-text-color": textColor, "data-callout-image-tint": imageTint,
      }), ["button", {
        type: "button", class: "vellix-callout-icon-button", contenteditable: "false",
        "data-vellix-callout-icon-button": "true", "aria-label": "Callout Settings",
      }, imagePath ? iconCalloutImage(attachmentURL({ relativePath: imagePath }), imageTint) : renderLibraryIcon(icon, iconColor)],
      ["div", { class: "vellix-callout-text" }, 0]];
    },
  });
}

import { mergeAttributes } from "@tiptap/core";
import { Heading } from "@tiptap/extension-heading";
import { DOMSerializer, Fragment } from "@tiptap/pm/model";
import { blockFontFamilies } from "./block-font.js";
import { paintLabelPerimeter, measuredLabelShape } from "./scalloped-label.js";

export const LABEL_DEFAULTS = Object.freeze({
  presentation: "text", shape: "rectangular", style: "filled", font: "inherit", alignment: "left",
  textColor: "#281B36", backgroundColor: "#D9C3F1", borderColor: "#9E7EBC", borderThickness: 1, accentColor: "#8966A8",
  iconEnabled: false, icon: "sparkle", iconColor: "#60437D",
});
const families = { ...blockFontFamilies, hachiMaruPop: '"HachiMaruPop", cursive' };
const choices = {
  presentation: ["text", "label"], shape: ["ribbon", "pill", "framed", "rectangular", "scalloped", "plaque", "banner"],
  style: ["filled", "glass", "textured", "outline"], font: ["inherit", ...Object.keys(families)],
  alignment: ["left", "center", "right"],
};
const color = /^#[\da-f]{6}$/i;
// Match LabelGrainPalette in Swift. Change lightness without rotating the hue or
// changing saturation. Keep the dark end close to the chosen fill.
function grainPalette(hex) {
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const low = Math.min(...rgb), high = Math.max(...rgb);
  const lightness = (low + high) / 2;
  const range = Math.min(lightness, 1 - lightness);
  const shade = next => {
    const scale = range ? Math.min(next, 1 - next) / range : 0;
    return "#" + rgb.map(channel => Math.round(255 * (next + (channel - lightness) * scale))
      .toString(16).padStart(2, "0")).join("");
  };
  return [shade(lightness - Math.min(0.026, lightness * 0.075)),
    shade(lightness + Math.min(0.065, (1 - lightness) * 0.13))];
}

const icon = /^(?:sf:)?[\w.+-]{1,120}$/;
const svg = "http://www.w3.org/2000/svg ";
const plaque = [[7, 0], [93, 0], [95, 12], [98, 12], [100, 26], [100, 74], [98, 88], [95, 88],
  [93, 100], [7, 100], [5, 88], [2, 88], [0, 74], [0, 26], [2, 12], [5, 12]];
const plaquePoints = plaque.map(([x, y]) => `${x},${y}`).join(" ");
const plaqueClip = `polygon(${plaque.map(([x, y]) => `${x}% ${y}%`).join(",")})`;
const savedShape = label => label?.style === "plaque" || label?.style === "banner" ? label.style : label?.shape;
export const labelLevel = level => Number.isInteger(level) && level >= 1 && level <= 4;
export function labelSettings(raw) {
  const settings = { ...LABEL_DEFAULTS };
  if (!raw || typeof raw !== "object") return settings;
  for (const key of Object.keys(settings)) {
    const value = raw[key];
    if (choices[key]?.includes(value) || (key === "iconEnabled" && typeof value === "boolean") ||
        (key === "borderThickness" && Number.isInteger(value) && value >= 0 && value <= 6) ||
        (typeof value === "string" && (key === "icon" ? icon.test(value) : key.endsWith("Color") && color.test(value)))) {
      settings[key] = value;
    }
  }
  const shape = savedShape(raw);
  if (choices.shape.includes(shape)) settings.shape = shape;
  return settings;
}

// Retain a dormant configuration in Text mode so switching back is lossless.
export const headingLabelAttribute = {
  default: null,
  keepOnSplit: false,
  rendered: false,
  parseHTML: element => {
    try {
      const raw = element.getAttribute("data-penned-heading-label");
      return raw ? labelSettings(JSON.parse(raw)) : null;
    } catch { return null; }
  },
};

export function createLabelHeading({ iconMask, interactive = false } = {}) {
  const decorative = { "aria-hidden": "true", ...(interactive ? { contenteditable: "false" } : {}) };
  let perimeterObserver;
  return Heading.extend({
    addAttributes() {
      return { ...this.parent?.(), label: headingLabelAttribute };
    },
    parseHTML() {
      // The explicit content hole keeps the decorative icon out of copied text.
      return this.parent?.().map(rule => ({ ...rule, contentElement: element =>
        element.querySelector(":scope > .penned-label-tile > .penned-label-text") ?? element }));
    },
    renderHTML({ node, HTMLAttributes }) {
      const settings = labelSettings(node.attrs.label);
      if (!labelLevel(node.attrs.level) || !node.attrs.label) return this.parent({ node, HTMLAttributes });
      const stored = { "data-penned-heading-label": JSON.stringify(settings) };
      if (settings.presentation !== "label") return this.parent({ node, HTMLAttributes: mergeAttributes(HTMLAttributes, stored) });
      const mask = settings.iconEnabled ? iconMask?.(settings.icon) : null;
      const { shape } = settings;
      const framed = shape === "framed";
      const measured = measuredLabelShape(shape);
      const pathClass = part => `penned-label-path-${part}${shape === "scalloped" ? ` penned-label-scalloped-${part}` : ""}`;
      const properties = [
        `--label-text:${settings.textColor}`, `--label-bg:${settings.backgroundColor}`,
        `--label-border:${settings.borderColor}`, `--label-border-width:${settings.borderThickness}px`, `--label-accent:${settings.accentColor}`,
        `--label-icon:${settings.iconColor}`,
      ];
      if (framed) properties.push(`--label-plaque:${plaqueClip}`);
      const grain = settings.style === "textured";
      if (grain) {
        const [base, flecks] = grainPalette(settings.backgroundColor);
        properties.push(`--label-grain-base:${base}`, `--label-grain-flecks:${flecks}`);
      }
      const material = [
        ...(settings.style === "glass" ? [["span", { class: "penned-label-glass-material", ...decorative }]] : []),
        ...(grain ? [["span", { class: "penned-label-grain", ...decorative }]] : []),
      ];
      if (settings.font !== "inherit") properties.push(`--label-font:${families[settings.font]}`);
      if (mask) properties.push(`--label-mask:${mask}`);
      return [`h${node.attrs.level}`, mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, stored, {
        class: "penned-heading-label", "data-label-shape": shape, "data-label-style": settings.style,
        "data-label-perimeter": measured ? "" : null,
        "data-label-alignment": settings.alignment, style: properties.join(";"),
      }), ["span", { class: "penned-label-tile" },
        ...(measured ? [
          ["span", { class: pathClass("surface"), ...decorative }, ...material],
          [svg + "svg", { class: pathClass("frame"), focusable: "false", ...decorative },
            ["path", { class: pathClass("stroke"), "stroke-linejoin": "round" }]],
        ] : material),
        ...(framed && settings.borderThickness > 0 ? [[svg + "svg", {
          class: "penned-label-frame", viewBox: "0 0 100 100", preserveAspectRatio: "none",
          "aria-hidden": "true", focusable: "false", ...(interactive ? { contenteditable: "false" } : {}),
        }, ["polygon", { points: plaquePoints, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }]]] : []),
        ...(mask ? [["span", { class: "penned-label-icon", ...(interactive ? { contenteditable: "false" } : {}), "aria-hidden": "true" }]] : []),
        ["span", { class: "penned-label-text" }, 0],
      ]];
    },
    addNodeView() {
      if (!interactive) return undefined;
      return ({ node, view }) => {
        const label = node.attrs.label;
        if (!labelLevel(node.attrs.level) || label?.presentation !== "label" || !measuredLabelShape(savedShape(label))) return undefined;
        const document = view.dom.ownerDocument;
        const { dom, contentDOM } = DOMSerializer.renderSpec(document, node.type.spec.toDOM(node));
        const tile = dom.querySelector(".penned-label-tile");
        perimeterObserver ??= new document.defaultView.ResizeObserver(entries => {
          for (const { target } of entries) if (target.isConnected) paintLabelPerimeter(target);
        });
        perimeterObserver.observe(tile, { box: "border-box" });
        return { dom, contentDOM,
          // The observer changes only the decorative clip and stroke, never the editable text.
          ignoreMutation: mutation => mutation.type === "attributes" &&
            mutation.target.matches?.(".penned-label-path-surface, .penned-label-path-stroke"),
          destroy() { perimeterObserver.unobserve(tile); },
        };
      };
    },
  });
}

export function updateHeadingLabel(editor, args, closeHistory) {
  let target;
  editor.state.doc.descendants((node, pos) => {
    if (target) return false;
    if (node.type.name === "heading" && node.attrs.id === args.blockID && labelLevel(node.attrs.level)) {
      target = { node, pos };
      return false;
    }
    return !node.isTextblock;
  });
  if (!target || target.node.attrs.level !== args.level || !args.original || !args.settings) return false;
  const { node, pos } = target, before = labelSettings(node.attrs.label), after = labelSettings(args.settings);
  const currentText = node.textBetween(0, node.content.size, "", "\n");
  const original = labelSettings(args.original);
  const hasTextEdit = typeof args.text === "string" && args.text !== args.originalText;
  if (JSON.stringify(before) !== JSON.stringify(original) && JSON.stringify(before) !== JSON.stringify(after)) return false;
  if (hasTextEdit && currentText !== args.originalText && currentText !== args.text) return false;
  const tr = closeHistory(editor.state.tr);
  if (JSON.stringify(before) !== JSON.stringify(after)) tr.setNodeAttribute(pos, "label", after);
  if (hasTextEdit && currentText !== args.text) {
    const schema = editor.schema, marks = node.firstChild?.marks;
    const content = args.text.split(/\r\n|[\r\n]/).flatMap((line, i) =>
      [...(i ? [schema.nodes.hardBreak.create()] : []), ...(line ? [schema.text(line, marks)] : [])]);
    tr.replaceWith(pos + 1, pos + node.nodeSize - 1, Fragment.fromArray(content));
  }
  if (tr.docChanged) editor.view.dispatch(tr);
  return true;
}

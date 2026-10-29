// Bundle entry for the Vellix TipTap editor.
//
// Same bridge shape as Lurelia:
//   Swift -> JS   window.tiptapCommand(name, args)
//   JS -> Swift   webkit.messageHandlers.tiptap.postMessage({ kind, payload })

import { Editor, Extension, Node, getRenderedAttributes, mergeAttributes } from "@tiptap/core";
import { AllSelection, NodeSelection, Plugin, PluginKey, TextSelection, Selection, SelectionRange } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DOMSerializer, Fragment, Slice } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { keydownHandler } from "@tiptap/pm/keymap";
import { closeHistory } from "@tiptap/pm/history";
import { createTextColor, textColorDependencies } from "./text-color.js";
import StarterKit from "@tiptap/starter-kit";
import Blockquote from "@tiptap/extension-blockquote";
import Code from "@tiptap/extension-code";
import Placeholder from "@tiptap/extension-placeholder";
import { createTemplateComponents } from "./template-components.js";
import { createDocumentTags, taggedInlineContent } from "./document-tags.js";
import { createAttachments, containsAttachments } from "./attachments.js";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { PROPERTY_KINDS, normalizeProperty, propertyText } from "./inline-properties.js";
import { inlinePropertyNode } from "./inline-property-node.js";
import { createCaretTracking } from "./caret-tracking.js";
import { unwrapRetiredColumns } from "./retired-column-content.js";
import { createChecklistItem, createTaskIntegration, taskCommand } from "./document-tasks.js";
import { pageReferenceNode, setPageReferences, normalizePageReferenceStarters } from "./page-reference-node.js";
import { collectionNode, setCollections, setNativeCollectionHeight, iconAssetCSSVariable } from "./collection-node.js";
import { nativeCollectionRegions } from "./native-collection-regions.js";
import { prepareDocumentPresentation } from "./presentation-ready.js";
import { applyEditorAppearance } from "./appearance.js";
import { createBlockActions } from "./block-actions.js";
import { Caption } from "./caption.js";
import "./structured-placeholders.js";
import "./vendor/table-library.js";
import "./table-formulas.js";
import "./vellix-tables.js";

const DEFAULT_CALLOUT_ICON = "sparkle";
const DEFAULT_CALLOUT_COLOR = "#ffffff";
const DEFAULT_BLOCKQUOTE_COLOR = "#ffffff";
const DEFAULT_DIVIDER_STYLE = "thinLine";
const CHECKLIST_DOUBLE_TAP_MS = 300;
const DIVIDER_STYLES = {
  dottedCircles: {
    title: "Dotted Circles",
    detail: "Circle dot divider",
    icon: "listcircle",
  },
  thickLine: {
    title: "Thick Line",
    detail: "Bold rounded divider",
    icon: "minuswavy",
  },
  thinLine: {
    title: "Thin Line",
    detail: "Minimal divider",
    icon: "minuswavy",
  },
  fourCircles: {
    title: "Four Circles",
    detail: "Centered circle divider",
    icon: "listcircle",
  },
};
const vellixIconAssets = new Map();
const selectionHighlightPluginKey = new PluginKey("vellixTextSelectionHighlight");
const UnderlineableCode = Code.extend({
  excludes: "",
});
const SLASH_ITEMS = [
  { key: "collection", title: "Collection", detail: "Document Table and Gallery views", icon: "linedpages" },
  { key: "table", title: "Table", detail: "Rows, columns and formulas", icon: "blackcal" },
  { key: "heading1", title: "Title", detail: "H1, 24px", icon: "h1" },
  { key: "heading2", title: "Subtitle", detail: "H2, 21px", icon: "h2" },
  { key: "heading3", title: "Heading", detail: "H3, 18px", icon: "h3" },
  { key: "heading4", title: "Subheading", detail: "H4, 16px", icon: "h4" },
  { key: "paragraph", title: "Paragraph", detail: "Plain text", icon: "linedpages" },
  { key: "caption", title: "Caption", detail: "Smaller supporting text", icon: "linedpages" },
  { key: "nestedPage", title: "Page", detail: "A page inside this document", icon: "linedpages" },
  { key: "pageCard", title: "Card", detail: "A page with a custom card preview", icon: "linedpages" },
  { key: "toggleListItem", title: "Toggle", detail: "Collapsible block", icon: "chevright" },
  { key: "callout", title: "Callout with Icon", detail: "Highlighted note with an icon", icon: "sparkle" },
  { key: "plainCallout", title: "Callout without Icon", detail: "Highlighted text without an icon", icon: "linedpages" },
  { key: "quote", title: "Blockquote", detail: "Quoted text", icon: "quote" },
  { key: "checkListItem", title: "Checklist", detail: "Hollow circle tasks", icon: "checkwavy" },
  { key: "bulletListItem", title: "Bullet List", detail: "Bulleted items", icon: "listcircle" },
  { key: "numberedListItem", title: "Numbered List", detail: "Ordered items", icon: "numcal" },
  { key: "underline", title: "Underline", detail: "Underlined text", icon: "linesbmark" },
  { key: "inlineCode", title: "Inline Code", detail: "Inline code text", icon: "codewindow" },
  { key: "pageBreak", title: "Page Break", detail: "Page boundary", icon: "pagefold" },
  ...PROPERTY_KINDS.map(({ kind, title, icon }) => ({
    key: `property:${kind}`, title: `${title} Property`, detail: "Named property row", icon,
  })),
  ...Object.entries(DIVIDER_STYLES).map(([style, item]) => ({
    key: `divider:${style}`,
    title: item.title,
    detail: item.detail,
    icon: item.icon,
  })),
];

function postToSwift(kind, payload = {}) {
  try {
    window.webkit?.messageHandlers?.tiptap?.postMessage({ kind, payload });
  } catch (_e) {
    console.log("[Vellix TipTap]", kind, payload);
  }
}

function traceDiag(label, details = {}) {
  const message = JSON.stringify({ label, ...details });
  console.log(`[Vellix TipTap TRACE] ${message}`);
  postToSwift("diag", { message });
}

function id() {
  return crypto.randomUUID();
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nodeId(node) {
  const value = node?.attrs?.id;
  return typeof value === "string" && value.trim() ? value.trim() : id();
}

function normalizedIconName(icon) {
  return String(icon || DEFAULT_CALLOUT_ICON).trim() || DEFAULT_CALLOUT_ICON;
}

function normalizedDividerStyle(style) {
  const cleanStyle = String(style || "").trim();
  switch (cleanStyle) {
    case "dottedCircles":
    case "tinyDots":
      return "dottedCircles";
    case "fourCircles":
    case "fourDots":
      return "fourCircles";
    case "thickLine":
      return "thickLine";
    case "thinLine":
      return "thinLine";
    default:
      return DEFAULT_DIVIDER_STYLE;
  }
}

function iconSource(icon, tint = DEFAULT_CALLOUT_COLOR, size = 22) {
  const cleanIcon = normalizedIconName(icon);
  const cleanTint = String(tint || DEFAULT_CALLOUT_COLOR).trim();
  const registeredSource = vellixIconAssets.get(cleanIcon);
  if (registeredSource && cleanTint.toLowerCase() === DEFAULT_CALLOUT_COLOR.toLowerCase()) {
    return registeredSource;
  }

  const params = new URLSearchParams({
    tint: cleanTint,
    size: String(size),
  });
  return `vellix-icon://asset/${encodeURIComponent(cleanIcon)}?${params.toString()}`;
}

function setRegisteredIconCSSVariable(icon, src) {
  const variableName = iconAssetCSSVariable(normalizedIconName(icon));
  document.documentElement.style.setProperty(variableName, cssBackgroundImageSource(src));
}

function cssBackgroundImageSource(src) {
  return `url("${String(src || "").replace(/["\\\n\r]/g, "")}")`;
}

let calloutIconProbeSerial = 0;
const calloutIconSerials = new WeakMap();

function serialForElement(element) {
  if (!element) return null;
  if (!calloutIconSerials.has(element)) {
    calloutIconProbeSerial += 1;
    calloutIconSerials.set(element, calloutIconProbeSerial);
  }
  return calloutIconSerials.get(element);
}

function rectSnapshot(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    x: Number(rect.x.toFixed(2)),
    y: Number(rect.y.toFixed(2)),
    width: Number(rect.width.toFixed(2)),
    height: Number(rect.height.toFixed(2)),
    top: Number(rect.top.toFixed(2)),
    left: Number(rect.left.toFixed(2)),
    right: Number(rect.right.toFixed(2)),
    bottom: Number(rect.bottom.toFixed(2)),
    isConnected: element.isConnected,
    hidden: element.hidden === true,
    clientWidth: element.clientWidth ?? null,
    clientHeight: element.clientHeight ?? null,
    offsetWidth: element.offsetWidth ?? null,
    offsetHeight: element.offsetHeight ?? null,
    naturalWidth: element.naturalWidth ?? null,
    naturalHeight: element.naturalHeight ?? null,
  };
}

function styleSnapshot(element) {
  if (!element) return null;
  const style = window.getComputedStyle(element);
  return {
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    width: style.width,
    height: style.height,
    minWidth: style.minWidth,
    minHeight: style.minHeight,
    maxWidth: style.maxWidth,
    maxHeight: style.maxHeight,
    objectFit: style.objectFit,
    objectPosition: style.objectPosition,
    filter: style.filter,
    transform: style.transform,
    mixBlendMode: style.mixBlendMode,
    clipPath: style.clipPath,
    maskImage: style.maskImage,
    webkitMaskImage: style.webkitMaskImage,
    overflow: style.overflow,
    position: style.position,
    pointerEvents: style.pointerEvents,
  };
}

function canvasPixelStats(img) {
  try {
    const renderedWidth = Math.round(img.getBoundingClientRect().width || img.clientWidth || img.width || 22);
    const renderedHeight = Math.round(img.getBoundingClientRect().height || img.clientHeight || img.height || 22);
    const width = Math.max(1, Math.min(96, renderedWidth));
    const height = Math.max(1, Math.min(96, renderedHeight));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return { error: "no-2d-context", width, height };

    context.clearRect(0, 0, width, height);
    context.drawImage(img, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    let nonZeroAlpha = 0;
    let strongAlpha = 0;
    let nonWhite = 0;
    let minAlpha = 255;
    let maxAlpha = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      if (alpha > 0) nonZeroAlpha += 1;
      if (alpha > 8) strongAlpha += 1;
      if (alpha > 8 && (red < 245 || green < 245 || blue < 245)) nonWhite += 1;
      minAlpha = Math.min(minAlpha, alpha);
      maxAlpha = Math.max(maxAlpha, alpha);
    }

    return {
      width,
      height,
      nonZeroAlpha,
      strongAlpha,
      nonWhite,
      minAlpha,
      maxAlpha,
    };
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}

function traceCalloutImageState(label, callout, img, extra = {}) {
  const button = img?.closest?.(".vellix-callout-icon-button") ?? null;
  const isImageElement = img instanceof HTMLImageElement;
  traceDiag(label, {
    id: callout?.dataset?.vellixBlockId || null,
    icon: callout?.dataset?.calloutIcon || null,
    color: callout?.dataset?.calloutColor || null,
    imageSerial: serialForElement(img),
    buttonSerial: serialForElement(button),
    calloutSerial: serialForElement(callout),
    imageAlt: img?.alt || img?.getAttribute?.("aria-label") || null,
    imageSrcAttr: img?.getAttribute?.("src") || null,
    imageSrc: img?.src || null,
    imageCurrentSrc: img?.currentSrc || null,
    imageBackgroundImage: img?.style?.backgroundImage || null,
    imageComplete: isImageElement ? img.complete : null,
    imageHidden: img?.hidden ?? null,
    imageRect: rectSnapshot(img),
    imageStyle: styleSnapshot(img),
    buttonRect: rectSnapshot(button),
    buttonStyle: styleSnapshot(button),
    calloutRect: rectSnapshot(callout),
    calloutStyle: styleSnapshot(callout),
    canvas: isImageElement && img.complete ? canvasPixelStats(img) : { skipped: isImageElement ? "image-not-complete" : "background-element" },
    text: callout?.textContent?.trim() ?? "",
    ...extra,
  });
}

function scheduleCalloutImageStateProbes(callout, img, sourceLabel) {
  traceCalloutImageState("callout-dom-icon-probe", callout, img, { phase: `${sourceLabel}:immediate` });
  requestAnimationFrame(() => {
    traceCalloutImageState("callout-dom-icon-probe", callout, img, { phase: `${sourceLabel}:raf1` });
    requestAnimationFrame(() => {
      traceCalloutImageState("callout-dom-icon-probe", callout, img, { phase: `${sourceLabel}:raf2` });
    });
  });
  window.setTimeout(() => {
    traceCalloutImageState("callout-dom-icon-probe", callout, img, { phase: `${sourceLabel}:100ms` });
  }, 100);
  window.setTimeout(() => {
    traceCalloutImageState("callout-dom-icon-probe", callout, img, { phase: `${sourceLabel}:500ms` });
  }, 500);
}

function text(value) {
  return { type: "text", text: String(value || "") };
}

function paragraph(content = [], attrs = {}) {
  return { type: "paragraph", attrs: { id: id(), ...attrs }, content };
}

function inlineContent(value) {
  if (typeof value === "string") {
    return value.trim() ? [text(value)] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (item.type === "text") return [text(item.text || "")];
    if (typeof item.text === "string") return [text(item.text)];
    if (typeof item.content === "string") return [text(item.content)];
    return [];
  });
}

function plainText(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(plainText).filter(Boolean).join(" ");
  if (!isRecord(node)) return "";
  if (node.type === "inlineTag") return "#" + (node.attrs?.name ?? "");
  if (node.type === "inlineProperty") return propertyText(node.attrs?.property);
  if (node.type === "attachment") return typeof node.attrs?.file?.name === "string" ? node.attrs.file.name : "";
  const own = typeof node.text === "string" ? node.text : "";
  const content = plainText(node.content);
  const children = plainText(node.children);
  return [own, content, children].filter(Boolean).join(" ");
}

function calloutTraceRecords(source) {
  const records = [];
  const visit = (nodes, path = []) => {
    nodes?.forEach((node, index) => {
      if (!isRecord(node)) return;
      const nextPath = [...path, index];
      if (node.type === "callout") {
        records.push({
          path: nextPath.join("."),
          id: node.attrs?.id ?? null,
          icon: node.attrs?.icon ?? null,
          color: node.attrs?.color ?? null,
          text: plainText(node),
          attrs: node.attrs ?? {},
        });
      }
      visit(node.content, nextPath);
    });
  };

  const documentJSON = source?.type === "doc" ? source : normalizeTipTapDocument(source);
  visit(documentJSON.content ?? []);
  return records;
}

function traceCalloutAttrs(label, source, extra = {}) {
  traceDiag(label, {
    callouts: calloutTraceRecords(source),
    ...extra,
  });
}

function normalizeTipTapNode(value) {
  if (!isRecord(value)) {
    return paragraph();
  }

  if (value.type === "doc") {
    return normalizeTipTapDocument(value);
  }

  const type = typeof value.type === "string" ? value.type : "paragraph";
  if (type === "text") {
    const textNode = { type: "text", text: typeof value.text === "string" ? value.text : "" };
    if (Array.isArray(value.marks)) {
      const marks = value.marks
        .filter((mark) => isRecord(mark) && typeof mark.type === "string" && mark.type.trim())
        .map((mark) => {
          const normalizedMark = { type: mark.type.trim() };
          if (isRecord(mark.attrs)) normalizedMark.attrs = { ...mark.attrs };
          return normalizedMark;
        });
      if (marks.length) textNode.marks = marks;
    }
    return textNode;
  }

  const attrs = isRecord(value.attrs) ? { ...value.attrs } : {};
  attrs.id = typeof attrs.id === "string" && attrs.id.trim() ? attrs.id.trim() : id();
  if (type === "inlineProperty") attrs.property = normalizeProperty(attrs.property);

  if (type === "callout") {
    attrs.icon =
      typeof attrs.icon === "string" && attrs.icon.trim()
        ? attrs.icon.trim()
        : DEFAULT_CALLOUT_ICON;
    attrs.color =
      typeof attrs.color === "string" && attrs.color.trim()
        ? attrs.color.trim()
        : DEFAULT_CALLOUT_COLOR;
  }

  if (type === "taskItem") {
    attrs.checked = attrs.checked === true;
    attrs.crossed = attrs.crossed === true;
    if (attrs.crossed) attrs.checked = false;
  }

  if (type === "plainCallout") {
    delete attrs.icon;
    attrs.color = typeof attrs.color === "string" && attrs.color.trim() ? attrs.color.trim() : DEFAULT_CALLOUT_COLOR;
  }

  let content = Array.isArray(value.content)
    ? value.content.map(normalizeTipTapNode).filter((node) => node.type !== "doc")
    : undefined;

  if (type === "callout" || type === "plainCallout") {
    const hasBlockContent = content?.some((node) => node.type !== "text" && node.type !== "hardBreak") ?? false;
    content = hasBlockContent ? content : [paragraph(content ?? [])];
  }

  const normalized = content ? { type, attrs, content } : { type, attrs };
  if (type === "inlineTag" && Array.isArray(value.marks)) normalized.marks = value.marks;
  return normalized;
}

function hoistPageBreaks(nodes) {
  return nodes.flatMap((node) => {
    if (node.type === "pageBreak" || !Array.isArray(node.content)) {
      return [node];
    }

    const content = hoistPageBreaks(node.content);
    if (!content.some((child) => child.type === "pageBreak")) {
      return [{ ...node, content }];
    }

    const result = [];
    let chunk = [];
    let chunkIndex = 0;
    const appendChunk = () => {
      if (!chunk.length) return;
      const attrs = {
        ...(node.attrs || {}),
        ...(chunkIndex > 0 ? { id: id() } : {}),
      };
      result.push({ ...node, attrs, content: chunk });
      chunk = [];
      chunkIndex += 1;
    };

    content.forEach((child) => {
      if (child.type === "pageBreak") {
        appendChunk();
        result.push(child);
      } else {
        chunk.push(child);
      }
    });
    appendChunk();
    return result;
  });
}

function normalizedDocumentContent(content) {
  const hoisted = hoistPageBreaks(unwrapRetiredColumns(content));
  const cleaned = hoisted.filter((node, index) => {
    if (node.type !== "blockquote" || plainText(node).trim() || node.attrs?.color) return true;
    return !(
      hoisted[index - 1]?.type === "pageBreak" ||
      hoisted[index + 1]?.type === "pageBreak"
    );
  });
  const result = [];

  cleaned.forEach((node, index) => {
    result.push(node);
    if (
      node.type === "pageBreak" &&
      (!cleaned[index + 1] || cleaned[index + 1].type === "pageBreak")
    ) {
      result.push(paragraph());
    }
  });

  return result.length ? result : [paragraph()];
}

function importLegacyBlock(value) {
  if (!isRecord(value)) {
    return paragraph();
  }

  const blockID = typeof value.id === "string" && value.id.trim() ? value.id.trim() : id();
  const props = isRecord(value.props) ? value.props : {};
  const children = Array.isArray(value.children) ? value.children.map(importLegacyBlock) : [];
  const content = inlineContent(value.content);

  switch (value.type) {
    case "heading":
      return {
        type: "heading",
        attrs: { id: blockID, level: typeof props.level === "number" ? props.level : 1 },
        content,
      };
    case "bulletListItem":
      return {
        type: "bulletList",
        attrs: { id: blockID },
        content: [{ type: "listItem", attrs: { id: id() }, content: [paragraph(content)] }],
      };
    case "numberedListItem":
      return {
        type: "orderedList",
        attrs: { id: blockID },
        content: [{ type: "listItem", attrs: { id: id() }, content: [paragraph(content)] }],
      };
    case "checkListItem":
      return {
        type: "taskList",
        attrs: { id: blockID },
        content: [
          {
            type: "taskItem",
            attrs: {
              id: id(),
              checked: props.checked === true && props.crossed !== true,
              crossed: props.crossed === true,
            },
            content: [paragraph(content)],
          },
        ],
      };
    case "quote":
      return { type: "blockquote", attrs: { id: blockID }, content: [paragraph(content)] };
    case "plainCallout":
      return {
        type: "plainCallout",
        attrs: { id: blockID, color: props.color || DEFAULT_CALLOUT_COLOR },
        content: [paragraph(content)],
      };
    case "callout":
      return {
        type: "callout",
        attrs: {
          id: blockID,
          icon:
            typeof props.icon === "string" && props.icon.trim()
              ? props.icon.trim()
              : DEFAULT_CALLOUT_ICON,
          color:
            typeof props.color === "string" && props.color.trim()
              ? props.color.trim()
              : DEFAULT_CALLOUT_COLOR,
        },
        content: [paragraph(content)],
      };
    case "divider":
      return {
        type: "divider",
        attrs: { id: blockID, style: normalizedDividerStyle(props.style) },
      };
    case "pageBreak":
      return { type: "pageBreak", attrs: { id: blockID } };
    case "toggleListItem":
      return {
        type: "toggleItem",
        attrs: { id: blockID, open: true },
        content: [paragraph(content), ...children],
      };
    default:
      return paragraph(content, { id: blockID });
  }
}

function normalizeTipTapDocument(value) {
  if (isRecord(value)) {
    if (value.document) {
      return normalizeTipTapDocument(value.document);
    }

    if (value.type === "doc") {
      const content = Array.isArray(value.content)
        ? value.content.map(normalizeTipTapNode).filter((node) => node.type !== "doc")
        : [];
      return { type: "doc", ...(value.attrs?.taskHistoryProjection ? { attrs: { taskHistoryProjection: value.attrs.taskHistoryProjection } } : {}), content: normalizedDocumentContent(content) };
    }

    if (Array.isArray(value.blocks)) {
      return { type: "doc", content: normalizedDocumentContent(value.blocks.map(importLegacyBlock)) };
    }

    if (Array.isArray(value.content)) {
      const content = value.content.map(normalizeTipTapNode).filter((node) => node.type !== "doc");
      return { type: "doc", content: normalizedDocumentContent(content) };
    }
  }

  if (Array.isArray(value)) {
    return { type: "doc", content: normalizedDocumentContent(value.map(importLegacyBlock)) };
  }

  return { type: "doc", content: [paragraph()] };
}

function normalizeLoadedTipTapDocument(value) {
  const documentJSON = normalizeTipTapDocument(value);
  let content = documentJSON.content.filter(
    (node) => node.type !== "blockquote" || plainText(node).trim() || node.attrs?.color,
  );
  content = normalizePageReferenceStarters(content);
  const lastNode = content[content.length - 1];
  const previousNode = content[content.length - 2];
  if (
    content.length > 1 &&
    lastNode?.type === "paragraph" &&
    !plainText(lastNode).trim() &&
    previousNode?.type !== "paragraph" &&
    previousNode?.type !== "templateComponent" &&
    previousNode?.type !== "attachment" &&
    previousNode?.type !== "pageBreak"
  ) {
    content = content.slice(0, -1);
  }
  return {
    ...documentJSON,
    content: normalizedDocumentContent(content),
  };
}

function documentBlocks(source) {
  const flattened = [];
  const visit = (nodes) => {
    nodes?.forEach((node) => {
      if (node.type !== "text") flattened.push(node);
      visit(node.content);
    });
  };
  visit(normalizeTipTapDocument(source).content);
  return flattened;
}

function topLevelDocumentBlocks(source) {
  return normalizeTipTapDocument(source).content.filter((node) => node.type !== "text");
}

function topLevelSelectableBlocks(source) {
  const blocks = topLevelDocumentBlocks(source);
  const isEmptyParagraph = (node) =>
    node?.type === "paragraph" && !plainText(node).trim();
  return (
    blocks.length && isEmptyParagraph(blocks[blocks.length - 1])
      ? blocks.slice(0, -1)
      : blocks
  );
}

function statistics(document) {
  const compact = plainText(document)
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
  return {
    wordCount: compact ? compact.split(/\s+/).length : 0,
    characterCount: compact.length,
  };
}

function renderIconElement(iconElement, icon, color = DEFAULT_CALLOUT_COLOR, size = 22) {
  const normalizedIcon = normalizedIconName(icon);
  const src = iconSource(normalizedIcon, color, size);
  // No-op DOM writes can invalidate the callout while its text is being composed.
  if (iconElement.getAttribute("role") !== "img") iconElement.setAttribute("role", "img");
  if (iconElement.getAttribute("aria-label") !== normalizedIcon) iconElement.setAttribute("aria-label", normalizedIcon);
  const backgroundImage = cssBackgroundImageSource(src);
  if (iconElement.style.backgroundImage !== backgroundImage) iconElement.style.backgroundImage = backgroundImage;
  if (iconElement.hidden) iconElement.hidden = false;
  return { icon: normalizedIcon, src };
}

function renderCalloutIcons(root = document) {
  root.querySelectorAll?.(".vellix-callout").forEach((callout) => {
    const icon = callout.dataset.calloutIcon || DEFAULT_CALLOUT_ICON;
    const color = callout.dataset.calloutColor || DEFAULT_CALLOUT_COLOR;
    const iconElement = callout.querySelector(".vellix-callout-icon-image");
    if (!iconElement) return;
    const src = iconSource(icon, color, 22);
    traceCalloutImageState("callout-dom-icon-before-src", callout, iconElement, {
      nextSrc: src,
      previousSrc: iconElement.getAttribute("src") || iconElement.style.backgroundImage || null,
    });
    renderIconElement(iconElement, icon, color, 22);
    traceDiag("callout-dom-icon-mounted", {
      id: callout.dataset.vellixBlockId || null,
      icon,
      color,
      imageAlt: iconElement.getAttribute("aria-label") || null,
      imageSrc: src,
      text: callout.textContent?.trim() ?? "",
    });
    traceCalloutImageState("callout-dom-icon-mounted-state", callout, iconElement, { src });
    scheduleCalloutImageStateProbes(callout, iconElement, "mounted");
  });
}

function applyAppearance(payload = {}) {
  applyEditorAppearance(document.documentElement, payload);
}

const BlockID = Extension.create({
  name: "vellixBlockID",
  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "caption",
          "heading",
          "codeBlock",
          "blockquote",
          "bulletList",
          "orderedList",
          "listItem",
          "taskList",
          "taskItem",
          "callout",
          "plainCallout",
          "templateComponent",
          "attachment",
          "divider",
          "pageBreak",
          "toggleItem",
          "inlineProperty",
          "pageReference",
          "collection",
        ],
        attributes: {
          id: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute("data-vellix-block-id"),
            renderHTML: (attrs) =>
              typeof attrs.id === "string" && attrs.id.trim()
                ? { "data-vellix-block-id": attrs.id }
                : {},
          },
          textAlign: {
            default: null,
            parseHTML: (element) => element.style.textAlign || null,
            renderHTML: (attrs) => {
              const value = typeof attrs.textAlign === "string" ? attrs.textAlign.trim() : "";
              return value ? { "data-vellix-align": value } : {};
            },
          },
          indent: {
            default: 0,
            parseHTML: (element) => Number(element.getAttribute("data-vellix-indent")) || 0,
            renderHTML: (attrs) => {
              const value = Math.max(0, Math.min(6, Number(attrs.indent) || 0));
              return value
                ? { "data-vellix-indent": String(value) }
                : {};
            },
          },
        },
      },
    ];
  },
});

const VellixTaskItem = createChecklistItem(TaskItem, {
  post: postToSwift, selectionActive: () => selectionMode !== "off",
  reportHeight: () => requestAnimationFrame(reportContentHeight), nodeID: nodeId, iconSource,
});

const VellixBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      color: {
        default: DEFAULT_BLOCKQUOTE_COLOR,
        parseHTML: (element) => element.getAttribute("data-blockquote-color") || DEFAULT_BLOCKQUOTE_COLOR,
        renderHTML: (attrs) => ({
          "data-blockquote-color": attrs.color || DEFAULT_BLOCKQUOTE_COLOR,
          style: `--vellix-blockquote-color:${attrs.color || DEFAULT_BLOCKQUOTE_COLOR};`,
        }),
      },
    };
  },
  addNodeView() {
    return ({ editor: nodeEditor, node }) => {
      const dom = document.createElement("blockquote");
      const button = document.createElement("button");
      const contentDOM = document.createElement("div");
      let currentNode = node;
      let renderedKeys = [];
      const render = () => {
        const attributes = mergeAttributes(
          this.options.HTMLAttributes,
          getRenderedAttributes(currentNode, nodeEditor.extensionManager.attributes),
        );
        for (const key of renderedKeys) {
          if (!(key in attributes)) dom.removeAttribute(key);
        }
        for (const [key, value] of Object.entries(attributes)) {
          if (value != null) dom.setAttribute(key, value);
        }
        renderedKeys = Object.keys(attributes);
        const color = currentNode.attrs.color || DEFAULT_BLOCKQUOTE_COLOR;
        dom.dataset.vellixBlockId = nodeId(currentNode);
        dom.dataset.blockquoteColor = color;
        dom.style.setProperty("--vellix-blockquote-color", color);
      };
      button.type = "button";
      button.className = "vellix-blockquote-color-button";
      button.contentEditable = "false";
      button.setAttribute("aria-label", "Change blockquote color");
      contentDOM.className = "vellix-blockquote-content";
      dom.append(button, contentDOM);

      const preventFocus = (event) => {
        if (selectionMode !== "off") return;
        event.preventDefault();
        event.stopPropagation();
      };
      const requestColor = (event) => {
        if (selectionMode !== "off") return;
        event.preventDefault();
        event.stopPropagation();
        postToSwift("blockquoteColorPickerRequest", {
          blockId: nodeId(currentNode),
          currentColor: currentNode.attrs.color || DEFAULT_BLOCKQUOTE_COLOR,
        });
      };
      button.addEventListener("pointerdown", preventFocus);
      button.addEventListener("mousedown", preventFocus);
      button.addEventListener("touchstart", preventFocus, { passive: false });
      button.addEventListener("touchend", requestColor, { passive: false });
      button.addEventListener("click", requestColor);
      render();
      return {
        dom,
        contentDOM,
        update(updatedNode) {
          if (updatedNode.type.name !== "blockquote") return false;
          currentNode = updatedNode;
          render();
          return true;
        },
        stopEvent(event) {
          return selectionMode === "off" && button.contains(event.target);
        },
        ignoreMutation(mutation) {
          return (mutation.type === "attributes" && mutation.target === dom) || button.contains(mutation.target);
        },
        destroy() {
          button.removeEventListener("pointerdown", preventFocus);
          button.removeEventListener("mousedown", preventFocus);
          button.removeEventListener("touchstart", preventFocus);
          button.removeEventListener("touchend", requestColor);
          button.removeEventListener("click", requestColor);
        },
      };
    };
  },
});

const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      id: { default: null },
      icon: {
        default: DEFAULT_CALLOUT_ICON,
        parseHTML: (element) => element.getAttribute("data-callout-icon") || DEFAULT_CALLOUT_ICON,
        renderHTML: (attrs) => ({ "data-callout-icon": attrs.icon || DEFAULT_CALLOUT_ICON }),
      },
      color: {
        default: DEFAULT_CALLOUT_COLOR,
        parseHTML: (element) => element.getAttribute("data-callout-color") || DEFAULT_CALLOUT_COLOR,
        renderHTML: (attrs) => ({ "data-callout-color": attrs.color || DEFAULT_CALLOUT_COLOR }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-type='vellix-callout']" }, { tag: "div.vellix-callout" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    const icon = node.attrs.icon || DEFAULT_CALLOUT_ICON;
    const color = node.attrs.color || DEFAULT_CALLOUT_COLOR;
    traceDiag("callout-renderHTML", {
      id: node.attrs.id || null,
      icon: node.attrs.icon ?? null,
      renderedIcon: icon,
      color: node.attrs.color ?? null,
      renderedColor: color,
      attrs: node.attrs,
      text: plainText(node.toJSON?.() ?? {}),
    });
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "vellix-callout",
        class: "vellix-callout",
        "data-callout-icon": icon,
        "data-callout-color": color,
        style: `--vellix-callout-color:${color};`,
      }),
      [
        "button",
        {
          type: "button",
          class: "vellix-callout-icon-button",
          contenteditable: "false",
          "data-vellix-callout-icon-button": "true",
          "aria-label": "Change callout icon",
        },
        [
          "span",
          {
            class: "vellix-callout-icon-image",
            role: "img",
            "aria-label": icon,
            style: `background-image:${cssBackgroundImageSource(iconSource(icon, color, 22))};`,
          },
        ],
      ],
      ["div", { class: "vellix-callout-text" }, 0],
    ];
  },
  addCommands() {
    return {
      insertVellixCallout:
        (attrs = {}) =>
        ({ commands, state }) => {
          const calloutText = String(attrs.text || "").trim();
          return commands.insertContentAt(
            state.selection instanceof NodeSelection && state.selection.node.type.name === "inlineProperty"
              ? state.selection.to
              : { from: state.selection.from, to: state.selection.to },
            {
              type: "callout",
              attrs: {
                id: id(),
                icon: attrs.icon || DEFAULT_CALLOUT_ICON,
                color: attrs.color || DEFAULT_CALLOUT_COLOR,
              },
              content: [paragraph(inlineContent(calloutText))],
            },
            { updateSelection: true },
          );
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name !== "callout") continue;

          const afterCallout = $from.after(depth);
          return editor
            .chain()
            .focus()
            .insertContentAt(afterCallout, paragraph(), { updateSelection: false })
            .setTextSelection(afterCallout + 1)
            .run();
        }

        return false;
      },
    };
  },
});

const PlainCallout = Node.create({
  name: "plainCallout",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      id: { default: null },
      color: {
        default: DEFAULT_CALLOUT_COLOR,
        parseHTML: (element) => element.getAttribute("data-callout-color") || DEFAULT_CALLOUT_COLOR,
        renderHTML: (attrs) => ({ "data-callout-color": attrs.color || DEFAULT_CALLOUT_COLOR }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-type='vellix-plain-callout']" }, { tag: "div.vellix-plain-callout" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    const color = node.attrs.color || DEFAULT_CALLOUT_COLOR;
    return ["div", mergeAttributes(HTMLAttributes, {
      "data-type": "vellix-plain-callout", class: "vellix-plain-callout",
      "data-callout-color": color, style: `--vellix-callout-color:${color};`,
    }), ["button", {
      type: "button", class: "vellix-plain-callout-color-button", contenteditable: "false",
      "aria-label": "Change callout color",
    }], ["div", { class: "vellix-plain-callout-text" }, 0]];
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const selection = editor.state.selection;
        const { $from, $to } = selection;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name !== "plainCallout") continue;
          if (!editor.isEditable || selectionMode !== "off") return true;
          if ($from.depth !== depth + 1 || $from.parent.type.spec.code || !$from.sameParent($to)) return false;

          const previous = $from.nodeBefore;
          if (!selection.empty || $from.parentOffset !== $from.parent.content.size || previous?.type.name !== "hardBreak") {
            return editor.commands.setHardBreak();
          }

          // A second Return removes the empty line and continues outside the box.
          const after = $from.after(depth);
          return editor.chain().focus().command(({ tr }) => {
            tr.delete(selection.from - previous.nodeSize, selection.from);
            const position = tr.mapping.map(after);
            tr.insert(position, editor.schema.nodes.paragraph.create({ id: id() }));
            tr.setSelection(TextSelection.create(tr.doc, position + 1));
            return true;
          }).run();
        }
        return false;
      },
    };
  },
});

const Divider = Node.create({
  name: "divider",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      id: { default: null },
      style: {
        default: DEFAULT_DIVIDER_STYLE,
        parseHTML: (element) =>
          normalizedDividerStyle(
            element.getAttribute("data-divider-style") ||
              element.getAttribute("data-vellix-divider-style")
          ),
        renderHTML: (attributes) => ({
          "data-divider-style": normalizedDividerStyle(attributes.style),
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-vellix-divider]" }, { tag: "hr[data-vellix-divider]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const style = normalizedDividerStyle(node?.attrs?.style);
    const content =
      style === "dottedCircles"
        ? [
            "span",
            { class: "vellix-divider-dots", "aria-hidden": "true" },
          ]
        : style === "fourCircles"
          ? [
              "span",
              { class: "vellix-divider-four-circles", "aria-hidden": "true" },
              ...Array.from({ length: 4 }, () => ["span", { class: "vellix-divider-circle" }]),
            ]
          : ["span", { class: "vellix-divider-line", "aria-hidden": "true" }];

    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-vellix-divider": "true",
        "data-divider-style": style,
      }),
      content,
    ];
  },
});

const VellixDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "(block | pageBoundary)+",
});

const PageBreak = Node.create({
  name: "pageBreak",
  group: "pageBoundary",
  atom: true,
  selectable: true,
  isolating: true,
  addAttributes() {
    return { id: { default: null } };
  },
  parseHTML() {
    return [
      { tag: "div[data-vellix-page-break]" },
      { tag: "div[data-type='pageBreak']" },
      { tag: "div[data-page-break]" },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-vellix-page-break": "true",
        "aria-hidden": "true",
      }),
    ];
  },
  addKeyboardShortcuts() {
    const deleteSelectedPageBreak = ({ editor: nodeEditor }) => {
      const { selection: currentSelection } = nodeEditor.state;
      if (
        !(currentSelection instanceof NodeSelection) ||
        currentSelection.node.type.name !== this.name
      ) {
        return false;
      }
      return nodeEditor.commands.deleteSelection();
    };

    return {
      Backspace: deleteSelectedPageBreak,
      Delete: deleteSelectedPageBreak,
    };
  },
});

const ToggleItem = Node.create({
  name: "toggleItem",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      id: { default: null },
      open: { default: true },
    };
  },
  addKeyboardShortcuts() {
    return {
      // Enter at the end of the toggle's summary line drops the cursor into a
      // NEW paragraph INSIDE the toggle body (Notion behavior). Also force-
      // opens the toggle if it was collapsed so the new line is visible.
      // Enter inside the body works normally (this returns false so TipTap's
      // default splitBlock runs).
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty) return false;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name !== "toggleItem") continue;
          const childDepth = depth + 1;
          if ($from.depth < childDepth) return false;
          const isFirstChild = $from.index(depth) === 0;
          const isAtEnd = $from.parentOffset === $from.parent.content.size;
          if (!isFirstChild || !isAtEnd) return false;

          const toggleNode = $from.node(depth);
          const togglePos = $from.before(depth);
          const insertAt = $from.after($from.depth); // right after the summary paragraph
          const chain = editor.chain().focus();
          if (toggleNode.attrs.open === false) {
            chain.command(({ tr }) => {
              tr.setNodeMarkup(togglePos, undefined, { ...toggleNode.attrs, open: true });
              return true;
            });
          }
          return chain
            .insertContentAt(insertAt, { type: "paragraph" }, { updateSelection: false })
            .setTextSelection(insertAt + 1)
            .run();
        }
        return false;
      },
      // Backspace at the start of an EMPTY toggle unwraps it back to a plain
      // paragraph. If the toggle has any content, do nothing so users don't
      // lose text unexpectedly.
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name !== "toggleItem") continue;
          const toggleNode = $from.node(depth);
          if (toggleNode.childCount !== 1) return false;
          const only = toggleNode.firstChild;
          if (!only || only.textContent.length > 0 || only.childCount > 0) return false;
          const from = $from.before(depth);
          const to = $from.after(depth);
          return editor
            .chain()
            .focus()
            .insertContentAt({ from, to }, { type: "paragraph" }, { updateSelection: true })
            .run();
        }
        return false;
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-vellix-toggle]",
        getAttrs: (element) => ({ open: element.getAttribute("data-open") !== "false" }),
      },
      {
        tag: "details[data-vellix-toggle]",
        getAttrs: (element) => ({ open: element.hasAttribute("open") }),
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    const isOpen = node.attrs.open !== false;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-vellix-toggle": "true",
        "data-open": isOpen ? "true" : "false",
      }),
      [
        "button",
        {
          type: "button",
          class: "vellix-toggle-button",
          contenteditable: "false",
          "data-vellix-toggle-button": "true",
          "aria-label": isOpen ? "Collapse toggle" : "Expand toggle",
        },
        "",
      ],
      ["div", { class: "vellix-toggle-content", "data-vellix-toggle-content": "true" }, 0],
    ];
  },
  addNodeView() {
    return ({ editor: nodeEditor, node, getPos }) => {
      let currentNode = node;
      let temporarilyOpenForTag = false;
      const dom = document.createElement("div");
      const button = document.createElement("button");
      const contentDOM = document.createElement("div");

      dom.dataset.vellixToggle = "true";
      dom.className = "vellix-toggle";

      button.type = "button";
      button.className = "vellix-toggle-button";
      button.contentEditable = "false";
      button.dataset.vellixToggleButton = "true";

      contentDOM.className = "vellix-toggle-content";
      contentDOM.dataset.vellixToggleContent = "true";

      dom.append(button, contentDOM);

      const render = () => {
        const isOpen = temporarilyOpenForTag || currentNode.attrs.open !== false;
        const blockId = nodeId(currentNode);
        dom.dataset.open = isOpen ? "true" : "false";
        dom.dataset.vellixBlockId = blockId;
        button.setAttribute("aria-label", isOpen ? "Collapse toggle" : "Expand toggle");
        button.setAttribute("aria-expanded", isOpen ? "true" : "false");
      };

      const toggleOpen = (event) => {
        if (selectionMode !== "off") {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const position = typeof getPos === "function" ? getPos() : null;
        if (position == null || Number.isNaN(position)) return;
        const nextOpen = !(temporarilyOpenForTag || currentNode.attrs.open !== false);
        temporarilyOpenForTag = false;
        nodeEditor.view.dispatch(
          nodeEditor.state.tr.setNodeMarkup(position, undefined, {
            ...currentNode.attrs,
            open: nextOpen,
          }),
        );
        render();
        requestAnimationFrame(reportContentHeight);
      };

      const preventToggleFocus = (event) => {
        if (selectionMode !== "off") return;
        event.preventDefault();
        event.stopPropagation();
      };
      const toggleFromTouch = (event) => {
        if (selectionMode === "off") toggleOpen(event);
      };

      // Cancel native touch focus before WebKit enters the editing host. Since
      // this also suppresses the synthesized click, handle touch activation here.
      button.addEventListener("pointerdown", preventToggleFocus);
      button.addEventListener("mousedown", preventToggleFocus);
      button.addEventListener("touchstart", preventToggleFocus, { passive: false });
      button.addEventListener("touchend", toggleFromTouch, { passive: false });
      button.addEventListener("click", toggleOpen);
      dom.addEventListener("pennedTagReveal", () => { temporarilyOpenForTag = true; render(); requestAnimationFrame(reportContentHeight); });
      dom.addEventListener("pennedTagReset", () => { temporarilyOpenForTag = false; render(); });
      render();

      return {
        dom,
        contentDOM,
        update(updatedNode) {
          if (updatedNode.type.name !== "toggleItem") return false;
          currentNode = updatedNode;
          render();
          return true;
        },
        stopEvent(event) {
          if (selectionMode !== "off") return false;
          return event.target === button || button.contains(event.target);
        },
        ignoreMutation(mutation) {
          return (mutation.type === "attributes" && mutation.target === dom) || mutation.target === button || button.contains(mutation.target);
        },
        destroy() {
          button.removeEventListener("pointerdown", preventToggleFocus);
          button.removeEventListener("mousedown", preventToggleFocus);
          button.removeEventListener("touchstart", preventToggleFocus);
          button.removeEventListener("touchend", toggleFromTouch);
          button.removeEventListener("click", toggleOpen);
        },
      };
    };
  },
});

const SelectionTextHighlight = Extension.create({
  name: "vellixTextSelectionHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: selectionHighlightPluginKey,
        state: {
          init: () => 0,
          apply: (transaction, value) =>
            transaction.getMeta(selectionHighlightPluginKey) || transaction.docChanged
              ? value + 1
              : value,
        },
        props: {
          decorations(state) {
            if (window.PennedBlockSelection) return DecorationSet.empty;
            selectionHighlightPluginKey.getState(state);
            if (selectionMode === "off" || !selection.size) return DecorationSet.empty;
            return selectedTextDecorationSet(state.doc);
          },
        },
      }),
    ];
  },
});

const selection = window.PennedBlockSelection?.selectionFacade() ?? new Set();
let selectionMode = "off";
let selectionDecorationRefreshQueued = false;
let lastSelectionHandleEvent = { key: "", time: 0 };
let lastHeight = -1;
let lastVisualContentBottom = -1;
let lastSelectionCount = -1;
let lastPageBreakSignature = "";
let lastNativeCollectionSignature = "";
let saveTimer;

const templateComponents = createTemplateComponents({ Node, post: postToSwift,
  snapshot: () => snapshotPayload(), selectionActive: () => selectionMode !== "off" });
const attachments = createAttachments({ Node, Extension, post: postToSwift,
  iconCSS: name => `var(${iconAssetCSSVariable(name)}, ${cssBackgroundImageSource(iconSource(name))})`,
  snapshot: () => snapshotPayload(), selectionActive: () => selectionMode !== "off", reportHeight: () => requestAnimationFrame(reportContentHeight) });
const documentTags = createDocumentTags({ post: postToSwift, snapshot: () => snapshotPayload(),
  selectionActive: () => selectionMode !== "off", reportHeight: () => requestAnimationFrame(reportContentHeight) });

const textColor = createTextColor({ ...textColorDependencies, post: postToSwift,
  snapshot: () => snapshotPayload(), selectionActive: () => selectionMode !== "off" });
const editor = new Editor({
  element: document.getElementById("editor"),
  extensions: [
    textColor.mark, textColor.integration,
    ...(window.PennedBlockSelection?.extensions({ Extension, Plugin, PluginKey, Decoration, DecorationSet,
      closeHistory, post: postToSwift, modeChanged: mode => { selectionMode = mode; } }) ?? []),
    ...window.VellixTables.createExtensions({ Node, Extension, Plugin, PluginKey, Decoration, DecorationSet, TextSelection,
      post: postToSwift, selectionActive: () => selectionMode !== "off",
      modules: { "prosemirror-state": { Plugin, PluginKey, TextSelection, NodeSelection, Selection, SelectionRange },
        "prosemirror-model": { Fragment, Slice, DOMSerializer }, "prosemirror-view": { Decoration, DecorationSet },
        "prosemirror-transform": { Transform }, "prosemirror-keymap": { keydownHandler } } }),
    window.VellixStructuredPlaceholders.createExtension({ Extension, Plugin, PluginKey, Decoration, DecorationSet, TextSelection, DOMSerializer }),
    VellixDocument,
    Caption,
    templateComponents.node,
    attachments.node,
    attachments.integration,
    documentTags.node,
    documentTags.integration,
    StarterKit.configure({
      blockquote: false,
      code: false,
      document: false,
      horizontalRule: false,
      trailingNode: false,
    }),
    UnderlineableCode,
    TaskList,
    VellixTaskItem,
    createTaskIntegration({ Extension, Plugin, PluginKey, post: postToSwift,
      selectionActive: () => selectionMode !== "off", canonicalize: normalizeTipTapDocument }),
    Placeholder.configure({ placeholder: "" }),
    BlockID,
    SelectionTextHighlight,
    Callout,
    PlainCallout,
    VellixBlockquote,
    Divider,
    PageBreak,
    ToggleItem,
    inlinePropertyNode({
      post: postToSwift,
      selectionActive: () => selectionMode !== "off",
      reportHeight: reportContentHeight,
    }),
    pageReferenceNode({ post: postToSwift, selectionActive: () => selectionMode !== "off" }),
    collectionNode({ post: postToSwift, selectionActive: () => selectionMode !== "off", reportHeight: reportContentHeight }),
  ],
  content: normalizeTipTapDocument(null),
  autofocus: false,
  editorProps: {
    attributes: {
      class: "tiptap-editor",
      spellcheck: "true",
    },
  },
  onUpdate: ({ editor }) => {
    renderCalloutIcons();
    traceCalloutAttrs("onUpdate-after-transaction", editor.getJSON());
    scheduleUpdate(editor);
    reportContentHeight();
  },
  onTransaction: ({ editor, transaction }) => {
    traceCalloutAttrs("onTransaction", editor.getJSON(), {
      docChanged: transaction.docChanged,
      selectionSet: transaction.selectionSet,
      stepCount: transaction.steps.length,
    });
  },
  onFocus: () => postToSwift("focus", { focused: true }),
  onBlur: () => postToSwift("focus", { focused: false }),
});

const caretTracking = createCaretTracking({ editor, post: postToSwift, reportHeight: reportContentHeight,
  selectionActive: () => selectionMode !== "off" });

function isCalloutProbeElement(element) {
  return !!element?.matches?.(
    ".vellix-callout, .vellix-callout-icon-button, .vellix-callout-icon-image",
  ) || !!element?.closest?.(".vellix-callout");
}

function mutationElementSummary(node) {
  if (!node || node.nodeType !== globalThis.Node.ELEMENT_NODE) {
    return null;
  }

  const element = node;
  const callout = element.matches?.(".vellix-callout")
    ? element
    : element.closest?.(".vellix-callout");
  return {
    tag: element.tagName?.toLowerCase?.() || null,
    className: element.className || null,
    serial: serialForElement(element),
    calloutSerial: serialForElement(callout),
    id: callout?.dataset?.vellixBlockId || null,
    icon: callout?.dataset?.calloutIcon || null,
    color: callout?.dataset?.calloutColor || null,
    src: element.getAttribute?.("src") || null,
    isConnected: element.isConnected,
  };
}

const editorElement = document.getElementById("editor");
const calloutMutationObserver = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    const target = mutation.target;
    const added = Array.from(mutation.addedNodes || []).filter(isCalloutProbeElement);
    const removed = Array.from(mutation.removedNodes || []).filter(isCalloutProbeElement);
    const relevantAttribute =
      mutation.type === "attributes" &&
      target?.nodeType === globalThis.Node.ELEMENT_NODE &&
      isCalloutProbeElement(target);
    const relevantChildList = mutation.type === "childList" && (added.length || removed.length);

    if (!relevantAttribute && !relevantChildList) return;

    traceDiag("callout-dom-mutation", {
      type: mutation.type,
      attributeName: mutation.attributeName || null,
      oldValue: mutation.oldValue || null,
      target: mutationElementSummary(target),
      added: added.map(mutationElementSummary),
      removed: removed.map(mutationElementSummary),
    });

    if (target?.nodeType === globalThis.Node.ELEMENT_NODE) {
      const callout = target.matches?.(".vellix-callout")
        ? target
        : target.closest?.(".vellix-callout");
      const img = callout?.querySelector?.(".vellix-callout-icon-image");
      if (callout && img) {
        traceCalloutImageState("callout-dom-mutation-state", callout, img, {
          mutationType: mutation.type,
          attributeName: mutation.attributeName || null,
        });
      }
    }
  });
});

if (editorElement) {
  calloutMutationObserver.observe(editorElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: [
      "src",
      "style",
      "class",
      "hidden",
      "data-callout-icon",
      "data-callout-color",
      "data-vellix-block-id",
    ],
  });
}

function snapshotPayload() {
  const documentJSON = normalizeTipTapDocument(editor.getJSON());
  return {
    document: documentJSON,
    ...statistics(documentJSON),
  };
}

function scheduleUpdate() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    postToSwift("update", snapshotPayload());
  }, 500);
}

function roundedRectNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

function shortText(value, limit = 120) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function domElementTrace(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect?.();
  return {
    tag: element.tagName?.toLowerCase?.() || null,
    dataType: element.getAttribute?.("data-type") || null,
    blockId: element.dataset?.vellixBlockId || null,
    className:
      typeof element.className === "string"
        ? shortText(element.className, 90)
        : shortText(element.getAttribute?.("class"), 90),
    top: rect ? roundedRectNumber(rect.top) : null,
    left: rect ? roundedRectNumber(rect.left) : null,
    width: rect ? roundedRectNumber(rect.width) : null,
    height: rect ? roundedRectNumber(rect.height) : null,
  };
}

function domParentTrace(element) {
  const parent = element?.parentElement;
  return parent ? domElementTrace(parent) : null;
}

function domPathTrace(element) {
  const parts = [];
  let current = element;
  while (current && current.nodeType === globalThis.Node.ELEMENT_NODE && parts.length < 6) {
    const tag = current.tagName?.toLowerCase?.() || "element";
    const dataType = current.getAttribute?.("data-type");
    const blockId = current.dataset?.vellixBlockId;
    const classes = typeof current.className === "string"
      ? current.className.split(/\s+/).filter(Boolean).slice(0, 2)
      : [];
    parts.push(
      `${tag}${dataType ? `[data-type=${dataType}]` : ""}${blockId ? `[block=${blockId}]` : ""}${classes.length ? `.${classes.join(".")}` : ""}`,
    );
    if (current.classList?.contains("tiptap-editor")) break;
    current = current.parentElement;
  }
  return parts.join(" <- ");
}

function topLevelBlockTraceRecords(source) {
  return topLevelDocumentBlocks(source).map((node, index) => ({
    index,
    id: nodeId(node),
    type: node.type,
    text: shortText(plainText(node)),
    childBlockIds: Array.isArray(node.content)
      ? node.content
          .filter((child) => child?.type && child.type !== "text")
          .map((child) => ({ type: child.type, id: nodeId(child), text: shortText(plainText(child), 60) }))
      : [],
  }));
}

function duplicateValues(values) {
  const counts = new Map();
  values.forEach((value) => {
    if (!value) return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }));
}

function isVisibleElement(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

function pathKey(path) {
  return Array.isArray(path) ? path.join(".") : "";
}

function selectionKeyForModelPath(path, pos) {
  const pathValue = pathKey(path);
  return pathValue ? `path:${pathValue}` : `pos:${pos}`;
}

function listContainerType(type) {
  return type === "bulletList" || type === "orderedList" || type === "taskList";
}

function listRowType(type) {
  return type === "listItem" || type === "taskItem";
}

function shouldSelectModelNode(type, parentType) {
  if (listRowType(type) && listContainerType(parentType)) return true;
  if (parentType === "doc" && !listContainerType(type)) return true;
  return false;
}

function cssIdentifier(value) {
  const raw = String(value || "");
  return globalThis.CSS?.escape ? globalThis.CSS.escape(raw) : raw.replace(/["\\]/g, "\\$&");
}

function elementForModelBlock(block) {
  const nodeDOM = editor.view.nodeDOM(block.pos);
  if (nodeDOM instanceof HTMLElement) return nodeDOM;

  const attrID = block.node?.attrs?.id;
  if (typeof attrID === "string" && attrID.trim()) {
    const escapedID = cssIdentifier(attrID.trim());
    const byID = editor.view.dom.querySelector(`[data-vellix-block-id="${escapedID}"]`);
    if (byID instanceof HTMLElement) return byID;
  }

  try {
    const domAtPos = editor.view.domAtPos(block.pos, 1);
    const element = domAtPos.node instanceof HTMLElement ? domAtPos.node : domAtPos.node?.parentElement;
    return element?.closest?.(
      [
        "[data-vellix-block-id]",
        "[data-type='taskItem']",
        "[data-vellix-toggle]",
        ".vellix-callout",
        ".vellix-plain-callout",
        "[data-vellix-divider]",
        "[data-vellix-page-break]",
        "li",
        "p",
        "blockquote",
      ].join(", "),
    ) || null;
  } catch (_e) {
    return null;
  }
}

function topLevelModelBlocks(rootDoc = editor.state.doc) {
  if (window.PennedBlockSelection) return window.PennedBlockSelection.records(rootDoc, normalizeTipTapNode);
  const blocks = [];

  const visitChildren = (parentNode, parentPos, parentPath) => {
    const parentType = parentNode.type.name;
    parentNode.forEach((node, offset, index) => {
      const type = node.type.name;
      const pos = parentType === "doc" ? offset : parentPos + 1 + offset;
      const path = [...parentPath, index];
      const json = normalizeTipTapNode(node.toJSON());
      const selectable = shouldSelectModelNode(type, parentType);

      if (selectable) {
        blocks.push({
          index: blocks.length,
          node,
          pos,
          key: selectionKeyForModelPath(path, pos),
          json,
          path,
          parentType,
          type,
        });
      }

      if (listContainerType(type)) {
        visitChildren(node, pos, path);
      }
    });
  };

  visitChildren(rootDoc, 0, []);

  const last = blocks[blocks.length - 1];
  if (last?.parentType === "doc" && last?.type === "paragraph" && !plainText(last.json).trim()) {
    blocks.pop();
  }

  return blocks;
}

function addTextDecorationsForNode(node, nodePos, decorations) {
  node.descendants((child, childPos) => {
    if (!child.isText || !String(child.text || "").trim()) return true;
    const from = nodePos + 1 + childPos;
    const to = from + child.nodeSize;
    if (to > from) {
      decorations.push(
        Decoration.inline(from, to, {
          class: "vellix-selected-text-decoration",
        }),
      );
    }
    return true;
  });
}

function selectedTextDecorationSet(rootDoc) {
  const decorations = [];
  topLevelModelBlocks(rootDoc).forEach((block) => {
    if (!selection.has(block.key)) return;
    addTextDecorationsForNode(block.node, block.pos, decorations);
  });
  return decorations.length ? DecorationSet.create(rootDoc, decorations) : DecorationSet.empty;
}

function scheduleSelectionDecorationRefresh() {
  if (selectionDecorationRefreshQueued) return;
  selectionDecorationRefreshQueued = true;
  queueMicrotask(() => {
    selectionDecorationRefreshQueued = false;
    if (!editor?.view) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(selectionHighlightPluginKey, { refresh: true }),
    );
  });
}

function selectableBlockRecords() {
  return topLevelModelBlocks().flatMap((block) => {
    const element = elementForModelBlock(block);
    if (!(element instanceof HTMLElement)) return [];
    if (!editor.view.dom.contains(element) || !isVisibleElement(element)) return [];
    return [{ ...block, element }];
  });
}

function clearSelectionDOMState() {
  document
    .querySelectorAll(
      [
        ".tiptap-editor .vellix-selectable-block",
        ".tiptap-editor .vellix-selected-block",
        ".tiptap-editor [data-vellix-selection-block]",
        ".tiptap-editor [data-vellix-selected]",
      ].join(", "),
    )
    .forEach((outer) => {
      outer.classList.remove("vellix-selectable-block", "vellix-selected-block");
      outer.removeAttribute("data-vellix-selected");
      outer.removeAttribute("data-vellix-selection-block");
      outer.removeAttribute("data-vellix-selection-key");
      outer.removeAttribute("data-vellix-selection-node-type");
      outer.removeAttribute("data-vellix-selection-index");
      outer.removeAttribute("data-vellix-selection-path");
      outer.style.removeProperty("--vellix-selection-y");
      outer.style.removeProperty("--vellix-selection-highlight-left");
      outer.style.removeProperty("--vellix-selection-highlight-top");
      outer.style.removeProperty("--vellix-selection-highlight-width");
      outer.style.removeProperty("--vellix-selection-highlight-height");
    });
}

function blockOuters() {
  return selectableBlockRecords().map((record) => record.element);
}

function selectionIndicatorOffset(outer) {
  const outerRect = outer.getBoundingClientRect();
  if (!outerRect.height) return 12;
  const isTaskItem =
    outer.matches?.("[data-type='taskItem']") ||
    (outer.tagName === "LI" && outer.hasAttribute("data-checked"));
  const markerTarget = isTaskItem
    ? outer.querySelector(":scope > label")
    : outer.matches?.("[data-type='taskList']")
      ? outer.querySelector("[data-type='taskItem'] > label, li[data-checked] > label")
      : null;
  const targetRect = markerTarget?.getBoundingClientRect?.();
  if (targetRect?.height) {
    return Math.max(12, Math.min(outerRect.height - 12, targetRect.top - outerRect.top + targetRect.height / 2));
  }
  return outerRect.height / 2;
}

function selectionHandleContainsEvent(outer, event) {
  const rect = outer.getBoundingClientRect();
  const visibleHandleSize = 18;
  const visibleHandleRightInset = 8;
  const centerX = rect.right - visibleHandleRightInset - visibleHandleSize / 2;
  const centerY = rect.top + selectionIndicatorOffset(outer);
  const hitRadius = 22;
  return Math.abs(event.clientX - centerX) <= hitRadius && Math.abs(event.clientY - centerY) <= hitRadius;
}

function textContentRect(element) {
  if (!element) return null;
  const rects = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        return String(node.nodeValue || "").trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    },
  );

  let node = walker.nextNode();
  while (node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    rects.push(...Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0));
    range.detach?.();
    node = walker.nextNode();
  }

  if (!rects.length) return null;

  return rects.reduce(
    (union, rect) => ({
      left: Math.min(union.left, rect.left),
      top: Math.min(union.top, rect.top),
      right: Math.max(union.right, rect.right),
      bottom: Math.max(union.bottom, rect.bottom),
    }),
    {
      left: rects[0].left,
      top: rects[0].top,
      right: rects[0].right,
      bottom: rects[0].bottom,
    },
  );
}

function unionRects(rects) {
  const visibleRects = rects.filter((rect) => rect && rect.width > 0 && rect.height > 0);
  if (!visibleRects.length) return null;
  return visibleRects.reduce(
    (union, rect) => ({
      left: Math.min(union.left, rect.left),
      top: Math.min(union.top, rect.top),
      right: Math.max(union.right, rect.right),
      bottom: Math.max(union.bottom, rect.bottom),
    }),
    {
      left: visibleRects[0].left,
      top: visibleRects[0].top,
      right: visibleRects[0].right,
      bottom: visibleRects[0].bottom,
    },
  );
}

function selectionHighlightRect(outer) {
  const outerRect = outer.getBoundingClientRect();
  const nodeType = outer.dataset?.vellixSelectionNodeType || "";
  const horizontalPadding = 10;
  const verticalPadding = 6;
  const handleGutter = 44;
  let contentRect = null;

  if (nodeType === "taskItem" || outer.matches?.("[data-type='taskItem']")) {
    contentRect = unionRects([
      outer.querySelector(":scope > label")?.getBoundingClientRect?.(),
      textContentRect(outer.querySelector(":scope > div")),
    ]);
  } else if (nodeType === "blockquote" || outer.matches?.("blockquote")) {
    const textRect = textContentRect(outer);
    if (textRect) {
      contentRect = {
        left: outerRect.left,
        top: Math.min(outerRect.top, textRect.top),
        right: textRect.right,
        bottom: Math.max(outerRect.bottom, textRect.bottom),
      };
    } else {
      contentRect = outerRect;
    }
  } else if (nodeType === "divider" || outer.matches?.("[data-vellix-divider]")) {
    contentRect = outerRect;
  } else if (
    nodeType === "callout" ||
    nodeType === "plainCallout" ||
    nodeType === "pageBreak" ||
    nodeType === "toggleItem" ||
    outer.matches?.(".vellix-callout, .vellix-plain-callout, [data-vellix-page-break], [data-vellix-toggle], pre")
  ) {
    contentRect = outerRect;
  } else {
    contentRect = textContentRect(outer) || outerRect;
  }

  const maxRight = outerRect.right - handleGutter;
  const left = Math.max(outerRect.left, contentRect.left - horizontalPadding);
  const top = Math.max(outerRect.top, contentRect.top - verticalPadding);
  const right = Math.min(maxRight, Math.max(left + 12, contentRect.right + horizontalPadding));
  const bottom = Math.min(outerRect.bottom + verticalPadding, Math.max(top + 12, contentRect.bottom + verticalPadding));

  return {
    left: left - outerRect.left,
    top: top - outerRect.top,
    width: Math.max(12, right - left),
    height: Math.max(12, bottom - top),
  };
}

function setSelectionHighlightProperties(outer) {
  const rect = selectionHighlightRect(outer);
  outer.style.setProperty("--vellix-selection-highlight-left", `${rect.left}px`);
  outer.style.setProperty("--vellix-selection-highlight-top", `${rect.top}px`);
  outer.style.setProperty("--vellix-selection-highlight-width", `${rect.width}px`);
  outer.style.setProperty("--vellix-selection-highlight-height", `${rect.height}px`);
}

function selectionRecordForEvent(event) {
  if (selectionMode === "off" || !editor.view.dom.contains(event.target)) return null;

  const records = selectableBlockRecords();
  const closestBlock = event.target.closest?.("[data-vellix-selection-block='true']");
  if (
    closestBlock instanceof HTMLElement &&
    editor.view.dom.contains(closestBlock) &&
    selectionHandleContainsEvent(closestBlock, event)
  ) {
    const selectionKey = closestBlock.dataset.vellixSelectionKey;
    return records.find((record) => record.element === closestBlock || record.key === selectionKey) || {
      element: closestBlock,
      key: selectionKey,
    };
  }

  return records.find((record) => selectionHandleContainsEvent(record.element, event)) || null;
}

function handleSelectionHandleEvent(event) {
  if (window.PennedBlockSelection) return false;
  const record = selectionRecordForEvent(event);
  if (!record) return false;

  event.preventDefault();
  event.stopPropagation();
  const selectionKey = record.key || record.element?.dataset?.vellixSelectionKey;
  const now = performance.now();
  if (
    event.type === "click" &&
    selectionKey &&
    lastSelectionHandleEvent.key === selectionKey &&
    now - lastSelectionHandleEvent.time < 500
  ) {
    return true;
  }

  toggleBlockSelection(selectionKey);
  lastSelectionHandleEvent = { key: selectionKey || "", time: now };
  return true;
}

function pruneSelectionToSelectable(records) {
  const keys = new Set(records.map((record) => record.key));
  Array.from(selection).forEach((key) => {
    if (!keys.has(key)) selection.delete(key);
  });
}

function traceSelectionRegistry(label, selectableRecords) {
  const documentJSON = editor.getJSON();
  const topLevelBlocks = topLevelBlockTraceRecords(documentJSON);
  const topLevelById = new Map(topLevelBlocks.map((block) => [block.id, block]));
  const allCandidates = Array.from(document.querySelectorAll(".tiptap-editor [data-vellix-block-id]"));
  const visibleCandidates = allCandidates.filter(isVisibleElement);
  const candidateRecords = visibleCandidates.map((element, index) => {
    const blockId = element.dataset.vellixBlockId || "";
    const topLevelBlock = topLevelById.get(blockId);
    const elementTrace = domElementTrace(element);
    return {
      index,
      blockId,
      nodeType: topLevelBlock?.type || null,
      isTopLevelDocumentBlock: topLevelById.has(blockId),
      isDirectEditorChild: element.parentElement === editor.view.dom,
      domElement: elementTrace,
      parentNode: domParentTrace(element),
      path: domPathTrace(element),
      topPosition: elementTrace?.top ?? null,
    };
  });
  const registryRecords = selectableRecords.map((record) => {
    const elementTrace = domElementTrace(record.element);
    return {
      index: record.index,
      blockId: record.node.attrs?.id || null,
      selectionKey: record.key,
      nodeType: record.node.type.name,
      parentType: record.parentType,
      modelPath: record.path,
      prosemirrorPos: record.pos,
      domElement: elementTrace,
      parentNode: domParentTrace(record.element),
      path: domPathTrace(record.element),
      topPosition: elementTrace?.top ?? null,
    };
  });
  const candidateCountsByBlockId = Array.from(
    visibleCandidates.reduce((counts, element) => {
      const blockId = element.dataset.vellixBlockId || "";
      if (!blockId) return counts;
      counts.set(blockId, (counts.get(blockId) || 0) + 1);
      return counts;
    }, new Map()),
    ([blockId, count]) => ({ blockId, count }),
  );
  const duplicateTopPositions = duplicateValues(
    registryRecords.map((record) =>
      typeof record.topPosition === "number" ? String(Math.round(record.topPosition)) : null,
    ),
  );

  traceDiag("selection-registry", {
    label,
    mode: selectionMode,
    topLevelBlocks,
    duplicateTopLevelIds: duplicateValues(topLevelBlocks.map((block) => block.id)),
    modelBlocks: topLevelModelBlocks().map((block) => ({
      index: block.index,
      blockId: block.node.attrs?.id || null,
      selectionKey: block.key,
      nodeType: block.node.type.name,
      parentType: block.parentType,
      modelPath: block.path,
      prosemirrorPos: block.pos,
      text: shortText(plainText(block.json)),
    })),
    domCandidateCount: candidateRecords.length,
    candidateCountsByBlockId,
    domCandidates: candidateRecords,
    selectableCount: registryRecords.length,
    selectableBlocks: registryRecords,
    duplicateSelectableIds: duplicateValues(registryRecords.map((block) => block.selectionKey)),
    duplicateSelectableTopPositions: duplicateTopPositions,
  });
}

function setSelectionClasses() {
  if (window.PennedBlockSelection) { window.PennedBlockSelection.refresh(); return; }
  const inSelectionMode = selectionMode !== "off";
  document.documentElement.classList.toggle("vellix-selection-mode", inSelectionMode);
  document.documentElement.dataset.vellixSelectionMode = selectionMode;
  document.body?.classList.toggle("vellix-selection-mode", inSelectionMode);
  if (document.body) document.body.dataset.vellixSelectionMode = selectionMode;
  editor.setEditable(!inSelectionMode, false);

  clearSelectionDOMState();

  const selectableBlocks = selectableBlockRecords();
  pruneSelectionToSelectable(selectableBlocks);
  if (inSelectionMode) {
    traceSelectionRegistry("setSelectionClasses-before-apply", selectableBlocks);
  }

  selectableBlocks.forEach((record) => {
    const outer = record.element;
    const selected = selection.has(record.key);
    outer.classList.add("vellix-selectable-block");
    outer.classList.toggle("vellix-selected-block", selected);
    outer.setAttribute("data-vellix-selection-block", "true");
    outer.setAttribute("data-vellix-selection-key", record.key);
    outer.setAttribute("data-vellix-selection-node-type", record.node.type.name);
    outer.setAttribute("data-vellix-selection-index", String(record.index));
    outer.setAttribute("data-vellix-selection-path", pathKey(record.path));
    outer.setAttribute("data-vellix-selected", selected ? "true" : "false");
    outer.style.setProperty("--vellix-selection-y", `${selectionIndicatorOffset(outer)}px`);
    setSelectionHighlightProperties(outer);
  });

  if (lastSelectionCount !== selection.size) {
    lastSelectionCount = selection.size;
    postToSwift("selection", { count: selection.size });
  }
  scheduleSelectionDecorationRefresh();
}

function setSelectionMode(mode) {
  if (window.PennedBlockSelection) { window.PennedBlockSelection.setMode(mode); return; }
  const nextMode = mode === "single" || mode === "multi" ? mode : "off";
  const previousMode = selectionMode;
  const isExitingSelectionMode = previousMode !== "off" && nextMode === "off";
  selectionMode = nextMode;
  templateComponents.refresh();
  if (selectionMode === "off") selection.clear();
  if (selectionMode !== "off") {
    attachments.command(editor, "attachmentPauseAll", {});
    editor.commands.blur();
  }
  setSelectionClasses();
  if (isExitingSelectionMode) {
    clearProseMirrorNodeSelectionForSelectionExit();
  }
  if (previousMode !== selectionMode) {
    postToSwift("selectionMode", { mode: selectionMode });
  }
  reportFormattingState();
}

function toggleBlockSelection(selectionKey) {
  if (!selectionKey || selectionMode === "off") return;
  if (selectionMode === "single") {
    selection.clear();
    selection.add(selectionKey);
  } else if (selection.has(selectionKey)) {
    selection.delete(selectionKey);
  } else {
    selection.add(selectionKey);
  }
  setSelectionClasses();
  postToSwift("haptic", { style: "light" });
}

function clearProseMirrorNodeSelectionForSelectionExit() {
  const currentSelection = editor.state.selection;
  if (!(currentSelection instanceof NodeSelection) && !(currentSelection instanceof AllSelection)) {
    editor.commands.blur();
    return;
  }

  try {
    const pos = Math.max(0, Math.min(currentSelection.from, editor.state.doc.content.size));
    const nextSelection = TextSelection.near(editor.state.doc.resolve(pos), 1);
    editor.view.dispatch(editor.state.tr.setSelection(nextSelection));
  } catch (_error) {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atStart(editor.state.doc)));
  }

  editor.commands.blur();
  window.getSelection?.()?.removeAllRanges?.();
}

function reportedVisualContentBottom(root, content) {
  const renderedBlocks = [];
  editor.state.doc.forEach((node, offset) => {
    const element = editor.view.nodeDOM(offset);
    if (element instanceof HTMLElement && isVisibleElement(element)) {
      renderedBlocks.push({ node, element });
    }
  });

  const visualElement = renderedBlocks[renderedBlocks.length - 1]?.element;
  if (!(visualElement instanceof HTMLElement)) {
    return Math.max(0, Math.ceil(content.getBoundingClientRect().bottom - root.getBoundingClientRect().top));
  }

  const rootTop = root.getBoundingClientRect().top;
  const visualRect = visualElement.getBoundingClientRect();
  const contentStyle = window.getComputedStyle(content);
  const contentPaddingBottom = Number.parseFloat(contentStyle.paddingBottom) || 0;

  // The native page sheet owns its bottom inset. A final block's CSS margin is
  // inter-block spacing and must not become a second page-edge inset.
  return Math.max(
    0,
    Math.ceil(visualRect.bottom - rootTop + contentPaddingBottom),
  );
}

function reportContentHeight() {
  const root = document.querySelector(".vellix-editor-page");
  const content = editor?.view?.dom;

  let height = 60;
  let visualContentBottom = 60;
  if (root && content instanceof HTMLElement && isVisibleElement(content)) {
    const top = root.getBoundingClientRect().top;
    // Keep the WKWebView aligned to the complete rendered editor DOM so empty
    // surface taps remain inside the web view and can create a paragraph.
    const bottom = content.getBoundingClientRect().bottom;
    height = Math.max(60, Math.ceil(bottom - top + 2));
    visualContentBottom = Math.min(height, reportedVisualContentBottom(root, content));
  }

  if (
    Math.abs(height - lastHeight) > 1 ||
    Math.abs(visualContentBottom - lastVisualContentBottom) > 1
  ) {
    lastHeight = height;
    lastVisualContentBottom = visualContentBottom;
    postToSwift("height", { height, visualContentBottom });
  }

  reportPageBreakRegions(root);
  const regions = nativeCollectionRegions(root);
  const signature = JSON.stringify(regions);
  if (signature !== lastNativeCollectionSignature) {
    lastNativeCollectionSignature = signature;
    postToSwift("nativeCollections", { regions });
  }
}

function reportPageBreakRegions(root) {
  if (!root) return;
  const rootRect = root.getBoundingClientRect();
  const regions = Array.from(
    root.querySelectorAll("[data-vellix-page-break], [data-type='pageBreak'], [data-page-break]"),
  )
    .filter((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    })
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        y: Math.max(0, Math.round((rect.top - rootRect.top) * 10) / 10),
        height: Math.max(0, Math.round(rect.height * 10) / 10),
      };
    });
  const signature = JSON.stringify(regions);
  if (signature === lastPageBreakSignature) return;
  lastPageBreakSignature = signature;
  postToSwift("pageBreaks", { regions });
}

function selectedBlocks() {
  const blocks = topLevelModelBlocks()
    .filter((block) => selection.has(block.key))
    .map((block) => block.json);
  if (!blocks.length) {
    postToSwift("error", { message: "Select at least one block first." });
    return null;
  }
  return blocks;
}

function selectedBlockIndexMap() {
  return topLevelModelBlocks().reduce((map, block) => {
    if (selection.has(block.key)) map.set(pathKey(block.path), block);
    return map;
  }, new Map());
}

function transformSelectedTopLevelBlocks(transform) {
  const mobileResult = window.PennedBlockSelection?.transformSelectedNested(transform);
  if (mobileResult !== undefined) {
    if (mobileResult) postToSwift("snapshot", snapshotPayload());
    return mobileResult;
  }
  const selectedByPath = selectedBlockIndexMap();
  if (!selectedByPath.size) {
    postToSwift("error", { message: "Select at least one block first." });
    return false;
  }
  const nextDocument = normalizeTipTapDocument(editor.getJSON());
  const transformNodes = (nodes, parentPath = []) => nodes.flatMap((node, index) => {
    const path = [...parentPath, index];
    const selectedBlock = selectedByPath.get(pathKey(path));
    const nodeWithChildren =
      node.content && !selectedBlock
        ? { ...node, content: transformNodes(node.content, path) }
        : node;
    const transformed = selectedBlock ? transform(nodeWithChildren, selectedBlock) : nodeWithChildren;
    return transformed ? [transformed] : [];
  });
  nextDocument.content = transformNodes(nextDocument.content);
  commitDocument(nextDocument);
  return true;
}

function walkTransform(nodes, transform) {
  return nodes.flatMap((node) => {
    const withChildren = node.content ? { ...node, content: walkTransform(node.content, transform) } : node;
    const transformed = transform(withChildren);
    return transformed ? [transformed] : [];
  });
}

function commitDocument(nextDocument) {
  const normalizedDocument = normalizeTipTapDocument(nextDocument);
  traceCalloutAttrs("commitDocument-before-setContent", normalizedDocument);
  editor.commands.setContent(normalizedDocument, { emitUpdate: false });
  traceCalloutAttrs("commitDocument-after-setContent", editor.getJSON());
  renderCalloutIcons();
  setSelectionClasses();
  reportContentHeight();
  postToSwift("update", snapshotPayload());
}

function transformNodeToBlock(node, type, payload = {}) {
  const blockID = nodeId(node);
  const content = taggedInlineContent(node) ?? inlineContent(plainText(node));
  switch (type) {
    case "caption":
      return { type: "caption", attrs: { id: blockID }, content };
    case "heading":
      return {
        type: "heading",
        attrs: {
          id: blockID,
          level: Math.max(1, Math.min(6, Number(payload.level) || 3)),
        },
        content,
      };
    case "quote":
      return { type: "blockquote", attrs: { id: blockID }, content: [paragraph(content)] };
    case "callout":
      return {
        type: "callout",
        attrs: {
          id: blockID,
          icon: payload.icon || DEFAULT_CALLOUT_ICON,
          color: payload.color || DEFAULT_CALLOUT_COLOR,
        },
        content: [paragraph(content)],
      };
    case "plainCallout":
      return {
        type: "plainCallout",
        attrs: { id: blockID, color: payload.color || DEFAULT_CALLOUT_COLOR },
        content: [paragraph(content)],
      };
    case "checkListItem":
      return {
        type: "taskList",
        attrs: { id: blockID },
        content: [{
          type: "taskItem",
          attrs: { id: id(), checked: false, crossed: false },
          content: [paragraph(content)],
        }],
      };
    case "bulletListItem":
      return {
        type: "bulletList",
        attrs: { id: blockID },
        content: [{ type: "listItem", attrs: { id: id() }, content: [paragraph(content)] }],
      };
    case "numberedListItem":
      return {
        type: "orderedList",
        attrs: { id: blockID },
        content: [{ type: "listItem", attrs: { id: id() }, content: [paragraph(content)] }],
      };
    case "toggleListItem":
      return { type: "toggleItem", attrs: { id: blockID, open: true }, content: [
        payload.level ? { type: "heading", attrs: { id: id(), level: Math.max(1, Math.min(6, Number(payload.level) || 1)) }, content } : paragraph(content),
      ] };
    case "codeBlock":
      return { type: "codeBlock", attrs: { id: blockID }, content: inlineContent(plainText(node)) };
    default:
      return paragraph(content, { id: blockID });
  }
}

function transformSelectedBlocks(type, payload = {}) {
  transformSelectedTopLevelBlocks((node) => transformNodeToBlock(node, type, payload));
}

function updateSelectedCalloutColor(color) {
  transformSelectedTopLevelBlocks((node) => {
    if (node.type === "callout" || node.type === "plainCallout") {
      return { ...node, attrs: { ...node.attrs, color } };
    }
    const callout = transformNodeToBlock(node, "callout", { color });
    return { ...callout, attrs: { ...callout.attrs, color } };
  });
}

function updateCalloutIcon(blockId, icon) {
  const selectedByPath = selectedBlockIndexMap();
  if (!blockId && !selectedByPath.size) {
    postToSwift("error", { message: "Select at least one block first." });
    return;
  }
  const nextDocument = normalizeTipTapDocument(editor.getJSON());
  const updateNodes = (nodes, parentPath = []) => nodes.map((node, index) => {
    const path = [...parentPath, index];
    const isTarget = blockId ? nodeId(node) === blockId : selectedByPath.has(pathKey(path));
    const nodeWithChildren = node.content ? { ...node, content: updateNodes(node.content, path) } : node;
    return isTarget && node.type === "callout"
      ? { ...nodeWithChildren, attrs: { ...nodeWithChildren.attrs, icon: icon || DEFAULT_CALLOUT_ICON } }
      : nodeWithChildren;
  });
  nextDocument.content = updateNodes(nextDocument.content);
  commitDocument(nextDocument);
}

function updateCalloutColor(blockId, color) {
  if (!blockId) {
    postToSwift("error", { message: "Choose a callout before changing its color." });
    return;
  }
  const nextDocument = normalizeTipTapDocument(editor.getJSON());
  const updateNodes = (nodes) => nodes.map((node) => {
    const nodeWithChildren = node.content ? { ...node, content: updateNodes(node.content) } : node;
    return nodeId(node) === blockId && (node.type === "callout" || node.type === "plainCallout")
      ? { ...nodeWithChildren, attrs: { ...nodeWithChildren.attrs, color: color || DEFAULT_CALLOUT_COLOR } }
      : nodeWithChildren;
  });
  nextDocument.content = updateNodes(nextDocument.content);
  commitDocument(nextDocument);
}

function updateBlockquoteColor(blockId, color) {
  const nextColor = typeof color === "string" ? color.trim() : "";
  if (!blockId || !/^#[0-9a-f]{6}$/i.test(nextColor)) return false;
  let position = null;
  let target = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "blockquote" && nodeId(node) === blockId) {
      position = pos;
      target = node;
      return false;
    }
  });
  if (!target) return false;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, {
    ...target.attrs,
    color: nextColor,
  }));
  return true;
}

function textNodesIn(node) {
  const result = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.type === "text") result.push(value);
    value.content?.forEach(visit);
  };
  visit(node);
  return result;
}

function textHasMark(node, markType) {
  return Array.isArray(node.marks) && node.marks.some((mark) => mark.type === markType);
}

function setMarkOnNode(node, markType, enabled) {
  if (!node || typeof node !== "object") return node;
  if (node.type === "text") {
    const marks = Array.isArray(node.marks) ? node.marks.filter((mark) => mark.type !== markType) : [];
    return enabled ? { ...node, marks: [...marks, { type: markType }] } : { ...node, marks };
  }
  if (!node.content) return node;
  return { ...node, content: node.content.map((child) => setMarkOnNode(child, markType, enabled)) };
}

function formatSelectedBlocks(action, value = null) {
  transformSelectedTopLevelBlocks((node) => {
    switch (action) {
      case "codeUnderline":
      case "bold":
      case "italic":
      case "underline":
      case "strike":
      case "code": {
        const mark = action === "codeUnderline" ? "code" : action;
        const texts = textNodesIn(node);
        const shouldEnable = texts.length ? !texts.every((textNode) => textHasMark(textNode, mark)) : true;
        return setMarkOnNode(node, mark, shouldEnable);
      }
      case "align":
        return { ...node, attrs: { ...node.attrs, textAlign: value || "left" } };
      case "indent": {
        const indent = Math.max(0, Math.min(6, Number(node.attrs?.indent) || 0));
        return { ...node, attrs: { ...node.attrs, indent: Math.min(6, indent + 1) } };
      }
      case "outdent": {
        const indent = Math.max(0, Math.min(6, Number(node.attrs?.indent) || 0));
        return { ...node, attrs: { ...node.attrs, indent: Math.max(0, indent - 1) } };
      }
      default:
        return node;
    }
  });
}

function currentSelectionTextblocks() {
  const { state } = editor;
  const positions = new Map();
  const includeNode = (node, position) => {
    if (node?.isTextblock) positions.set(position, node);
  };

  const includeSelectionAncestors = ($position) => {
    for (let depth = $position.depth; depth > 0; depth -= 1) {
      const node = $position.node(depth);
      if (node.isTextblock) {
        includeNode(node, $position.before(depth));
        break;
      }
    }
  };

  includeSelectionAncestors(state.selection.$from);
  includeSelectionAncestors(state.selection.$to);
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, position) => {
    includeNode(node, position);
  });

  return positions;
}

let lastFormattingStateSignature = "";
function reportFormattingState(force = false) {
  const available = selectionMode === "off" && editor.isEditable && !(editor.state.selection instanceof NodeSelection);
  const alignments = available
    ? new Set([...currentSelectionTextblocks().values()].map(node => node.attrs.textAlign || "left"))
    : new Set();
  const state = {
    ...textColor.formattingState(editor),
    bold: available && editor.isActive("bold"),
    italic: available && editor.isActive("italic"),
    underline: available && editor.isActive("underline"),
    strike: available && editor.isActive("strike"),
    code: available && editor.isActive("code"),
    alignment: alignments.size === 1 ? [...alignments][0] : null,
    checklist: available && editor.isActive("taskList"),
    bulletList: available && editor.isActive("bulletList"),
    numberList: available && editor.isActive("orderedList"),
  };
  const signature = JSON.stringify(state);
  if (!force && signature === lastFormattingStateSignature) return;
  lastFormattingStateSignature = signature;
  postToSwift("formattingState", state);
}

function setCurrentTextblockAttribute(attribute, value) {
  const { state, view } = editor;
  const positions = currentSelectionTextblocks();

  if (!positions.size) return false;

  let transaction = state.tr;
  positions.forEach((node, position) => {
    if (!Object.prototype.hasOwnProperty.call(node.attrs || {}, attribute)) return;
    const nextValue = typeof value === "function" ? value(node) : value;
    transaction = transaction.setNodeMarkup(position, undefined, {
      ...node.attrs,
      [attribute]: nextValue,
    });
  });
  view.dispatch(transaction.scrollIntoView());
  view.focus();
  return true;
}

function indentCurrentPlainCallout(direction) {
  const { state, view } = editor;
  const { $from, from, to } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "callout") return false;
    if (node.type.name !== "plainCallout") continue;
    const position = $from.before(depth);
    if (from < position || to > position + node.nodeSize) return false;
    const indent = Math.max(0, Math.min(6, (Number(node.attrs.indent) || 0) + direction));
    view.dispatch(state.tr.setNodeMarkup(position, undefined, { ...node.attrs, indent }).scrollIntoView());
    view.focus();
    return true;
  }
  return false;
}

function currentTextblockRange() {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).isTextblock) {
      return { from: $from.start(depth), to: $from.end(depth) };
    }
  }
  return null;
}

function rangeFullyHasMark(documentNode, from, to, markType) {
  let hasText = false;
  let everyTextNodeHasMark = true;
  documentNode.nodesBetween(from, to, (node, position) => {
    if (!node.isText) return;
    const overlapStart = Math.max(from, position);
    const overlapEnd = Math.min(to, position + node.nodeSize);
    if (overlapStart >= overlapEnd) return;
    hasText = true;
    if (!markType.isInSet(node.marks)) everyTextNodeHasMark = false;
  });
  return hasText && everyTextNodeHasMark;
}

function toggleMarkForCurrentSelection(markName) {
  const { state, view } = editor;
  if (!state.selection.empty) {
    return editor.chain().focus().toggleMark(markName).run();
  }

  const range = currentTextblockRange();
  const markType = state.schema.marks[markName];
  if (!range || !markType || range.from === range.to) {
    return editor.chain().focus().toggleMark(markName).run();
  }

  const transaction = rangeFullyHasMark(state.doc, range.from, range.to, markType)
    ? state.tr.removeMark(range.from, range.to, markType)
    : state.tr.addMark(range.from, range.to, markType.create());
  view.dispatch(transaction.scrollIntoView());
  view.focus();
  return true;
}

function currentStructuralBlockContext() {
  const { $from } = editor.state.selection;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const parentDepth = depth - 1;
    const parent = $from.node(parentDepth);
    const node = $from.node(depth);
    if (
      node.isBlock &&
      (parent.type.name === "doc" || parent.type.name === "toggleItem")
    ) {
      return {
        $from,
        depth,
        parentDepth,
        parent,
        node,
        index: $from.index(parentDepth),
        position: $from.before(depth),
      };
    }
  }

  return null;
}

function restoreSelectionAfterBlockMove(transaction, oldPosition, newPosition) {
  const { anchor, head } = editor.state.selection;
  const documentEnd = transaction.doc.content.size;
  const mappedAnchor = Math.max(
    0,
    Math.min(documentEnd, newPosition + (anchor - oldPosition)),
  );
  const mappedHead = Math.max(
    0,
    Math.min(documentEnd, newPosition + (head - oldPosition)),
  );
  transaction.setSelection(TextSelection.between(
    transaction.doc.resolve(mappedAnchor),
    transaction.doc.resolve(mappedHead),
    1,
  ));
}

function indentCurrentBlockIntoPreviousToggle() {
  const context = currentStructuralBlockContext();
  if (!context || context.index === 0) return false;

  const { selection } = editor.state;
  if (
    selection.from < context.position ||
    selection.to > context.position + context.node.nodeSize
  ) {
    return false;
  }

  const previousNode = context.parent.child(context.index - 1);
  if (previousNode.type.name !== "toggleItem") return false;

  const { state, view } = editor;
  const previousPosition = context.position - previousNode.nodeSize;
  const insertAt = previousPosition + previousNode.nodeSize - 1;
  let transaction = state.tr;

  if (previousNode.attrs.open === false) {
    transaction = transaction.setNodeMarkup(previousPosition, undefined, {
      ...previousNode.attrs,
      open: true,
    });
  }

  transaction = transaction
    .delete(context.position, context.position + context.node.nodeSize)
    .insert(insertAt, context.node);
  restoreSelectionAfterBlockMove(transaction, context.position, insertAt);
  view.dispatch(transaction.scrollIntoView());
  view.focus();
  return true;
}

function outdentCurrentBlockFromToggle() {
  const context = currentStructuralBlockContext();
  if (
    !context ||
    context.parent.type.name !== "toggleItem" ||
    context.index === 0
  ) {
    return false;
  }

  const { selection } = editor.state;
  if (
    selection.from < context.position ||
    selection.to > context.position + context.node.nodeSize
  ) {
    return false;
  }

  const { state, view } = editor;
  const togglePosition = context.$from.before(context.parentDepth);
  const toggleEnd = togglePosition + context.parent.nodeSize;
  let transaction = state.tr.delete(
    context.position,
    context.position + context.node.nodeSize,
  );
  const insertAt = transaction.mapping.map(toggleEnd, -1);
  transaction = transaction.insert(insertAt, context.node);
  restoreSelectionAfterBlockMove(transaction, context.position, insertAt);
  view.dispatch(transaction.scrollIntoView());
  view.focus();
  return true;
}

function formatCurrentSelection(action, value = null) {
  if (selectionMode !== "off" || !editor.isEditable) return false;

  switch (action) {
    case "bold":
    case "italic":
    case "underline":
    case "strike":
    case "code":
      return toggleMarkForCurrentSelection(action);
    case "align":
      return setCurrentTextblockAttribute("textAlign", value || "left");
    case "indent": {
      if (editor.chain().focus().sinkListItem("listItem").run()) return true;
      if (editor.chain().focus().sinkListItem("taskItem").run()) return true;
      if (indentCurrentBlockIntoPreviousToggle()) return true;
      if (indentCurrentPlainCallout(1)) return true;
      return setCurrentTextblockAttribute("indent", (node) =>
        Math.min(6, (Number(node.attrs?.indent) || 0) + 1));
    }
    case "outdent": {
      if (editor.chain().focus().liftListItem("listItem").run()) return true;
      if (editor.chain().focus().liftListItem("taskItem").run()) return true;
      if (outdentCurrentBlockFromToggle()) return true;
      if (indentCurrentPlainCallout(-1)) return true;
      return setCurrentTextblockAttribute("indent", (node) =>
        Math.max(0, (Number(node.attrs?.indent) || 0) - 1));
    }
    case "checkList":
      return editor.chain().focus().toggleTaskList().run();
    case "bulletList":
      return editor.chain().focus().toggleBulletList().run();
    case "numberList":
      return editor.chain().focus().toggleOrderedList().run();
    default:
      return false;
  }
}

function deleteSelected() {
  if (window.PennedBlockSelection?.deleteSelected()) { postToSwift("snapshot", snapshotPayload()); return; }
  const selectedByPath = selectedBlockIndexMap();
  if (!selectedByPath.size) {
    postToSwift("error", { message: "Select at least one block first." });
    return;
  }
  const nextDocument = normalizeTipTapDocument(editor.getJSON());
  const deleteNodes = (nodes, parentPath = []) => nodes.flatMap((node, index) => {
    const path = [...parentPath, index];
    if (selectedByPath.has(pathKey(path))) return [];
    if (!node.content) return [node];
    const content = deleteNodes(node.content, path);
    if (listContainerType(node.type) && !content.length) return [];
    return [{ ...node, content }];
  });
  nextDocument.content = deleteNodes(nextDocument.content);
  const fileOperation = containsAttachments([...selectedByPath.values()].map(block => block.json));
  if (fileOperation) editor.view.dispatch(closeHistory(editor.state.tr));
  selection.clear();
  commitDocument(nextDocument.content.length ? nextDocument : normalizeTipTapDocument(null));
  if (fileOperation) { editor.view.dispatch(closeHistory(editor.state.tr)); postToSwift("snapshot", snapshotPayload()); }
}

function duplicateSelected() {
  const selectedByPath = selectedBlockIndexMap();
  if (!selectedByPath.size) {
    postToSwift("error", { message: "Select at least one block first." });
    return;
  }
  const nextDocument = normalizeTipTapDocument(editor.getJSON());
  const fileOperation = containsAttachments([...selectedByPath.values()].map(block => block.json));
  const copyFileBlock = node => ({ ...node, ...(node.attrs ? { attrs: { ...node.attrs, id: id() } } : {}),
    ...(node.content ? { content: node.content.map(copyFileBlock) } : {}) });
  const duplicateNodes = (nodes, parentPath = []) => nodes.flatMap((node, index) => {
    const path = [...parentPath, index];
    const nodeWithChildren = node.content ? { ...node, content: duplicateNodes(node.content, path) } : node;
    if (!selectedByPath.has(pathKey(path))) return [nodeWithChildren];
    return [nodeWithChildren, normalizeTipTapNode(fileOperation ? copyFileBlock(nodeWithChildren) : JSON.parse(JSON.stringify(nodeWithChildren)))];
  });
  nextDocument.content = duplicateNodes(nextDocument.content);
  if (fileOperation) editor.view.dispatch(closeHistory(editor.state.tr));
  selection.clear();
  commitDocument(nextDocument);
  if (fileOperation) { editor.view.dispatch(closeHistory(editor.state.tr)); postToSwift("snapshot", snapshotPayload()); }
}

async function copySelected() {
  const blocks = selectedBlocks();
  if (!blocks) return false;
  const copiedFiles = await attachments.copyBlocks(editor, blocks, plainText(blocks));
  if (copiedFiles !== undefined) return copiedFiles;
  try {
    await navigator.clipboard?.writeText(plainText(blocks) || JSON.stringify(blocks));
    return true;
  } catch (_e) { return false; }
}

async function cutSelected() {
  const document = editor.state.doc, keys = [...selection].sort().join("|");
  if (!await copySelected() || editor.state.doc !== document || [...selection].sort().join("|") !== keys) return false;
  deleteSelected();
  return true;
}

function requestSubpage() {
  const blocks = selectedBlocks();
  if (!blocks) return;
  postToSwift("selectedBlocksForSubpage", {
    title: plainText(blocks).trim() || "New Sub Page",
    document: normalizeTipTapDocument({ type: "doc", content: blocks }),
  });
}

function insertNode(node) {
  const nextDocument = normalizeTipTapDocument(editor.getJSON());
  nextDocument.content.push(normalizeTipTapNode(node));
  commitDocument(nextDocument);
}

function blockNodeForKey(key) {
  if (key.startsWith("property:")) {
    return { type: "inlineProperty", attrs: { id: id(), property: normalizeProperty({ kind: key.slice(9) }) } };
  }
  switch (key) {
    case "caption":
      return { type: "caption", attrs: { id: id() } };
    case "heading1":
      return { type: "heading", attrs: { id: id(), level: 1 } };
    case "heading2":
      return { type: "heading", attrs: { id: id(), level: 2 } };
    case "heading3":
      return { type: "heading", attrs: { id: id(), level: 3 } };
    case "heading4":
      return { type: "heading", attrs: { id: id(), level: 4 } };
    case "heading5":
      return { type: "heading", attrs: { id: id(), level: 5 } };
    case "toggleListItem":
      return { type: "toggleItem", attrs: { id: id(), open: true }, content: [paragraph()] };
    case "toggleHeading1":
      return {
        type: "toggleItem",
        attrs: { id: id(), open: true },
        content: [{ type: "heading", attrs: { id: id(), level: 1 } }],
      };
    case "toggleHeading2":
      return {
        type: "toggleItem",
        attrs: { id: id(), open: true },
        content: [{ type: "heading", attrs: { id: id(), level: 2 } }],
      };
    case "toggleHeading3":
      return {
        type: "toggleItem",
        attrs: { id: id(), open: true },
        content: [{ type: "heading", attrs: { id: id(), level: 3 } }],
      };
    case "toggleHeading4":
      return {
        type: "toggleItem",
        attrs: { id: id(), open: true },
        content: [{ type: "heading", attrs: { id: id(), level: 4 } }],
      };
    case "toggleHeading5":
      return {
        type: "toggleItem",
        attrs: { id: id(), open: true },
        content: [{ type: "heading", attrs: { id: id(), level: 5 } }],
      };
    case "callout":
      return {
        type: "callout",
        attrs: { id: id(), icon: DEFAULT_CALLOUT_ICON, color: DEFAULT_CALLOUT_COLOR },
        content: [paragraph()],
      };
    case "plainCallout":
      return { type: "plainCallout", attrs: { id: id(), color: DEFAULT_CALLOUT_COLOR }, content: [paragraph()] };
    case "quote":
      return { type: "blockquote", attrs: { id: id() }, content: [paragraph()] };
    case "checkListItem":
      return {
        type: "taskList",
        attrs: { id: id() },
        content: [{
          type: "taskItem",
          attrs: { id: id(), checked: false, crossed: false },
          content: [paragraph()],
        }],
      };
    case "bulletListItem":
      return {
        type: "bulletList",
        attrs: { id: id() },
        content: [{ type: "listItem", attrs: { id: id() }, content: [paragraph()] }],
      };
    case "numberedListItem":
      return {
        type: "orderedList",
        attrs: { id: id() },
        content: [{ type: "listItem", attrs: { id: id() }, content: [paragraph()] }],
      };
    case "codeBlock":
      return { type: "codeBlock", attrs: { id: id() } };
    case "divider":
      return { type: "divider", attrs: { id: id(), style: DEFAULT_DIVIDER_STYLE } };
    case "divider:dottedCircles":
    case "divider:tinyDots":
      return { type: "divider", attrs: { id: id(), style: "dottedCircles" } };
    case "divider:thickLine":
      return { type: "divider", attrs: { id: id(), style: "thickLine" } };
    case "divider:thinLine":
      return { type: "divider", attrs: { id: id(), style: "thinLine" } };
    case "divider:fourCircles":
    case "divider:fourDots":
      return { type: "divider", attrs: { id: id(), style: "fourCircles" } };
    case "pageBreak":
      return { type: "pageBreak", attrs: { id: id() } };
    case "paragraph":
    default:
      return paragraph();
  }
}

function insertBlockByKey(key, range = null, color = null) {
  if (key === "collection") {
    if (!editor.isEditable || selectionMode !== "off") return false;
    const blockID = id();
    const node = { type: "collection", attrs: { id: blockID, collectionID: "", documentID: "" } };
    const chain = editor.chain();
    const selectedCollection = editor.state.selection instanceof NodeSelection && editor.state.selection.node.type.name === "collection";
    const inserted = range ? chain.deleteRange(range).insertContent(node).run()
      : selectedCollection ? chain.insertContentAt(editor.state.selection.to, node).run() : chain.insertContent(node).run();
    if (!inserted) return false;
    editor.commands.blur();
    postToSwift("collectionRequest", { action: "create", blockID });
    return true;
  }
  if (key === "table") {
    if (range) editor.chain().deleteRange(range).run();
    return window.VellixTables.command("requestInsert");
  }
  if (key === "nestedPage" || key === "pageCard") {
    if (!editor.isEditable || selectionMode !== "off") return false;
    const blockId = id();
    const node = { type: "pageReference", attrs: { id: blockId, documentID: "" } };
    const insertion = editor.chain();
    const inserted = range ? insertion.deleteRange(range).insertContent(node).run() : insertion.insertContent(node).run();
    if (!inserted) return false;
    editor.commands.blur();
    postToSwift(key === "pageCard" ? "pageCardRequest" : "nestedPageRequest", { blockId });
    return true;
  }
  if (key === "pageBreak") {
    return insertPageBreak(range);
  }

  const node = normalizeTipTapNode(blockNodeForKey(key));
  if (key === "plainCallout" && typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) {
    node.attrs.color = color;
  }
  const selectedProperty = editor.state.selection instanceof NodeSelection &&
    editor.state.selection.node.type.name === "inlineProperty";
  const insertion = editor.chain();
  if (node.type !== "inlineProperty") insertion.focus();
  const command = range
    ? insertion.deleteRange(range).insertContent(node)
    : selectedProperty ? insertion.insertContentAt(editor.state.selection.to, node)
    : insertion.insertContent(node);
  const inserted = command.run();
  if (inserted && node.type === "inlineProperty") {
    editor.commands.blur();
    postToSwift("propertyEditorRequest", { blockId: node.attrs.id, property: node.attrs.property });
  }
  renderCalloutIcons();
  requestAnimationFrame(reportContentHeight);
  return inserted;
}

function insertPageBreak(range = null) {
  const chain = editor.chain().focus();
  if (range) chain.deleteRange(range);

  const inserted = chain
    .command(({ tr, state }) => {
      const breakNode = state.schema.nodes.pageBreak.create({ id: id() });
      const nextParagraph = state.schema.nodes.paragraph.create({ id: id() });
      const { $from } = tr.selection;

      let insertionPosition = tr.selection.to;
      let replaceFrom = null;
      let replaceTo = null;

      if ($from.depth > 0) {
        const topLevelStart = $from.before(1);
        const topLevelNode = tr.doc.nodeAt(topLevelStart);
        if (topLevelNode) {
          const topLevelEnd = topLevelStart + topLevelNode.nodeSize;
          const replaceEmptyBlock =
            topLevelNode.type.name !== "pageBreak" &&
            topLevelNode.type.name !== "inlineProperty" && !plainText(topLevelNode.toJSON()).trim();
          if (replaceEmptyBlock) {
            replaceFrom = topLevelStart;
            replaceTo = topLevelEnd;
            insertionPosition = topLevelStart;
          } else {
            insertionPosition = topLevelEnd;
          }
        }
      }

      if (replaceFrom !== null && replaceTo !== null) {
        tr.replaceWith(replaceFrom, replaceTo, [breakNode, nextParagraph]);
      } else {
        tr.insert(insertionPosition, [breakNode, nextParagraph]);
      }

      const paragraphStart = insertionPosition + breakNode.nodeSize;
      tr.setSelection(TextSelection.near(tr.doc.resolve(paragraphStart + 1), 1));
      return true;
    })
    .run();

  renderCalloutIcons();
  requestAnimationFrame(reportContentHeight);
  return inserted;
}

let slashState = null;
let slashMenuVisible = false;

function slashRangeAtSelection() {
  const { $from } = editor.state.selection;
  const before = $from.parent.textBetween(0, $from.parentOffset, "\n", "\0");
  const match = before.match(/(?:^|\s)\/([a-zA-Z0-9]*)$/);
  if (!match) return null;
  const query = match[1] || "";
  return {
    from: $from.pos - query.length - 1,
    to: $from.pos,
    query,
  };
}

function filteredSlashItems(query) {
  const value = String(query || "").toLowerCase();
  if (!value) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((item) =>
    `${item.title} ${item.detail} ${item.key}`.toLowerCase().includes(value),
  );
}

function hideSlashMenu() {
  slashState = null;
  slashMenuVisible = false;
  postToSwift("slashMenu", { visible: false });
  requestAnimationFrame(reportContentHeight);
}

function renderSlashMenu() {
  if (!slashState) return;
  const items = filteredSlashItems(slashState.query);
  if (!items.length) {
    hideSlashMenu();
    return;
  }

  slashState.index = Math.max(0, Math.min(slashState.index, items.length - 1));
  slashMenuVisible = true;

  const visualViewport = window.visualViewport;
  const viewportLeft = visualViewport?.offsetLeft ?? 0;
  const viewportTop = visualViewport?.offsetTop ?? 0;
  const viewportWidth = visualViewport?.width ?? window.innerWidth;
  const coords = editor.view.coordsAtPos(slashState.range.to);
  const rowHeight = 62;
  const visibleRows = Math.min(items.length, 5);
  const naturalMaxHeight = 14 + visibleRows * rowHeight;
  const menuMaxHeight = Math.min(324, naturalMaxHeight);
  const menuWidth = Math.min(342, Math.max(280, viewportWidth - 28));
  const gutter = 14;
  const topGutter = 10;
  const viewportRight = viewportLeft + viewportWidth;
  const left = Math.min(
    viewportRight - menuWidth - gutter,
    Math.max(viewportLeft + gutter, coords.left),
  );
  const top = Math.max(viewportTop + topGutter, coords.bottom + topGutter);

  postToSwift("slashMenu", {
    visible: true,
    query: slashState.query,
    selectedIndex: slashState.index,
    anchorX: left,
    anchorY: top,
    width: menuWidth,
    maxHeight: menuMaxHeight,
    items: items.map((item) => ({
      key: item.key,
      title: item.title,
      detail: item.detail,
      icon: item.icon,
    })),
  });
  requestAnimationFrame(reportContentHeight);
}

function updateSlashMenu() {
  if (selectionMode !== "off") {
    hideSlashMenu();
    return;
  }
  const range = slashRangeAtSelection();
  if (!range) {
    hideSlashMenu();
    return;
  }
  slashState = { range, query: range.query, index: slashState?.index || 0 };
  renderSlashMenu();
}

function topLevelInsertionPositionAtY(clientY) {
  let insertionPosition = editor.state.doc.content.size;
  let foundPosition = false;

  editor.state.doc.forEach((_node, offset) => {
    if (foundPosition) return;
    const element = editor.view.nodeDOM(offset);
    if (!(element instanceof HTMLElement)) return;

    const rect = element.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      insertionPosition = offset;
      foundPosition = true;
    }
  });

  return insertionPosition;
}

function paragraphTextBounds(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rectangles = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  if (!rectangles.length) return element.getBoundingClientRect();
  return {
    top: Math.min(...rectangles.map((rect) => rect.top)),
    bottom: Math.max(...rectangles.map((rect) => rect.bottom)),
  };
}

function paragraphGapInsertionPositionAtPoint(target, clientX, clientY) {
  const content = editor.view.dom;
  if (!content.contains(target)) return null;
  if (target.closest("button, a, input, textarea, select, [contenteditable='false'], table, .vellix-table-wrapper")) return null;

  const closestParagraph = target.closest("p");
  const paragraphs = closestParagraph ? [closestParagraph] : Array.from(target.children).filter((element) => element.tagName === "P");
  for (const paragraphElement of paragraphs) {
    const start = editor.view.posAtDOM(paragraphElement, 0);
    const resolved = editor.state.doc.resolve(start);
    if (resolved.parent.type.name !== "paragraph" || resolved.depth < 1) continue;
    const parent = resolved.node(resolved.depth - 1);
    const index = resolved.index(resolved.depth - 1);
    const paragraphPosition = resolved.before();

    // Check only sibling paragraph boundaries, including paragraphs inside editable containers.
    for (const leftIndex of [index - 1, index]) {
      if (leftIndex < 0 || leftIndex + 1 >= parent.childCount) continue;
      const left = parent.child(leftIndex);
      const right = parent.child(leftIndex + 1);
      if (left.type.name !== "paragraph" || right.type.name !== "paragraph") continue;
      const leftPosition = leftIndex === index ? paragraphPosition : paragraphPosition - left.nodeSize;
      const rightPosition = leftPosition + left.nodeSize;
      const leftElement = editor.view.nodeDOM(leftPosition);
      const rightElement = editor.view.nodeDOM(rightPosition);
      if (!(leftElement instanceof HTMLElement) || !(rightElement instanceof HTMLElement)) continue;
      const leftRect = leftElement.getBoundingClientRect();
      const rightRect = rightElement.getBoundingClientRect();
      if (leftRect.height <= 0 || rightRect.height <= 0) continue;
      if (clientX < Math.max(leftRect.left, rightRect.left) || clientX > Math.min(leftRect.right, rightRect.right)) continue;
      const gapStart = paragraphTextBounds(leftElement).bottom;
      const gapEnd = paragraphTextBounds(rightElement).top;
      if (clientY >= gapStart && clientY < gapEnd) return rightPosition;
    }
  }
  return null;
}

function placeCaretInParagraphAt(position) {
  editor.view.focus();

  const state = editor.view.state;
  const insertionPosition = Math.max(0, Math.min(position, state.doc.content.size));
  const resolved = state.doc.resolve(insertionPosition);
  const paragraphType = state.schema.nodes.paragraph;
  if (!paragraphType || !resolved.parent.canReplaceWith(resolved.index(), resolved.index(), paragraphType)) return false;

  if (resolved.nodeAfter?.type === paragraphType && !resolved.nodeAfter.content.size) {
    editor.view.dispatch(
      state.tr
        .setSelection(TextSelection.create(state.doc, insertionPosition + 1))
        .setMeta("pointer", true),
    );
    return true;
  }

  if (resolved.nodeBefore?.type === paragraphType && !resolved.nodeBefore.content.size) {
    const paragraphStart = insertionPosition - resolved.nodeBefore.nodeSize;
    editor.view.dispatch(
      state.tr
        .setSelection(TextSelection.create(state.doc, paragraphStart + 1))
        .setMeta("pointer", true),
    );
    return true;
  }

  const nextParagraph = paragraphType.create({ id: id() });
  const transaction = closeHistory(state.tr.insert(insertionPosition, nextParagraph));
  transaction.setSelection(TextSelection.create(transaction.doc, insertionPosition + 1));
  transaction.setMeta("pointer", true);
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

function focusEditorAtDocumentEnd() {
  if (selectionMode !== "off" || !editor.isEditable) return false;
  return placeCaretInParagraphAt(editor.state.doc.content.size);
}

function focusAfterInlineProperty(blockId) {
  if (selectionMode !== "off" || !editor.isEditable) return false;
  let afterProperty = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "inlineProperty" && node.attrs.id === blockId) afterProperty = pos + node.nodeSize;
  });
  const state = editor.state;
  if (afterProperty !== null) {
    // Returning from a sheet may focus existing text, but must never create content.
    if (!state.doc.resolve(afterProperty).nodeAfter?.isTextblock) return false;
    editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, afterProperty + 1)).scrollIntoView());
  } else if (!state.selection.$from.parent.isTextblock) {
    return false;
  }
  editor.view.focus();
  return true;
}

function insertParagraphFromEmptySurface(event) {
  if (selectionMode !== "off" || !editor.isEditable || event.defaultPrevented) return false;

  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;

  const content = editor.view.dom;
  const gapPosition = paragraphGapInsertionPositionAtPoint(target, event.clientX, event.clientY);
  const isEmptyEditorSurface =
    target === content ||
    target.id === "editor" ||
    target.classList.contains("vellix-editor-page") ||
    target.classList.contains("vellix-editor-shell") ||
    target === document.body ||
    target === document.documentElement;
  if (!isEmptyEditorSurface && gapPosition === null) return false;

  const handled = placeCaretInParagraphAt(gapPosition ?? topLevelInsertionPositionAtY(event.clientY));
  if (handled) event.preventDefault();
  return handled;
}

function chooseSlashItem(key) {
  if (!slashState) return false;
  const range = slashState.range;
  hideSlashMenu();
  if (key === "inlineCode") {
    return editor.chain().focus().deleteRange(range).toggleMark("code").run();
  }
  if (key === "underline") {
    return editor.chain().focus().deleteRange(range).toggleMark("underline").run();
  }
  return insertBlockByKey(key, range);
}

editor.on("selectionUpdate", updateSlashMenu);
editor.on("update", updateSlashMenu);
// Transactions also cover stored marks, undo/redo, and programmatic selection changes.
editor.on("transaction", () => reportFormattingState());
editor.on("focus", () => reportFormattingState());
editor.on("blur", () => reportFormattingState());

const blockActions = createBlockActions({ editor, blocks: topLevelModelBlocks, elementForBlock: elementForModelBlock,
  selectionActive: () => selectionMode !== "off", post: postToSwift, snapshot: snapshotPayload });

// ProseMirror re-renders nodeViews (especially inside taskLists) on every doc
// change, which wipes DOM attributes we set for selection UI. Re-apply the
// selection classes whenever the document changes while selection mode is on.
editor.on("update", () => {
  if (selectionMode !== "off") setSelectionClasses();
});

window.visualViewport?.addEventListener("resize", () => {
  if (slashState && slashMenuVisible) renderSlashMenu();
});
window.visualViewport?.addEventListener("scroll", () => {
  if (slashState && slashMenuVisible) renderSlashMenu();
});

document.addEventListener("keydown", (event) => {
  if (!slashState || !slashMenuVisible) return;
  const items = filteredSlashItems(slashState.query);
  if (!items.length) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    slashState.index = (slashState.index + 1) % items.length;
    renderSlashMenu();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    slashState.index = (slashState.index - 1 + items.length) % items.length;
    renderSlashMenu();
  } else if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    chooseSlashItem(items[slashState.index]?.key);
  } else if (event.key === "Escape") {
    event.preventDefault();
    hideSlashMenu();
  }
});

document.addEventListener("mousedown", (event) => {
  if (selectionMode === "off" && event.target.closest?.(".vellix-callout-icon-button, .vellix-plain-callout-color-button")) {
    event.preventDefault();
  }
});

if (!window.PennedBlockSelection) document.addEventListener(
  "pointerdown",
  (event) => {
    handleSelectionHandleEvent(event);
  },
  { capture: true },
);

document.addEventListener("click", (event) => {
  if (selectionMode !== "off" && handleSelectionHandleEvent(event)) return;

  const colorButton = event.target.closest?.(".vellix-plain-callout-color-button");
  if (colorButton) {
    event.preventDefault();
    event.stopPropagation();
    if (selectionMode !== "off" || !editor.isEditable) return;
    const callout = colorButton.closest(".vellix-plain-callout");
    postToSwift("calloutColorPickerRequest", {
      blockId: callout?.dataset.vellixBlockId || "",
      currentColor: callout?.dataset.calloutColor || DEFAULT_CALLOUT_COLOR,
    });
    return;
  }

  const iconButton = event.target.closest?.(".vellix-callout-icon-button");
  if (iconButton) {
    const callout = iconButton.closest(".vellix-callout");
    const blockId = callout?.dataset.vellixBlockId || "";
    event.preventDefault();
    event.stopPropagation();
    postToSwift("iconPickerRequest", {
      blockId,
      currentIcon: callout?.dataset.calloutIcon || DEFAULT_CALLOUT_ICON,
      currentColor: callout?.dataset.calloutColor || DEFAULT_CALLOUT_COLOR,
    });
    return;
  }

  if (selectionMode === "off" && insertParagraphFromEmptySurface(event)) return;

  if (selectionMode === "off") return;

  if (editor.view.dom.contains(event.target)) return;
});

const resizeObserver = new ResizeObserver(() => {
  requestAnimationFrame(reportContentHeight);
  caretTracking.schedule();
});
resizeObserver.observe(document.documentElement);

window.tiptapCommand = async function tiptapCommand(name, args = {}) {
  const colorResult = textColor.command(editor, name, args);
  if (colorResult !== undefined) return colorResult;
  const pennedSelectionResult = window.PennedBlockSelection?.command(name, args);
  if (pennedSelectionResult !== undefined) return pennedSelectionResult;
  const tagResult = await documentTags.command(editor, name, args);
  if (tagResult !== undefined) return tagResult;
  try {
    const attachmentResult = attachments.command(editor, name, args);
    if (attachmentResult !== undefined) return attachmentResult;
    const result = templateComponents.command(editor, name, args);
    if (result !== undefined) return result;
  } catch (error) { postToSwift("error", { message: error.message }); return false; }
  if (name === "deleteBlock") return blockActions.remove(args.token);
  if (name === "dismissBlockActions") return blockActions.dismiss(args.token);
  if (name === "setContent" || name === "setEditable" || name === "setSelectionMode") blockActions.reset();
  const taskResult = taskCommand(editor, name, args, postToSwift, normalizeTipTapDocument);
  if (taskResult !== null) return taskResult;
  if (name === "formatCurrentSelection" && editor.state.selection instanceof NodeSelection &&
      editor.state.selection.node.type.name === "inlineProperty") return false;
  if (name === "updateInlineProperty" || name === "deleteInlineProperty") {
    if (!editor.isEditable || selectionMode !== "off") return false;
    let position = null;
    let target = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "inlineProperty" && node.attrs.id === args.blockId) {
        position = pos;
        target = node;
      }
    });
    if (!target) return false;
    const transaction = editor.state.tr;
    if (name === "deleteInlineProperty") transaction.delete(position, position + target.nodeSize);
    else transaction.setNodeMarkup(position, undefined, { ...target.attrs, property: normalizeProperty(args.property) });
    editor.view.dispatch(transaction);
    return true;
  }
  if (name === "updateBlockquoteColor") {
    return updateBlockquoteColor(args.blockId, args.color);
  }
  const focusedChain = () => editor.chain().focus();
  switch (name) {
    case "preparePresentation": {
      if (args.appearance) applyAppearance(args.appearance);
      setPageReferences(args.pages || []);
      setCollections(args.collections || []);
      attachments.command(editor, "setAttachments", { files: args.files || [] });
      const result = await prepareDocumentPresentation(editor.view.dom, document);
      reportContentHeight();
      return result;
    }
    case "setNativeCollectionHeight": {
      const resized = setNativeCollectionHeight(args);
      if (resized) requestAnimationFrame(reportContentHeight);
      return resized;
    }
    case "setCollections":
      setCollections(args.collections);
      requestAnimationFrame(reportContentHeight);
      return true;
    case "resolveCollection": {
      let target = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "collection" && node.attrs.id === args.blockID) target = { node, pos };
      });
      if (!target) return false;
      const transaction = editor.state.tr;
      if (!args.collectionID) {
        if (target.node.attrs.collectionID) return false;
        transaction.delete(target.pos, target.pos + target.node.nodeSize);
      } else transaction.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, collectionID: args.collectionID, documentID: args.documentID });
      editor.view.dispatch(transaction);
      postToSwift("snapshot", snapshotPayload());
      return true;
    }
    case "setPageReferences":
      setPageReferences(args.pages);
      requestAnimationFrame(reportContentHeight);
      return true;
    case "resolvePageReference": {
      let target = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "pageReference" && node.attrs.id === args.blockId) target = { node, pos };
      });
      if (!target) return false;
      const tr = editor.state.tr;
      if (!args.documentId) tr.delete(target.pos, target.pos + target.node.nodeSize);
      else tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, documentID: args.documentId });
      editor.view.dispatch(tr);
      postToSwift("snapshot", snapshotPayload());
      if (args.documentId) postToSwift("pageOpenRequest", { documentId: args.documentId });
      return true;
    }
    case "setContent":
      lastNativeCollectionSignature = "";
      {
        const normalizedDocument = normalizeLoadedTipTapDocument(args.document ?? args);
        traceCalloutAttrs("command-setContent-before-setContent", normalizedDocument);
        editor.chain().setContent(normalizedDocument, { emitUpdate: false }).command(({ tr }) => {
          tr.setDocAttribute("taskHistoryProjection", normalizedDocument.attrs?.taskHistoryProjection ?? null);
          return true;
        }).run();
        traceCalloutAttrs("command-setContent-after-setContent", editor.getJSON());
	      }
		      setSelectionMode("off");
		      renderCalloutIcons();
		      reportFormattingState(true);
	      requestAnimationFrame(reportContentHeight);
	      return true;
    case "setEditable":
      editor.setEditable(args.editable === true, false);
      templateComponents.refresh();
      reportFormattingState();
      return true;
    case "focus":
      editor.commands.focus("end");
      return true;
    case "focusDocumentEnd":
      return focusEditorAtDocumentEnd();
    case "reportCaret":
      caretTracking.schedule();
      return true;
    case "focusAfterInlineProperty":
      return focusAfterInlineProperty(args.blockId);
    case "blur":
      editor.commands.blur();
      return true;
    case "undo":
      return focusedChain().undo().run();
    case "redo":
      return focusedChain().redo().run();
    case "setAppearance":
      applyAppearance(args);
      requestAnimationFrame(reportContentHeight);
      return true;
    case "registerIconAsset":
      {
        const icon = normalizedIconName(args.icon);
        const src = typeof args.src === "string" ? args.src.trim() : "";
        if (src) {
          vellixIconAssets.set(icon, src);
          setRegisteredIconCSSVariable(icon, src);
          traceDiag("icon-asset-registered", { icon, bytes: src.length });
          renderCalloutIcons();
          if (slashState && slashMenuVisible) renderSlashMenu();
        }
      }
      return true;
    case "registerIconAssets":
      {
        const assets = args.assets && typeof args.assets === "object" ? args.assets : {};
        let registered = 0;
        for (const [rawIcon, rawSrc] of Object.entries(assets)) {
          const icon = normalizedIconName(rawIcon);
          const src = typeof rawSrc === "string" ? rawSrc.trim() : "";
          if (!src) continue;
          vellixIconAssets.set(icon, src);
          setRegisteredIconCSSVariable(icon, src);
          registered += 1;
        }
        traceDiag("icon-assets-registered-bulk", { count: registered });
        renderCalloutIcons();
        if (slashState && slashMenuVisible) renderSlashMenu();
      }
      return true;
    case "chooseSlashItem":
      return chooseSlashItem(args.key || "");
    case "insertDivider":
      insertNode({ type: "divider", attrs: { id: id(), style: normalizedDividerStyle(args.style) } });
      return true;
    case "insertPageBreak":
      return insertBlockByKey("pageBreak");
	    case "insertCallout":
	      return focusedChain()
	        .insertVellixCallout({
	          icon: args.icon || DEFAULT_CALLOUT_ICON,
	          color: args.color || DEFAULT_CALLOUT_COLOR,
	          text: args.text || "",
	        })
	        .run();
	    case "insertBlock":
	      return insertBlockByKey(args.blockType || "paragraph", null, args.color);
	    case "setSelectedBlockType":
	      transformSelectedBlocks(args.blockType, args);
	      return true;
	    case "setSelectedCalloutColor":
	      updateSelectedCalloutColor(args.color || DEFAULT_CALLOUT_COLOR);
	      return true;
	    case "formatSelectedBlocks":
	      formatSelectedBlocks(args.action, args.value);
	      return true;
      case "formatCurrentSelection":
        return formatCurrentSelection(args.action, args.value);
      case "toggleTextMark":
        return editor.chain().focus().toggleMark(args.mark === "codeUnderline" ? "code" : (args.mark || "code")).run();
	    case "updateCalloutIcon":
	      updateCalloutIcon(args.blockId, args.icon);
	      return true;
	    case "updateCalloutColor":
	      updateCalloutColor(args.blockId, args.color);
	      return true;
    case "indentSelectedBlocks":
      return focusedChain().sinkListItem("listItem").run() || focusedChain().sinkListItem("taskItem").run();
    case "outdentSelectedBlocks":
      return focusedChain().liftListItem("listItem").run() || focusedChain().liftListItem("taskItem").run();
	    case "selectAllBlocks":
	      setSelectionMode("multi");
	      selection.clear();
	      topLevelModelBlocks().forEach((block) => selection.add(block.key));
	      setSelectionClasses();
	      return true;
	    case "setSelectionMode":
	      setSelectionMode(args.mode);
	      return true;
	    case "clearBlockSelection":
	      setSelectionMode("off");
	      return true;
    case "deleteSelectedBlocks":
      deleteSelected();
      return true;
    case "copySelectedBlocks":
      return await copySelected();
    case "cutSelectedBlocks":
      return await cutSelected();
    case "duplicateSelectedBlocks":
      duplicateSelected();
      return true;
    case "requestSelectedBlocksForSubpage":
      requestSubpage();
      return true;
    case "requestSnapshot":
      postToSwift("snapshot", snapshotPayload());
      return true;
    default:
      return false;
  }
};

window.VellixStructuredPlaceholders.initialize(editor);
window.VellixTables.initialize(editor);
renderCalloutIcons();
setSelectionClasses();
requestAnimationFrame(reportContentHeight);
postToSwift("ready", { blockCount: documentBlocks(editor.getJSON()).length });
reportFormattingState(true);

// Bundle entry for the Vellix TipTap editor.
//
// Same bridge shape as Lurelia:
//   Swift -> JS   window.tiptapCommand(name, args)
//   JS -> Swift   webkit.messageHandlers.tiptap.postMessage({ kind, payload })

import { Editor, Extension, Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";

const DEFAULT_CALLOUT_ICON = "sparkle";
const DEFAULT_CALLOUT_COLOR = "#ffffff";
const vellixIconAssets = new Map();

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

function iconSource(icon, tint = DEFAULT_CALLOUT_COLOR, size = 22) {
  const cleanIcon = normalizedIconName(icon);
  const registeredSource = vellixIconAssets.get(cleanIcon);
  if (registeredSource) return registeredSource;

  const params = new URLSearchParams({
    tint: String(tint || DEFAULT_CALLOUT_COLOR),
    size: String(size),
  });
  return `vellix-icon://asset/${encodeURIComponent(cleanIcon)}?${params.toString()}`;
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
    return { type: "text", text: typeof value.text === "string" ? value.text : "" };
  }

  const attrs = isRecord(value.attrs) ? { ...value.attrs } : {};
  attrs.id = typeof attrs.id === "string" && attrs.id.trim() ? attrs.id.trim() : id();

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
  }

  let content = Array.isArray(value.content)
    ? value.content.map(normalizeTipTapNode).filter((node) => node.type !== "doc")
    : undefined;

  if (type === "callout") {
    const hasBlockContent = content?.some((node) => node.type !== "text" && node.type !== "hardBreak") ?? false;
    content = hasBlockContent ? content : [paragraph(content ?? [])];
  }

  return content ? { type, attrs, content } : { type, attrs };
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
            attrs: { id: id(), checked: props.checked === true },
            content: [paragraph(content)],
          },
        ],
      };
    case "quote":
      return { type: "blockquote", attrs: { id: blockID }, content: [paragraph(content)] };
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
      return { type: "divider", attrs: { id: blockID } };
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
      return { type: "doc", content: content.length ? content : [paragraph()] };
    }

    if (Array.isArray(value.blocks)) {
      return { type: "doc", content: value.blocks.map(importLegacyBlock) };
    }

    if (Array.isArray(value.content)) {
      const content = value.content.map(normalizeTipTapNode).filter((node) => node.type !== "doc");
      return { type: "doc", content: content.length ? content : [paragraph()] };
    }
  }

  if (Array.isArray(value)) {
    return { type: "doc", content: value.map(importLegacyBlock) };
  }

  return { type: "doc", content: [paragraph()] };
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
    iconElement.setAttribute("role", "img");
    iconElement.setAttribute("aria-label", icon);
    iconElement.style.backgroundImage = cssBackgroundImageSource(src);
    iconElement.hidden = false;
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
  const style = document.documentElement.style;
  if (typeof payload.textColor === "string" && payload.textColor.trim()) {
    style.setProperty("--vellix-primary-text", payload.textColor.trim());
  }
  if (typeof payload.fontFamily === "string" && payload.fontFamily.trim()) {
    style.setProperty("--vellix-font-family", payload.fontFamily.trim());
  }
  if (typeof payload.pageBackground === "string" && payload.pageBackground.trim()) {
    style.setProperty("--vellix-page-background", payload.pageBackground.trim());
  }
}

const BlockID = Extension.create({
  name: "vellixBlockID",
  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "heading",
          "blockquote",
          "bulletList",
          "orderedList",
          "listItem",
          "taskList",
          "taskItem",
          "callout",
          "divider",
          "pageBreak",
          "toggleItem",
        ],
        attributes: {
          id: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-vellix-block-id"),
            renderHTML: (attrs) =>
              typeof attrs.id === "string" && attrs.id.trim()
                ? { "data-vellix-block-id": attrs.id }
                : {},
          },
        },
      },
    ];
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
            { from: state.selection.from, to: state.selection.to },
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

const Divider = Node.create({
  name: "divider",
  group: "block",
  atom: true,
  addAttributes() {
    return { id: { default: null } };
  },
  parseHTML() {
    return [{ tag: "hr[data-vellix-divider]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["hr", mergeAttributes(HTMLAttributes, { "data-vellix-divider": "true" })];
  },
});

const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  addAttributes() {
    return { id: { default: null } };
  },
  parseHTML() {
    return [{ tag: "div[data-vellix-page-break]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-vellix-page-break": "true" })];
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
  parseHTML() {
    return [{ tag: "details[data-vellix-toggle]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "details",
      mergeAttributes(HTMLAttributes, {
        "data-vellix-toggle": "true",
        open: HTMLAttributes.open === false ? null : "open",
      }),
      ["summary", { contenteditable: "false" }, ""],
      ["div", { class: "vellix-toggle-content" }, 0],
    ];
  },
});

const selection = new Set();
let lastHeight = -1;
let lastSelectionCount = -1;
let saveTimer;

const editor = new Editor({
  element: document.getElementById("editor"),
  extensions: [
    StarterKit.configure({ horizontalRule: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: "" }),
    BlockID,
    Callout,
    Divider,
    PageBreak,
    ToggleItem,
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

function blockOuters() {
  const ids = new Set(documentBlocks(editor.getJSON()).map(nodeId));
  return Array.from(
    document.querySelectorAll(".tiptap-editor [data-vellix-block-id]"),
  ).filter((outer) => ids.has(outer.dataset.vellixBlockId || ""));
}

function setSelectionClasses() {
  const inSelectionMode = selection.size > 0;
  document.documentElement.classList.toggle("vellix-selection-mode", inSelectionMode);
  document.body?.classList.toggle("vellix-selection-mode", inSelectionMode);
  editor.setEditable(!inSelectionMode, false);

  blockOuters().forEach((outer) => {
    const blockId = outer.dataset.vellixBlockId;
    const selected = blockId ? selection.has(blockId) : false;
    outer.classList.toggle("vellix-selected-block", selected);
    outer.setAttribute("data-vellix-selected", selected ? "true" : "false");
  });

  if (lastSelectionCount !== selection.size) {
    lastSelectionCount = selection.size;
    postToSwift("selection", { count: selection.size });
  }
}

function reportContentHeight() {
  const root = document.querySelector(".vellix-editor-page");
  const measured = blockOuters().filter((outer) => {
    const style = window.getComputedStyle(outer);
    return style.display !== "none" && style.visibility !== "hidden" && outer.getClientRects().length > 0;
  });

  let height = 60;
  if (root && measured.length > 0) {
    const top = root.getBoundingClientRect().top;
    const bottom = Math.max(...measured.map((el) => el.getBoundingClientRect().bottom));
    height = Math.max(60, Math.ceil(bottom - top + 2));
  }

  if (Math.abs(height - lastHeight) > 1) {
    lastHeight = height;
    postToSwift("height", { height });
  }
}

function selectedBlocks() {
  const blocks = documentBlocks(editor.getJSON()).filter((block) => selection.has(nodeId(block)));
  if (!blocks.length) {
    postToSwift("error", { message: "Select at least one block first." });
    return null;
  }
  return blocks;
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
  const content = inlineContent(plainText(node));
  switch (type) {
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
    case "checkListItem":
      return {
        type: "taskList",
        attrs: { id: blockID },
        content: [{ type: "taskItem", attrs: { id: id(), checked: false }, content: [paragraph(content)] }],
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
      return { type: "toggleItem", attrs: { id: blockID, open: true }, content: [paragraph(content)] };
    default:
      return paragraph(content, { id: blockID });
  }
}

function transformSelectedBlocks(type, payload = {}) {
  if (!selectedBlocks()) return;
  const nextDocument = normalizeTipTapDocument(editor.getJSON());
  nextDocument.content = walkTransform(nextDocument.content, (node) =>
    selection.has(nodeId(node)) ? transformNodeToBlock(node, type, payload) : node,
  );
  commitDocument(nextDocument);
}

function updateSelectedCalloutColor(color) {
  if (!selectedBlocks()) return;
  const nextDocument = normalizeTipTapDocument(editor.getJSON());
  nextDocument.content = walkTransform(nextDocument.content, (node) => {
    if (!selection.has(nodeId(node))) return node;
    const callout = transformNodeToBlock(node, "callout", { color });
    return { ...callout, attrs: { ...callout.attrs, color } };
  });
  commitDocument(nextDocument);
}

function updateCalloutIcon(blockId, icon) {
  const targets = new Set(blockId ? [blockId] : selection);
  if (!targets.size && !selectedBlocks()) return;
  const nextDocument = normalizeTipTapDocument(editor.getJSON());
  nextDocument.content = walkTransform(nextDocument.content, (node) =>
    targets.has(nodeId(node)) && node.type === "callout"
      ? { ...node, attrs: { ...node.attrs, icon: icon || DEFAULT_CALLOUT_ICON } }
      : node,
  );
  commitDocument(nextDocument);
}

function deleteSelected() {
  if (!selectedBlocks()) return;
  const nextDocument = normalizeTipTapDocument(editor.getJSON());
  nextDocument.content = walkTransform(nextDocument.content, (node) =>
    selection.has(nodeId(node)) ? null : node,
  );
  selection.clear();
  commitDocument(nextDocument.content.length ? nextDocument : normalizeTipTapDocument(null));
}

function duplicateSelected() {
  const blocks = selectedBlocks();
  if (!blocks) return;
  const nextDocument = normalizeTipTapDocument(editor.getJSON());
  nextDocument.content.push(...blocks.map((block) => normalizeTipTapNode(JSON.parse(JSON.stringify(block)))));
  selection.clear();
  commitDocument(nextDocument);
}

async function copySelected() {
  const blocks = selectedBlocks();
  if (!blocks) return;
  try {
    await navigator.clipboard?.writeText(plainText(blocks) || JSON.stringify(blocks));
  } catch (_e) {}
}

async function cutSelected() {
  await copySelected();
  deleteSelected();
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

document.addEventListener("mousedown", (event) => {
  if (event.target.closest?.(".vellix-callout-icon-button")) {
    event.preventDefault();
  }
});

document.addEventListener("click", (event) => {
  const iconButton = event.target.closest?.(".vellix-callout-icon-button");
  if (iconButton) {
    const callout = iconButton.closest(".vellix-callout");
    const blockId = callout?.dataset.vellixBlockId || "";
    event.preventDefault();
    event.stopPropagation();
    postToSwift("iconPickerRequest", {
      blockId,
      currentIcon: callout?.dataset.calloutIcon || DEFAULT_CALLOUT_ICON,
    });
    return;
  }

  const block = event.target.closest?.("[data-vellix-block-id]");
  if (!block) return;
  const rect = block.getBoundingClientRect();
  const inSelectionRail = event.clientX >= rect.right - 44 && event.clientX <= rect.right + 12;
  if (!inSelectionRail) return;

  event.preventDefault();
  const blockId = block.dataset.vellixBlockId;
  if (!blockId) return;
  if (selection.has(blockId)) {
    selection.delete(blockId);
  } else {
    selection.add(blockId);
  }
  setSelectionClasses();
  postToSwift("haptic", { style: "light" });
});

const resizeObserver = new ResizeObserver(() => requestAnimationFrame(reportContentHeight));
resizeObserver.observe(document.documentElement);

window.tiptapCommand = async function tiptapCommand(name, args = {}) {
  const chain = editor.chain().focus();
  switch (name) {
    case "setContent":
      {
        const normalizedDocument = normalizeTipTapDocument(args.document ?? args);
        traceCalloutAttrs("command-setContent-before-setContent", normalizedDocument);
        editor.commands.setContent(normalizedDocument, { emitUpdate: false });
        traceCalloutAttrs("command-setContent-after-setContent", editor.getJSON());
      }
      selection.clear();
      renderCalloutIcons();
      setSelectionClasses();
      requestAnimationFrame(reportContentHeight);
      return true;
    case "setEditable":
      editor.setEditable(args.editable === true, false);
      return true;
    case "focus":
      editor.commands.focus("end");
      return true;
    case "blur":
      editor.commands.blur();
      return true;
    case "undo":
      return chain.undo().run();
    case "redo":
      return chain.redo().run();
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
          traceDiag("icon-asset-registered", { icon, bytes: src.length });
          renderCalloutIcons();
        }
      }
      return true;
    case "insertDivider":
      insertNode({ type: "divider", attrs: { id: id() } });
      return true;
    case "insertPageBreak":
      insertNode({ type: "pageBreak", attrs: { id: id() } });
      return true;
    case "insertCallout":
      return chain
        .insertVellixCallout({
          icon: args.icon || DEFAULT_CALLOUT_ICON,
          color: args.color || DEFAULT_CALLOUT_COLOR,
          text: args.text || "",
        })
        .run();
    case "setSelectedBlockType":
      transformSelectedBlocks(args.blockType, args);
      return true;
    case "setSelectedCalloutColor":
      updateSelectedCalloutColor(args.color || DEFAULT_CALLOUT_COLOR);
      return true;
    case "updateCalloutIcon":
      updateCalloutIcon(args.blockId, args.icon);
      return true;
    case "indentSelectedBlocks":
      return chain.sinkListItem("listItem").run() || chain.sinkListItem("taskItem").run();
    case "outdentSelectedBlocks":
      return chain.liftListItem("listItem").run() || chain.liftListItem("taskItem").run();
    case "selectAllBlocks":
      selection.clear();
      documentBlocks(editor.getJSON()).forEach((block) => selection.add(nodeId(block)));
      setSelectionClasses();
      return true;
    case "clearBlockSelection":
      selection.clear();
      setSelectionClasses();
      return true;
    case "deleteSelectedBlocks":
      deleteSelected();
      return true;
    case "copySelectedBlocks":
      await copySelected();
      return true;
    case "cutSelectedBlocks":
      await cutSelected();
      return true;
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

renderCalloutIcons();
setSelectionClasses();
requestAnimationFrame(reportContentHeight);
postToSwift("ready", { blockCount: documentBlocks(editor.getJSON()).length });

import { Node, Extension } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { changedRanges } from "./incremental-nodes.js";
import { placeCaretInSlot } from "./caret-slots.js";
import { calloutWidth, calloutRowMetrics } from "./callout-layout.js";

export const calloutWidthAttribute = {
  default: null,
  parseHTML: element => calloutWidth(element.getAttribute("data-callout-width")),
  renderHTML: attrs => {
    const width = calloutWidth(attrs.widthPercent);
    return width ? { "data-callout-width": String(width), style: `--penned-callout-width:${width}%;` } : {};
  },
};

export function calloutRow({ selectionActive }) {
  return Node.create({
    name: "plainCalloutRow", group: "block", content: "block*", defining: true, selectable: false,
    addAttributes: () => ({ id: { default: null } }),
    parseHTML: () => [{ tag: "div[data-plain-callout-row]", contentElement: ".penned-callout-row-content" }],
    renderHTML: ({ HTMLAttributes, node }) => ["div", { ...HTMLAttributes, "data-plain-callout-row": "", class: "penned-callout-row",
      style: `--penned-callout-gap-share:${calloutRowMetrics(node.content.content).gapShare}px;` },
      ["div", { class: "penned-callout-row-content" }, 0]],
    addNodeView() {
      return ({ node, editor, getPos }) => {
        let current = node;
        const dom = document.createElement("div"), contentDOM = document.createElement("div");
        dom.className = "penned-callout-row"; dom.dataset.plainCalloutRow = "";
        contentDOM.className = "penned-callout-row-content";
        const space = document.createElement("div");
        space.className = "penned-callout-space"; space.contentEditable = "false";
        space.setAttribute("aria-label", "Insert beside callout");
        dom.append(contentDOM, space);
        const refresh = () => {
          const metrics = calloutRowMetrics(current.content.content);
          dom.style.setProperty("--penned-callout-gap-share", `${metrics.gapShare}px`);
          space.hidden = metrics.remaining <= 1;
          space.style.flexBasis = `calc(${metrics.remaining}% - ${metrics.gapShare}px)`;
        };
        space.addEventListener("mousedown", event => event.preventDefault());
        space.addEventListener("click", event => {
          if (!editor.isEditable || selectionActive() || editor.view.composing ||
              window.PennedBlockSelection?.consumesClick(event)) return;
          const position = getPos();
          if (typeof position !== "number") return;
          event.preventDefault(); event.stopPropagation();
          placeCaretInSlot(editor, position + current.nodeSize - 1, { column: true });
        });
        refresh();
        return { dom, contentDOM,
          update(next) {
            if (next.type !== current.type) return false;
            if (next.content !== current.content) { current = next; refresh(); }
            else current = next;
            return true;
          },
          stopEvent: event => space.contains(event.target),
          ignoreMutation: mutation => mutation.type !== "selection" &&
            (mutation.target === dom || space.contains(mutation.target)),
        };
      };
    },
  });
}

export function resizableCalloutView({ node, editor, getPos, selectionActive }) {
  let current = node, drag = null, cleanup = null;
  const rendered = DOMSerializer.renderSpec(document, node.type.spec.toDOM(node));
  const dom = rendered.dom, contentDOM = rendered.contentDOM;
  let renderedAttributes = new Set([...dom.attributes].map(attribute => attribute.name));
  const handles = document.createElement("div");
  handles.className = "vellix-table-resizers penned-callout-resizers";
  handles.contentEditable = "false";
  const edge = document.createElement("span");
  edge.className = "vellix-table-resize-line"; edge.style.left = "100%";
  edge.setAttribute("aria-label", "Resize callout width");
  edge.addEventListener("touchstart", event => {
    if (editor.isEditable && !selectionActive()) event.preventDefault();
  }, { passive: false });
  handles.append(edge); dom.append(handles);
  edge.addEventListener("pointerdown", event => {
    if (!editor.isEditable || selectionActive() || event.button !== 0 || drag) return;
    const position = getPos();
    if (typeof position !== "number") return;
    const boundary = editor.state.doc.resolve(position);
    const row = boundary.parent.type.name === "plainCalloutRow" ? boundary.parent : null;
    const container = row ? dom.closest(".penned-callout-row") : dom.parentElement;
    const available = container?.getBoundingClientRect().width;
    if (!available) return;
    const siblings = row ? row.content.content.filter(child => child !== current) : [];
    const otherWidth = siblings.reduce((sum, child) => sum + (calloutWidth(child.attrs.widthPercent) || 0), 0);
    const maximum = Math.max(1, 100 - otherWidth);
    const minimum = Math.min(maximum, 100 * Math.min(120, available) / available);
    const start = event.clientX, original = calloutWidth(current.attrs.widthPercent) || 100;
    let width = original;
    drag = { id: current.attrs.id };
    const restore = () => {
      dom.style.removeProperty("--penned-callout-preview-width");
      dom.classList.remove("penned-callout-resizing");
      drag = null;
    };
    dom.classList.add("penned-callout-resizing");
    cleanup = window.VellixTables.trackHorizontalResize(event, {
      move(next) {
        width = Math.max(minimum, Math.min(maximum, original + 100 * (next.clientX - start) / available));
        dom.style.setProperty("--penned-callout-preview-width", `${width}%`);
      },
      finish() {
        const at = getPos(), state = editor.state;
        const target = typeof at === "number" && state.doc.nodeAt(at);
        const changed = Math.abs(width - original) >= 0.1;
        const identity = drag?.id;
        restore();
        if (!changed || !editor.isEditable || target?.type.name !== "plainCallout" || target.attrs.id !== identity) return;
        const tr = closeHistory(state.tr.setNodeMarkup(at, undefined,
          { ...target.attrs, widthPercent: Math.round(width * 100) / 100 }));
        const resolved = tr.doc.resolve(at);
        if (resolved.parent.type.name !== "plainCalloutRow" && width < 99.9) {
          const range = resolved.blockRange(tr.doc.resolve(at + target.nodeSize));
          if (range && range.parent.canReplaceWith(range.startIndex, range.endIndex, state.schema.nodes.plainCalloutRow)) {
            tr.wrap(range, [{ type: state.schema.nodes.plainCalloutRow, attrs: { id: crypto.randomUUID() } }]);
          }
        }
        editor.view.dispatch(tr);
        editor.view.dispatch(closeHistory(editor.state.tr));
      },
      cancel: restore,
    });
  });
  return { dom, contentDOM,
    update(next) {
      if (next.type !== current.type) return false;
      if (next.attrs !== current.attrs) {
        const fresh = DOMSerializer.renderSpec(document, next.type.spec.toDOM(next));
        const preview = dom.style.getPropertyValue("--penned-callout-preview-width");
        for (const name of renderedAttributes) {
          if (name !== "class" && !fresh.dom.hasAttribute(name)) dom.removeAttribute(name);
        }
        for (const attribute of [...fresh.dom.attributes]) {
          if (attribute.name !== "class") dom.setAttribute(attribute.name, attribute.value);
        }
        renderedAttributes = new Set([...fresh.dom.attributes].map(attribute => attribute.name));
        if (drag && preview) dom.style.setProperty("--penned-callout-preview-width", preview);
        dom.classList.toggle("penned-clip-source", !!next.attrs.clipSource);
        contentDOM.className = fresh.contentDOM.className;
        if (JSON.stringify(next.attrs.clipSource) !== JSON.stringify(current.attrs.clipSource)) {
          for (const child of [...dom.children]) if (child !== contentDOM && child !== handles) child.remove();
          for (const child of [...fresh.dom.children]) if (child !== fresh.contentDOM) dom.insertBefore(child, contentDOM);
        }
      }
      current = next;
      return true;
    },
    stopEvent: event => handles.contains(event.target),
    ignoreMutation: mutation => mutation.type !== "selection" && !contentDOM.contains(mutation.target),
    destroy() { cleanup?.(); },
  };
}

// Empty rows are structural, not editable blocks. Inspect only changed ranges.
export const CalloutRowCleanup = Extension.create({
  name: "pennedCalloutRowCleanup",
  addProseMirrorPlugins: () => [new Plugin({
    appendTransaction(transactions, _before, state) {
      const empty = new Set();
      for (const transaction of transactions) {
        if (!transaction.docChanged || transaction.doc !== state.doc) continue;
        for (const range of changedRanges(transaction)) {
          state.doc.nodesBetween(Math.max(0, range.from - 1), Math.min(state.doc.content.size, range.to + 1), (node, pos) => {
            if (node.type.name === "plainCalloutRow" && !node.childCount) empty.add(pos);
            return !node.isText;
          });
        }
      }
      if (!empty.size) return null;
      const tr = state.tr;
      for (const pos of [...empty].sort((a, b) => b - a)) tr.delete(pos, pos + tr.doc.nodeAt(pos).nodeSize);
      return tr.docChanged ? tr : null;
    },
  })],
});

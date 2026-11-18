import { Node, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { changedRanges, inlineTextEdit } from "./incremental-nodes.js";
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

const legacyToggleKey = new PluginKey("pennedLegacyToggleFollowers");
const legacyFollowerTypes = new Set(["plainCallout", "iconCallout", "gridCard", "divider", "plainCalloutRow"]);
const isIndentedFollower = node => legacyFollowerTypes.has(node.type.name) && Number(node.attrs.indent) > 0;

function legacyToggleDecorations(doc) {
  const decorations = [];
  const visit = (parent, start) => {
    let toggle = null;
    parent.forEach((node, offset) => {
      const pos = start + offset;
      if (node.type.name === "toggleItem") {
        toggle = node;
      } else if (toggle) {
        // Older indents left callouts beside the toggle. Stop at the first
        // ordinary sibling; a later independent block is not toggle content.
        const mark = (item, from) => decorations.push(Decoration.node(from, from + item.nodeSize, {
          "data-legacy-toggle-body": toggle.attrs.open === false ? "closed" : "open",
        }));
        if (isIndentedFollower(node)) {
          mark(node, pos);
        } else if (node.type.name === "plainCalloutRow" && node.childCount) {
          let allIndented = true;
          node.forEach(child => { if (!isIndentedFollower(child)) allIndented = false; });
          if (allIndented) mark(node, pos);
          else {
            node.forEach((child, childOffset) => {
              if (isIndentedFollower(child)) mark(child, pos + 1 + childOffset);
            });
            toggle = null;
          }
        } else {
          toggle = null;
        }
      }
      if (!node.isTextblock && node.childCount) visit(node, pos + 1);
    });
  };
  visit(doc, 0);
  return DecorationSet.create(doc, decorations);
}

export const LegacyToggleFollowers = Extension.create({
  name: "pennedLegacyToggleFollowers",
  addProseMirrorPlugins: () => [new Plugin({
    key: legacyToggleKey,
    state: {
      init: (_, state) => legacyToggleDecorations(state.doc),
      apply(tr, previous) {
        if (!tr.docChanged) return previous;
        return inlineTextEdit(tr) ? previous.map(tr.mapping, tr.doc) : legacyToggleDecorations(tr.doc);
      },
    },
    props: { decorations: state => legacyToggleKey.getState(state) },
  })],
});

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

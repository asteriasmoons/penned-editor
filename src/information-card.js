import { Node, mergeAttributes } from "@tiptap/core";
import { bindNonEditingTap } from "./editor-control-activation.js";
import { NodeSelection, Plugin, Selection, TextSelection } from "@tiptap/pm/state";

const freshID = () => crypto.randomUUID();
const defaults = { backgroundColor: "#202024", borderColor: "#393940", dividerColor: "#393940", titleColor: "#FFFFFF", textColor: "#E4E4EA", cornerRadius: 16, padding: 16, borderThickness: 1, showBorder: true, showLabels: true, collapsible: false, hideTitle: false, hideDescription: false, hideDivider: false };
const color = (v, fallback) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
const number = (v, fallback, min, max) => Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : fallback;
const bodyPosition = (pos, node) => pos + 1 + node.child(0).nodeSize + node.child(1).nodeSize;
const appearance = a => ({
  backgroundColor: color(a.backgroundColor, defaults.backgroundColor),
  borderColor: color(a.borderColor, defaults.borderColor),
  dividerColor: color(a.dividerColor, defaults.dividerColor),
  titleColor: color(a.titleColor, defaults.titleColor),
  textColor: color(a.textColor, defaults.textColor),
  cornerRadius: number(a.cornerRadius, defaults.cornerRadius, 0, 32),
  padding: number(a.padding, defaults.padding, 8, 36),
  borderThickness: number(a.borderThickness, defaults.borderThickness, 1, 12),
  showBorder: a.showBorder !== false && a.showBorder !== "false",
  showLabels: a.showLabels !== false && a.showLabels !== "false",
  collapsible: a.collapsible === true,
  hideTitle: a.hideTitle === true || a.hideTitle === "true",
  hideDescription: a.hideDescription === true || a.hideDescription === "true",
  hideDivider: a.hideDivider === true || a.hideDivider === "true",
});
const attrsHTML = a => {
  const v = appearance(a);
  return {
    class: "penned-information-card",
    "data-information-card": "",
    "data-vellix-block-id": a.id || undefined,
    "data-ic-background": v.backgroundColor,
    "data-ic-border": v.borderColor,
    "data-ic-divider": v.dividerColor,
    "data-ic-title": v.titleColor,
    "data-ic-text": v.textColor,
    "data-ic-radius": String(v.cornerRadius),
    "data-ic-padding": String(v.padding),
    "data-ic-border-thickness": String(v.borderThickness),
    "data-ic-show-border": String(v.showBorder),
    "data-ic-show-labels": String(v.showLabels),
    "data-ic-collapsible": String(v.collapsible),
    "data-ic-collapsed": String(v.collapsible && a.collapsed === true),
    "data-ic-hide-title": String(v.hideTitle),
    "data-ic-hide-description": String(v.hideDescription),
    "data-ic-hide-divider": String(v.hideDivider),
    style: `--ic-bg:${v.backgroundColor};--ic-border:${v.borderColor};--ic-divider:${v.dividerColor};--ic-title:${v.titleColor};--ic-text:${v.textColor};--ic-radius:${v.cornerRadius}px;--ic-padding:${v.padding}px;--ic-border-width:${v.showBorder ? v.borderThickness : 0}px`,
  };
};
const child = (type, value) => ({ type, attrs: { id: freshID() }, content: value ? [{ type: "text", text: value }] : [] });
function visibleSelection(doc, pos, card) {
  if (!(card.attrs.collapsible && card.attrs.collapsed)) return Selection.near(doc.resolve(bodyPosition(pos, card) + 1));
  if (!card.attrs.hideTitle) return TextSelection.create(doc, pos + 2);
  if (!card.attrs.hideDescription) return TextSelection.create(doc, pos + 2 + card.child(0).nodeSize);
  return NodeSelection.create(doc, pos);
}
export function informationCardJSON() {
  return { type: "informationCard", attrs: { id: freshID(), ...defaults }, content: [
    child("informationCardTitle", "Information Card"),
    child("informationCardDescription", "Add a description"),
    { type: "informationCardBody", attrs: { id: freshID() }, content: [
      { type: "informationCardLabel", content: [{ type: "text", marks: [{ type: "bold" }], text: "Label" }] },
      { type: "paragraph", content: [{ type: "text", text: "Value" }] },
    ] },
  ] };
}
export function createInformationCard({ post, snapshot, selectionActive }) {
  const attrDefs = {
    id: { default: null, parseHTML: el => el.getAttribute("data-vellix-block-id"), renderHTML: () => ({}) },
    collapsed: { default: false, parseHTML: el => el.getAttribute("data-ic-collapsed") === "true", renderHTML: () => ({}) },
  };
  for (const [key, fallback] of Object.entries(defaults)) {
    attrDefs[key] = { default: fallback, parseHTML: el => {
      const raw = el.getAttribute("data-ic-" + ({ backgroundColor:"background", borderColor:"border", dividerColor:"divider", titleColor:"title", textColor:"text", cornerRadius:"radius", showBorder:"show-border", showLabels:"show-labels", borderThickness:"border-thickness", hideTitle:"hide-title", hideDescription:"hide-description", hideDivider:"hide-divider" }[key] || key));
      if (raw == null) return fallback;
      if (typeof fallback === "boolean") return fallback ? raw !== "false" : raw === "true";
      if (typeof fallback === "number") return number(raw, fallback, key === "padding" ? 8 : key === "borderThickness" ? 1 : 0, key === "padding" ? 36 : key === "borderThickness" ? 12 : 32);
      return color(raw, fallback);
    }, renderHTML: () => ({}) };
  }
  const title = Node.create({
    name: "informationCardTitle", content: "inline*", defining: true, selectable: false,
    parseHTML: () => [{ tag: "div[data-information-card-title]" }],
    renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "penned-information-card-title", "data-information-card-title": "" }), 0],
  });
  const description = Node.create({
    name: "informationCardDescription", content: "inline*", defining: true, selectable: false,
    parseHTML: () => [{ tag: "div[data-information-card-description]" }],
    renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "penned-information-card-description", "data-information-card-description": "" }), 0],
  });
  const label = Node.create({
    name: "informationCardLabel", content: "inline*", defining: true, selectable: false,
    parseHTML: () => [{ tag: "div[data-information-card-label]" }],
    renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "penned-information-card-label", "data-information-card-label": "" }), 0],
  });
  const body = Node.create({
    name: "informationCardBody", content: "informationCardLabel? block+", defining: true, selectable: false,
    parseHTML: () => [{ tag: "div[data-information-card-body]" }],
    renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "penned-information-card-body", "data-information-card-body": "" }), 0],
  });
  const card = Node.create({
    name: "informationCard", group: "block", content: "informationCardTitle informationCardDescription informationCardBody",
    isolating: true, defining: true, selectable: true,
    addAttributes: () => attrDefs,
    parseHTML: () => [{ tag: "div[data-information-card]" }],
    renderHTML: ({ node, HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, attrsHTML(node.attrs)), 0],
    addProseMirrorPlugins() {
      const emit = (stage, details = {}) => post("informationCardDeletionDiagnostic", { stage, ...details });
      const inspect = state => {
        const { selection } = state;
        const $from = selection.$from;
        const path = Array.from({ length: $from.depth + 1 }, (_, depth) => $from.node(depth).type.name);
        let body = null;
        for (let depth = $from.depth; depth > 0; depth--) {
          if ($from.node(depth).type.name !== "informationCardBody") continue;
          const node = $from.node(depth);
          body = { childCount: node.childCount, children: node.content.content.map(child => ({ type: child.type.name, size: child.content.size })) };
          break;
        }
        return { from: selection.from, to: selection.to, empty: selection.empty,
          parentOffset: $from.parentOffset, path, body, docSize: state.doc.content.size };
      };
      let pending = false;
      const protectValue = (view, event) => {
        if (event.type === "keydown" && event.key !== "Backspace") return;
        if (event.type === "beforeinput" && event.inputType !== "deleteContentBackward") return;
        if (!event.cancelable || !view.editable) return;
        const { selection } = view.state;
        if (!selection.empty || selection.$from.parent.type.name !== "paragraph" || selection.$from.parentOffset !== 0) return;
        const $from = selection.$from;
        for (let depth = $from.depth - 1; depth > 0; depth--) {
          if ($from.node(depth).type.name !== "informationCardBody") continue;
          const body = $from.node(depth);
          const index = $from.index(depth);
          const firstValue = body.firstChild?.type.name === "informationCardLabel" ? 1 : 0;
          if (index === firstValue && $from.parent.content.size === 0) {
            event.preventDefault();
            event.stopImmediatePropagation();
            emit("protected-value", { selection: inspect(view.state) });
          }
          return;
        }
      };
      return [new Plugin({
        view: view => {
          emit("installed", { source: "information-card.js" });
          const onDelete = event => {
            const isDelete = event.type === "keydown"
              ? ["Backspace", "Delete"].includes(event.key)
              : ["deleteContentBackward", "deleteContentForward"].includes(event.inputType);
            if (!isDelete) return;
            protectValue(view, event);
            pending = true;
            emit("before", { eventType: event.type, inputType: event.inputType ?? null,
              key: event.key ?? null, cancelable: event.cancelable,
              prevented: event.defaultPrevented, selection: inspect(view.state) });
            setTimeout(() => {
              emit("after", { eventType: event.type, prevented: event.defaultPrevented,
                selection: inspect(view.state) });
              pending = false;
            }, 100);
          };
          view.dom.ownerDocument.addEventListener("keydown", onDelete, true);
          view.dom.ownerDocument.addEventListener("beforeinput", onDelete, true);
          return { destroy: () => {
            view.dom.ownerDocument.removeEventListener("keydown", onDelete, true);
            view.dom.ownerDocument.removeEventListener("beforeinput", onDelete, true);
          } };
        },
        appendTransaction(transactions, previous, state) {
          // Upgrade legacy cards whose label was the first ordinary paragraph.
          const legacy = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "informationCardBody" || node.childCount < 2 ||
                node.firstChild.type.name !== "paragraph") return;
            legacy.push({ pos: pos + 1, node: node.firstChild });
          });
          if (legacy.length) {
            const tr = state.tr;
            for (const item of legacy.reverse()) {
              tr.replaceWith(item.pos, item.pos + item.node.nodeSize,
                state.schema.nodes.informationCardLabel.create(null, item.node.content, item.node.marks));
            }
            emit("legacy-label-migration", { count: legacy.length });
            return tr.setMeta("addToHistory", false);
          }
          if (pending && transactions.some(tr => tr.docChanged || tr.selectionSet)) {
            emit("transaction", { changes: transactions.map(tr => ({ docChanged: tr.docChanged,
              selectionSet: tr.selectionSet, steps: tr.steps.map(step => step.constructor.name) })),
              before: inspect(previous), after: inspect(state) });
          }
          if (previous.selection.eq(state.selection) && !transactions.some(tr => tr.docChanged || tr.selectionSet)) return null;
          const hiddenCards = new Set();
          for (const position of [state.selection.$from, state.selection.$to]) {
            for (let depth = position.depth; depth > 1; depth--) {
              const type = position.node(depth).type.name, parent = position.node(depth - 1);
              if (parent.type.name === "informationCard" &&
                  ((type === "informationCardTitle" && parent.attrs.hideTitle) ||
                   (type === "informationCardDescription" && parent.attrs.hideDescription))) {
                return state.tr.setSelection(visibleSelection(state.doc, position.before(depth - 1), parent))
                  .setMeta("addToHistory", false);
              }
            }
          }
          // Keyboard navigation can resolve to a position inside a hidden body.
          // Expand its card before the caret becomes invisible.
          for (const position of [state.selection.$from, state.selection.$to]) {
            for (let depth = position.depth; depth > 1; depth--) {
              if (position.node(depth).type.name !== "informationCardBody") continue;
              const parent = position.node(depth - 1);
              if (parent.type.name === "informationCard" && parent.attrs.collapsible && parent.attrs.collapsed) {
                hiddenCards.add(position.before(depth - 1));
              }
            }
          }
          if (!hiddenCards.size) return null;
          const tr = state.tr.setMeta("addToHistory", false);
          if (transactions.some(tr => tr.getMeta("pennedPlaceholderDocumentLoad"))) {
            // On load, preserve the saved disclosure even if setContent mapped the initial caret into its body.
            const first = Math.min(...hiddenCards);
            return tr.setSelection(visibleSelection(tr.doc, first, tr.doc.nodeAt(first)));
          }
          for (const pos of hiddenCards) tr.setNodeAttribute(pos, "collapsed", false);
          return tr;
        },
      })];
    },
    addNodeView() {
      return ({ node, editor, getPos }) => {
        let current = node;
        const dom = document.createElement("div");
        const contentDOM = document.createElement("div");
        contentDOM.className = "penned-information-card-content";
        const disclosure = document.createElement("button");
        disclosure.type = "button";
        disclosure.className = "penned-information-card-disclosure";
        disclosure.contentEditable = "false";
        dom.append(disclosure, contentDOM);
        const isDisclosure = target => disclosure.contains(target);
        const updateAttrs = attrs => {
          for (const [key, value] of Object.entries(attrsHTML(attrs))) {
            if (key === "class") { dom.classList.add(value); continue; }
            if (value == null) dom.removeAttribute(key);
            else if (dom.getAttribute(key) !== value) dom.setAttribute(key, value);
          }
          const collapsed = attrs.collapsible === true && attrs.collapsed === true;
          disclosure.hidden = attrs.collapsible !== true;
          disclosure.setAttribute("aria-expanded", String(!collapsed));
          disclosure.setAttribute("aria-label", collapsed ? "Expand information card" : "Collapse information card");
        };
        disclosure.addEventListener("contextmenu", event => {
          event.preventDefault();
          event.stopPropagation();
        });
        bindNonEditingTap(disclosure, event => {
          event.preventDefault();
          event.stopPropagation();
          if (!editor.isEditable || selectionActive()) return;
          const pos = getPos();
          if (!Number.isInteger(pos)) return;
          const live = editor.state.doc.nodeAt(pos);
          if (live?.type.name !== "informationCard" || live.attrs.collapsible !== true) return;
          const collapsed = !live.attrs.collapsed;
          const tr = editor.state.tr.setNodeAttribute(pos, "collapsed", collapsed).setMeta("addToHistory", false);
          if (collapsed) {
            const bodyStart = bodyPosition(pos, live);
            const bodyEnd = bodyStart + live.child(2).nodeSize;
            if ([tr.selection.from, tr.selection.to].some(at => at > bodyStart && at < bodyEnd)) {
              tr.setSelection(visibleSelection(tr.doc, pos, tr.doc.nodeAt(pos)));
            }
          }
          editor.view.dispatch(tr);
          post("snapshot", snapshot());
        }, () => editor.isEditable && !selectionActive());
        updateAttrs(node.attrs);
        return { dom, contentDOM, update(next) {
          if (next.type !== current.type) return false;
          if (next.attrs !== current.attrs) updateAttrs(next.attrs);
          current = next;
          return true;
        }, stopEvent(event) { return isDisclosure(event.target); },
        ignoreMutation(m) { return isDisclosure(m.target) || (m.type === "attributes" && m.target === dom); } };
      };
    },
  });
  function command(editor, name, args = {}) {
    if (name !== "informationCardSetAttr") return undefined;
    if (!editor.isEditable || selectionActive()) return false;
    const key = args.key;
    if (!(key in defaults)) return false;
    const fallback = defaults[key];
    const value = typeof fallback === "boolean" ? args.value === true :
      typeof fallback === "number" ? number(args.value, fallback, key === "padding" ? 8 : key === "borderThickness" ? 1 : 0, key === "padding" ? 36 : key === "borderThickness" ? 12 : 32) :
      color(args.value, fallback);
    let pos = null;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === "informationCard" && node.attrs.id === args.blockId) { pos = at; return false; }
    });
    if (pos === null) return false;
    const tr = editor.state.tr.setNodeAttribute(pos, key, value);
    if (key === "collapsible" && !value) tr.setNodeAttribute(pos, "collapsed", false);
    editor.view.dispatch(tr);
    post("snapshot", snapshot());
    return true;
  }
  function requestSettings(node) {
    if (node.type.name !== "informationCard" || !node.attrs.id) return false;
    post("informationCardSettings", { blockId: node.attrs.id, ...appearance(node.attrs) });
    return true;
  }
  return { nodes: [card, title, description, label, body], command, requestSettings };
}

//
// Minimal Fields block.
//
// Shape: minimalFields > minimalRecord+ . Each record is a bold title plus any
// number of label/value fields:
//   minimalRecord > minimalRecordTitle minimalField+
//   minimalField  > minimalFieldLabel minimalFieldValue
// The title and label are inline text; the value is full rich text ("block+").
// Every visual affordance — the vertical accent rail, the small coloured labels,
// the thin dividers between records — is pure CSS driven from CSS variables the
// block carries. Settings are opened from the formatting bar.
//

import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { inlineTextEdit } from "./incremental-nodes.js";

export const MINIMAL_FIELDS_DEFAULTS = {
  accentColor: "#7C5CFF",
  accentWidth: 3,
  titleColor: "#FFFFFF",
  labelColor: "#B98CFF",
  valueColor: "#E4E4EA",
  dividerColor: "#2A2A2E",
  dividerVisible: true,
  showRecordTitles: true,
  labelUppercase: true,
  titleSize: 20,
  labelSize: 12,
  valueSize: 15,
  fieldSpacing: 12,
  recordSpacing: 18,
  outerSpacing: 8,
};

const COLOR_TARGETS = new Set(["accentColor", "titleColor", "labelColor", "valueColor", "dividerColor"]);
const NUMBER_TARGETS = {
  accentWidth: [1, 8], titleSize: [14, 32], labelSize: [9, 18], valueSize: [11, 22],
  fieldSpacing: [0, 32], recordSpacing: [0, 48], outerSpacing: [0, 40],
};
const BOOL_TARGETS = new Set(["dividerVisible", "labelUppercase", "showRecordTitles"]);

const minimalSurfaces = new WeakMap();
export function minimalFieldsSurface(element) { return minimalSurfaces.get(element); }

const freshID = () => globalThis.crypto.randomUUID();
const validColor = value =>
  typeof value === "string" && /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim()) ? value.trim() : null;
const colorOr = (value, fallback) => validColor(value) || fallback;
const clampNumber = (value, [lo, hi], fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};
const asBool = (value, fallback) =>
  typeof value === "boolean" ? value : value === "true" ? true : value === "false" ? false : fallback;

function appearance(attrs) {
  const out = {
    dividerVisible: asBool(attrs.dividerVisible, MINIMAL_FIELDS_DEFAULTS.dividerVisible),
    showRecordTitles: asBool(attrs.showRecordTitles, MINIMAL_FIELDS_DEFAULTS.showRecordTitles),
    labelUppercase: asBool(attrs.labelUppercase, MINIMAL_FIELDS_DEFAULTS.labelUppercase),
  };
  for (const key of COLOR_TARGETS) out[key] = colorOr(attrs[key], MINIMAL_FIELDS_DEFAULTS[key]);
  for (const key of Object.keys(NUMBER_TARGETS)) out[key] = clampNumber(attrs[key], NUMBER_TARGETS[key], MINIMAL_FIELDS_DEFAULTS[key]);
  return out;
}

function minimalHTMLAttributes(attrs) {
  const a = appearance(attrs);
  const style =
    `--mf-accent:${a.accentColor};--mf-accent-width:${a.accentWidth}px;` +
    `--mf-title-color:${a.titleColor};--mf-label-color:${a.labelColor};--mf-value-color:${a.valueColor};` +
    `--mf-divider:${a.dividerColor};--mf-title-size:${a.titleSize}px;--mf-label-size:${a.labelSize}px;` +
    `--mf-value-size:${a.valueSize}px;--mf-field-gap:${a.fieldSpacing}px;--mf-record-gap:${a.recordSpacing}px;` +
    `--mf-outer:${a.outerSpacing}px`;
  return {
    class: "penned-minimal-fields",
    "data-minimal-fields": "",
    "data-vellix-block-id": typeof attrs.id === "string" && attrs.id.trim() ? attrs.id : undefined,
    "data-mf-divider": a.dividerVisible ? "true" : "false",
    "data-mf-titles": a.showRecordTitles ? "true" : "false",
    "data-mf-uppercase": a.labelUppercase ? "true" : "false",
    style,
  };
}

function emptyParagraph() {
  return { type: "paragraph", attrs: { id: freshID() } };
}
function inlineNode(type, text) {
  return { type, attrs: { id: freshID() }, content: text ? [{ type: "text", text }] : [] };
}
function valueNode() {
  return { type: "minimalFieldValue", attrs: { id: freshID() }, content: [emptyParagraph()] };
}
function fieldNode(label) {
  return { type: "minimalField", attrs: { id: freshID() },
    content: [inlineNode("minimalFieldLabel", label), valueNode()] };
}
function recordNode(title, labels) {
  return { type: "minimalRecord", attrs: { id: freshID() },
    content: [inlineNode("minimalRecordTitle", title), ...labels.map(fieldNode)] };
}
export function minimalFieldsJSON(attrs = {}) {
  return {
    type: "minimalFields",
    attrs: { id: freshID(), ...MINIMAL_FIELDS_DEFAULTS, ...attrs },
    content: [recordNode("Untitled Record Title", [])],
  };
}

// Deep-clone JSON, assigning fresh ids to every node so a duplicate is
// structurally independent of the original.
function cloneWithFreshIds(json) {
  if (Array.isArray(json)) return json.map(cloneWithFreshIds);
  if (json && typeof json === "object") {
    const copy = {};
    for (const [key, value] of Object.entries(json)) {
      if (key === "attrs" && value && typeof value === "object") {
        const attrs = { ...value };
        if (Object.prototype.hasOwnProperty.call(attrs, "id")) attrs.id = freshID();
        copy.attrs = attrs;
      } else {
        copy[key] = cloneWithFreshIds(value);
      }
    }
    return copy;
  }
  return json;
}

export function createMinimalFields({ post, snapshot, selectionActive }) {
  const notifySaved = () => { try { post("snapshot", snapshot()); } catch (_e) {} };

  const simpleAttr = (name, parse) => ({
    default: MINIMAL_FIELDS_DEFAULTS[name],
    parseHTML: element => parse(element.getAttribute(`data-mf-${name}`)),
    renderHTML: () => ({}),
  });

  const idAttr = (dataName) => ({
    id: {
      default: null,
      parseHTML: element => element.getAttribute(dataName),
      renderHTML: attrs => (typeof attrs.id === "string" && attrs.id ? { [dataName]: attrs.id } : {}),
    },
  });

  const minimalFields = Node.create({
    name: "minimalFields",
    group: "block",
    content: "minimalRecord+",
    isolating: true,
    defining: true,
    selectable: true,
    addAttributes() {
      const attrs = {
        id: {
          default: null,
          parseHTML: element => element.getAttribute("data-vellix-block-id"),
          renderHTML: () => ({}),
        },
      };
      attrs.dividerVisible = simpleAttr("dividerVisible", v => asBool(v, MINIMAL_FIELDS_DEFAULTS.dividerVisible));
      attrs.showRecordTitles = simpleAttr("showRecordTitles", v => asBool(v, MINIMAL_FIELDS_DEFAULTS.showRecordTitles));
      attrs.labelUppercase = simpleAttr("labelUppercase", v => asBool(v, MINIMAL_FIELDS_DEFAULTS.labelUppercase));
      for (const key of COLOR_TARGETS) attrs[key] = simpleAttr(key, v => colorOr(v, MINIMAL_FIELDS_DEFAULTS[key]));
      for (const key of Object.keys(NUMBER_TARGETS)) attrs[key] = simpleAttr(key, v => clampNumber(v, NUMBER_TARGETS[key], MINIMAL_FIELDS_DEFAULTS[key]));
      return attrs;
    },
    parseHTML() { return [{ tag: "div[data-minimal-fields]" }]; },
    renderHTML({ node, HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, minimalHTMLAttributes(node.attrs)), 0];
    },
    addNodeView() {
      return ({ node, getPos, editor }) => {
        let current = node;
        const dom = document.createElement("div");
        dom.className = "penned-minimal-fields";

        const applyAttrs = attrs => {
          for (const [name, value] of Object.entries(minimalHTMLAttributes(attrs))) {
            // Never rewrite `class`: ProseMirror toggles the block-selection
            // class on this element via classList; a wholesale reset would wipe
            // the selection highlight.
            if (name === "class") continue;
            if (value == null) dom.removeAttribute(name);
            else if (dom.getAttribute(name) !== value) dom.setAttribute(name, value);
          }
        };

        const blockID = () => current.attrs.id;
        // Editable text the user taps to edit — these keep native focus/caret.
        // Everything else (the accent side, padding, gaps, the collapse chevron)
        // is non-editable chrome: pressing it must not focus the editor.
        const editableTarget = target =>
          target instanceof Element && target.closest(".penned-minimal-title, .penned-minimal-label, .penned-minimal-value");

        dom.addEventListener("mousedown", event => {
          if (!editableTarget(event.target)) event.preventDefault();
        });

        applyAttrs(current.attrs);
        minimalSurfaces.set(dom, { getPos, blockID });

        return {
          dom,
          contentDOM: dom,
          update(next) {
            if (next.type !== current.type) return false;
            if (next.attrs !== current.attrs) applyAttrs(next.attrs);
            current = next;
            return true;
          },
          ignoreMutation(mutation) {
            // Class mutations are the block-selection decoration; style/data are
            // ours. Never treat attribute changes on the host as content edits.
            return mutation.type === "attributes" && mutation.target === dom;
          },
          destroy() { minimalSurfaces.delete(dom); },
        };
      };
    },
  });

  const minimalRecord = Node.create({
    name: "minimalRecord",
    content: "minimalRecordTitle minimalField*",
    isolating: true,
    defining: true,
    selectable: false,
    addAttributes() {
      return {
        ...idAttr("data-record-id"),
        collapsed: {
          default: false,
          parseHTML: el => el.getAttribute("data-collapsed") === "true",
          renderHTML: attrs => (attrs.collapsed ? { "data-collapsed": "true" } : {}),
        },
      };
    },
    parseHTML() { return [{ tag: "div[data-minimal-record]" }]; },
    renderHTML({ node, HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, {
        class: "penned-minimal-record", "data-minimal-record": "",
        "data-record-id": typeof node.attrs.id === "string" ? node.attrs.id : undefined,
      }), 0];
    },
    addNodeView() {
      return ({ node, getPos, editor }) => {
        let current = node;
        const dom = document.createElement("div");
        dom.className = "penned-minimal-record";
        dom.setAttribute("data-minimal-record", "");

        // A non-editable collapse chevron, left of the record title.
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "penned-minimal-collapse";
        toggle.setAttribute("contenteditable", "false");
        toggle.setAttribute("aria-label", "Collapse or expand record");


        // The title + fields live here (the node view's content hole).
        const content = document.createElement("div");
        content.className = "penned-minimal-record-content";

        dom.appendChild(toggle);
        dom.appendChild(content);

        const applyAttrs = attrs => {
          if (typeof attrs.id === "string") dom.setAttribute("data-record-id", attrs.id);
          else dom.removeAttribute("data-record-id");
          dom.toggleAttribute("data-collapsed", !!attrs.collapsed);
        };

        // Keep the chevron from focusing the editor (which would raise the
        // keyboard) and from reaching the block's long-press (which would open
        // settings). mousedown is the event WebKit focuses on, so cancel it;
        // leave click intact so the toggle still fires.
        toggle.addEventListener("mousedown", event => { event.preventDefault(); event.stopPropagation(); });
        toggle.addEventListener("pointerdown", event => { event.stopPropagation(); });
        toggle.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          const pos = typeof getPos === "function" ? getPos() : null;
          if (!Number.isInteger(pos)) return;
          const live = editor.state.doc.nodeAt(pos);
          if (!live || live.type.name !== "minimalRecord") return;
          editor.view.dispatch(
            editor.state.tr.setNodeAttribute(pos, "collapsed", !live.attrs.collapsed).setMeta("addToHistory", false)
          );
        });

        applyAttrs(current.attrs);

        return {
          dom,
          contentDOM: content,
          update(next) {
            if (next.type !== current.type) return false;
            current = next;
            applyAttrs(next.attrs);
            return true;
          },
          ignoreMutation(mutation) {
            if (mutation.target === toggle || (mutation.target instanceof Node && toggle.contains(mutation.target))) return true;
            return mutation.type === "attributes" && mutation.target === dom;
          },
          stopEvent(event) {
            return event.target === toggle || (event.target instanceof Node && toggle.contains(event.target));
          },
        };
      };
    },
  });

  const minimalRecordTitle = Node.create({
    name: "minimalRecordTitle",
    content: "inline*",
    defining: true,
    selectable: false,
    addAttributes() { return idAttr("data-title-id"); },
    parseHTML() { return [{ tag: "div[data-minimal-title]" }]; },
    renderHTML({ node, HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, {
        class: "penned-minimal-title", "data-minimal-title": "",
        "data-title-id": typeof node.attrs.id === "string" ? node.attrs.id : undefined,
      }), 0];
    },
  });

  const minimalField = Node.create({
    name: "minimalField",
    content: "minimalFieldLabel minimalFieldValue",
    isolating: true,
    defining: true,
    selectable: false,
    addAttributes() { return idAttr("data-field-id"); },
    parseHTML() { return [{ tag: "div[data-minimal-field]" }]; },
    renderHTML({ node, HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, {
        class: "penned-minimal-field", "data-minimal-field": "",
        "data-field-id": typeof node.attrs.id === "string" ? node.attrs.id : undefined,
      }), 0];
    },
  });

  const minimalFieldLabel = Node.create({
    name: "minimalFieldLabel",
    content: "inline*",
    defining: true,
    selectable: false,
    addAttributes() { return idAttr("data-label-id"); },
    parseHTML() { return [{ tag: "div[data-minimal-label]" }]; },
    renderHTML({ node, HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, {
        class: "penned-minimal-label", "data-minimal-label": "",
        "data-label-id": typeof node.attrs.id === "string" ? node.attrs.id : undefined,
      }), 0];
    },
  });

  const minimalFieldValue = Node.create({
    name: "minimalFieldValue",
    content: "block+",
    isolating: true,
    defining: true,
    selectable: false,
    addAttributes() { return idAttr("data-value-id"); },
    parseHTML() { return [{ tag: "div[data-minimal-value]" }]; },
    renderHTML({ node, HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, {
        class: "penned-minimal-value", "data-minimal-value": "",
        "data-value-id": typeof node.attrs.id === "string" ? node.attrs.id : undefined,
      }), 0];
    },
  });

  function findBlock(editor, blockID) {
    if (typeof blockID !== "string" || !blockID) return null;
    const dom = editor.view.dom.querySelector(`[data-minimal-fields][data-vellix-block-id="${CSS.escape(blockID)}"]`);
    const pos = minimalFieldsSurface(dom)?.getPos?.();
    const liveNode = Number.isInteger(pos) ? editor.state.doc.nodeAt(pos) : null;
    if (liveNode?.type.name === "minimalFields" && liveNode.attrs.id === blockID) return { node: liveNode, pos };
    let match = null;
    editor.state.doc.descendants((node, pos) => {
      if (match) return false;
      if (node.type.name !== "minimalFields") return node.type.name === "doc" || !node.isLeaf;
      if (node.attrs.id === blockID) match = { node, pos };
      return false;
    });
    return match;
  }

  function recordPositions(block) {
    const records = [];
    block.node.forEach((record, offset, index) => {
      if (record.type.name === "minimalRecord") records.push({ node: record, pos: block.pos + 1 + offset, index });
    });
    return records;
  }
  function fieldPositions(record) {
    const fields = [];
    record.node.forEach((field, offset, index) => {
      if (field.type.name === "minimalField") fields.push({ node: field, pos: record.pos + 1 + offset, index });
    });
    return fields;
  }
  const findRecord = (block, recordID) => recordPositions(block).find(r => r.node.attrs.id === recordID) || null;
  const titleText = record => {
    let text = "";
    record.forEach(child => { if (child.type.name === "minimalRecordTitle") text = child.textContent; });
    return text;
  };
  const labelText = field => {
    let text = "";
    field.forEach(child => { if (child.type.name === "minimalFieldLabel") text = child.textContent; });
    return text;
  };

  function sanitizeAttr(key, value) {
    if (COLOR_TARGETS.has(key)) return validColor(value);
    if (Object.prototype.hasOwnProperty.call(NUMBER_TARGETS, key)) return clampNumber(value, NUMBER_TARGETS[key], MINIMAL_FIELDS_DEFAULTS[key]);
    if (BOOL_TARGETS.has(key)) return asBool(value, MINIMAL_FIELDS_DEFAULTS[key]);
    return undefined;
  }
  function setAttrs(editor, blockID, patch) {
    const block = findBlock(editor, blockID);
    if (!block) return false;
    const changes = Object.entries(patch).filter(([key, value]) => block.node.attrs[key] !== value);
    if (!changes.length) return true;
    const tr = closeHistory(editor.state.tr);
    for (const [key, value] of changes) tr.setNodeAttribute(block.pos, key, value);
    editor.view.dispatch(tr);
    notifySaved();
    return true;
  }

  function publishSettings(editor, blockID) {
    const block = findBlock(editor, blockID);
    if (!block) return false;
    const a = appearance(block.node.attrs);
    const records = recordPositions(block).map(({ node }, index) => ({
      id: node.attrs.id,
      title: titleText(node) || `Record ${index + 1}`,
      fields: fieldPositions({ node, pos: 0 }).map(({ node: field }, fieldIndex) => ({
        id: field.attrs.id,
        label: labelText(field) || `Field ${fieldIndex + 1}`,
      })),
    }));
    post("minimalFieldsSettings", { blockId: blockID, records, defaults: { ...MINIMAL_FIELDS_DEFAULTS }, ...a });
    return true;
  }

  function command(editor, name, args = {}) {
    if (typeof name !== "string" || !name.startsWith("minimal")) return undefined;

    if (name === "minimalFieldsRequestSelectedSettings") {
      let id = null;
      const { $from } = editor.state.selection;
      for (let depth = $from.depth; depth >= 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name === "minimalFields") { id = node.attrs.id; break; }
      }
      return id ? publishSettings(editor, id) : false;
    }
    if (name === "minimalFieldsRequestSettings") return publishSettings(editor, args.blockId);

    if (!editor.isEditable || selectionActive()) return false;

    if (name === "minimalFieldsSetAttr") {
      const value = sanitizeAttr(args.key, args.value);
      if (value === undefined || value === null) return false;
      return setAttrs(editor, args.blockId, { [args.key]: value });
    }

    if (name === "minimalFieldsAddRecord") {
      const block = findBlock(editor, args.blockId);
      if (!block) return false;
      const record = recordNode("Untitled Record Title", []);
      const node = editor.schema.nodeFromJSON(record);
      const insertAt = block.pos + block.node.nodeSize - 1;
      editor.view.dispatch(closeHistory(editor.state.tr).insert(insertAt, node));
      notifySaved();
      return record.attrs.id;
    }

    if (name === "minimalFieldsDuplicateRecord") {
      const block = findBlock(editor, args.blockId);
      if (!block) return false;
      const record = findRecord(block, args.recordId);
      if (!record) return false;
      const clone = cloneWithFreshIds(record.node.toJSON());
      const node = editor.schema.nodeFromJSON(clone);
      editor.view.dispatch(closeHistory(editor.state.tr).insert(record.pos + record.node.nodeSize, node));
      notifySaved();
      return clone.attrs.id;
    }

    if (name === "minimalFieldsRemoveRecord") {
      const block = findBlock(editor, args.blockId);
      if (!block) return false;
      const records = recordPositions(block);
      const target = records.find(r => r.node.attrs.id === args.recordId);
      if (!target) return false;
      const tr = closeHistory(editor.state.tr);
      if (records.length <= 1) tr.delete(block.pos, block.pos + block.node.nodeSize);
      else tr.delete(target.pos, target.pos + target.node.nodeSize);
      editor.view.dispatch(tr);
      notifySaved();
      return true;
    }

    if (name === "minimalFieldsReorderRecords") {
      const block = findBlock(editor, args.blockId);
      if (!block || !Array.isArray(args.order)) return false;
      const records = recordPositions(block);
      if (args.order.length !== records.length) return false;
      const byID = new Map(records.map(r => [r.node.attrs.id, r.node]));
      const ordered = args.order.map(id => byID.get(id));
      if (ordered.some(node => !node)) return false;
      const tr = closeHistory(editor.state.tr);
      tr.replaceWith(block.pos + 1, block.pos + block.node.nodeSize - 1, ordered);
      editor.view.dispatch(tr);
      notifySaved();
      return true;
    }

    // Field-level commands all target a record inside the block.
    const resolveRecord = () => {
      const block = findBlock(editor, args.blockId);
      if (!block) return null;
      const record = findRecord(block, args.recordId);
      return record ? { block, record } : null;
    };

    if (name === "minimalFieldsAddField") {
      const found = resolveRecord();
      if (!found) return false;
      const field = fieldNode("Label");
      const node = editor.schema.nodeFromJSON(field);
      editor.view.dispatch(closeHistory(editor.state.tr).insert(found.record.pos + found.record.node.nodeSize - 1, node));
      notifySaved();
      return field.attrs.id;
    }

    if (name === "minimalFieldsDuplicateField") {
      const found = resolveRecord();
      if (!found) return false;
      const field = fieldPositions(found.record).find(f => f.node.attrs.id === args.fieldId);
      if (!field) return false;
      const clone = cloneWithFreshIds(field.node.toJSON());
      const node = editor.schema.nodeFromJSON(clone);
      editor.view.dispatch(closeHistory(editor.state.tr).insert(field.pos + field.node.nodeSize, node));
      notifySaved();
      return clone.attrs.id;
    }

    if (name === "minimalFieldsRemoveField") {
      const found = resolveRecord();
      if (!found) return false;
      const fields = fieldPositions(found.record);
      const field = fields.find(f => f.node.attrs.id === args.fieldId);
      if (!field) return false;
      editor.view.dispatch(closeHistory(editor.state.tr).delete(field.pos, field.pos + field.node.nodeSize));
      notifySaved();
      return true;
    }

    if (name === "minimalFieldsReorderFields") {
      const found = resolveRecord();
      if (!found || !Array.isArray(args.order)) return false;
      const fields = fieldPositions(found.record);
      if (args.order.length !== fields.length) return false;
      const byID = new Map(fields.map(f => [f.node.attrs.id, f.node]));
      const ordered = args.order.map(id => byID.get(id));
      if (ordered.some(node => !node)) return false;
      const tr = closeHistory(editor.state.tr);
      tr.replaceWith(found.record.pos + 1, found.record.pos + found.record.node.nodeSize - 1,
        [found.record.node.child(0), ...ordered]);
      editor.view.dispatch(tr);
      notifySaved();
      return true;
    }

    return false;
  }

  // Keep the block structurally valid: drop a minimalFields node that somehow
  // lost every record.
  const guardKey = new PluginKey("vellixMinimalFieldsGuard");
  const guard = new Plugin({
    key: guardKey,
    appendTransaction(transactions, _old, state) {
      if (!transactions.some(tr => tr.docChanged && !inlineTextEdit(tr))) return null;
      let tr = null;
      const empties = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== "minimalFields") return node.type.name === "doc" || !node.isLeaf;
        if (node.childCount === 0) empties.push(pos);
        return false;
      });
      if (empties.length) {
        tr = state.tr;
        for (const pos of empties.sort((a, b) => b - a)) {
          const node = tr.doc.nodeAt(pos);
          if (node) tr.delete(pos, pos + node.nodeSize);
        }
      }
      return tr && tr.docChanged ? tr.setMeta("addToHistory", false) : null;
    },
  });

  // Three consecutive Returns at the end of the final record exit Fields.
  // This works whether the final record has fields or only its title, and
  // inserts the paragraph into the same parent (including an active tabPanel).
  let exitEnterCount = 0;
  let lastExitPosition = null;
  const exitFields = new Plugin({
    key: new PluginKey("vellixMinimalFieldsTripleEnter"),
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "Enter" || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || event.isComposing) {
          exitEnterCount = 0;
          return false;
        }
        const { state } = view;
        const { selection } = state;
        if (!selection.empty) { exitEnterCount = 0; return false; }
        const $from = selection.$from;
        let depth = -1;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === "minimalFields") { depth = d; break; }
        }
        if (depth < 0) { exitEnterCount = 0; return false; }
        const fields = $from.node(depth);
        // Only the end of the last record's last editable descendant qualifies.
        // Resolve the end of the last textblock instead of assuming a fixed
        // number of nested wrappers.
        let finalTextblockEnd = null;
        fields.descendants((node, offset) => {
          if (node.isTextblock) finalTextblockEnd = $from.start(depth) + offset + node.nodeSize - 1;
        });
        if ($from.pos !== finalTextblockEnd) {
          exitEnterCount = 0;
          return false;
        }
        exitEnterCount = lastExitPosition === $from.pos ? exitEnterCount + 1 : 1;
        lastExitPosition = $from.pos;
        event.preventDefault();
        if (exitEnterCount < 3) return true;
        exitEnterCount = 0;
        lastExitPosition = null;
        const after = $from.after(depth);
        const paragraph = state.schema.nodes.paragraph.create();
        const $after = state.doc.resolve(after);
        if (!$after.parent.canReplaceWith($after.index(), $after.index(), paragraph.type)) return true;
        const tr = state.tr.insert(after, paragraph);
        tr.setSelection(TextSelection.create(tr.doc, after + 1));
        view.dispatch(tr.scrollIntoView());
        view.focus();
        return true;
      },
    },
  });

  return {
    nodes: [minimalFields, minimalRecord, minimalRecordTitle, minimalField, minimalFieldLabel, minimalFieldValue],
    plugins: [guard, exitFields],
    command,
    minimalFieldsJSON,
  };
}

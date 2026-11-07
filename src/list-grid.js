// List Grid — a structured "Description Grid" block.
//
// Shape: listGrid > listGridRow+ , each row = (listGridLabel listGridValue),
// each cell holds exactly one paragraph of normal rich text (all inline marks +
// alignment, reusing the editor's existing formatting infrastructure).
//
// Appearance is stored on the node and projected by its renderer. The node view
// owns the wrapper, including the temporary touch lock, not the cell content.
//
// There are no drag-to-resize handles: the column proportion is a single
// `leftFraction` (right column is the remainder), adjusted only from the settings
// sheet. Because it is a fraction of the card, the grid always fits the available
// width and never introduces horizontal scrolling; vertical height is automatic.

import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";

export const LIST_GRID_DEFAULTS = {
  cardBackground: "#F2F2F2",
  cardBorder: "#D1D1D1",
  leftBackground: "#E4E4E4",
  rightBorder: "#D1D1D1",
  leftFraction: 34,
};

const COLOR_TARGETS = new Set(["cardBackground", "cardBorder", "leftBackground", "rightBorder"]);
const ROW_STYLES = new Set(["default", "filled", "outlined"]);
const gridSurfaces = new WeakMap();

export function listGridSurface(element) {
  return gridSurfaces.get(element);
}

const freshID = () => globalThis.crypto.randomUUID();
const validColor = value =>
  typeof value === "string" && /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim()) ? value.trim() : null;
const clampFraction = value => {
  if (value == null || value === "") return LIST_GRID_DEFAULTS.leftFraction;
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(20, Math.min(80, n)) : LIST_GRID_DEFAULTS.leftFraction;
};
const colorOr = (value, fallback) => validColor(value) || fallback;

function gridAppearance(attrs) {
  return {
    cardBackground: colorOr(attrs.cardBackground, LIST_GRID_DEFAULTS.cardBackground),
    cardBorder: colorOr(attrs.cardBorder, LIST_GRID_DEFAULTS.cardBorder),
    leftBackground: colorOr(attrs.leftBackground, LIST_GRID_DEFAULTS.leftBackground),
    rightBorder: colorOr(attrs.rightBorder, LIST_GRID_DEFAULTS.rightBorder),
    leftFraction: clampFraction(attrs.leftFraction),
  };
}

function labelInk(background) {
  const [r, g, b] = [1, 3, 5].map(offset => {
    const channel = parseInt(background.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.20 ? "#171717" : "#FFFFFF";
}

function gridRowStyle(attrs) {
  return ROW_STYLES.has(attrs.rowStyle) ? attrs.rowStyle : (attrs.isHeader === true ? "filled" : "default");
}

function gridCaretAttributes(state) {
  const { $head, empty } = state.selection;
  if (!empty || !$head.parent.isTextblock || $head.depth < 3) return {};
  const cell = $head.node($head.depth - 1);
  const isValue = cell.type.name === "listGridValue";
  if (!isValue && cell.type.name !== "listGridLabel") return {};
  const style = gridRowStyle($head.node($head.depth - 2).attrs);
  if (style === "outlined" || (isValue && style !== "filled")) return { style: "--lg-caret-ink:#171717" };
  const grid = $head.node($head.depth - 3);
  const background = colorOr(grid.attrs.leftBackground, LIST_GRID_DEFAULTS.leftBackground);
  return { style: `--lg-caret-ink:${labelInk(background)}` };
}

function gridHTMLAttributes(attrs) {
  const { cardBackground, cardBorder, leftBackground, rightBorder, leftFraction } = gridAppearance(attrs);
  return {
    class: "penned-list-grid",
    "data-list-grid": "",
    "data-vellix-block-id": typeof attrs.id === "string" && attrs.id.trim() ? attrs.id : undefined,
    "data-lg-card-bg": cardBackground,
    "data-lg-card-border": cardBorder,
    "data-lg-left-bg": leftBackground,
    "data-lg-right-border": rightBorder,
    "data-lg-left-fraction": String(leftFraction),
    style: `--lg-card-bg:${cardBackground};--lg-card-border:${cardBorder};` +
      `--lg-left-bg:${leftBackground};--lg-right-border:${rightBorder};--lg-left-ink:${labelInk(leftBackground)};` +
      `--lg-left-fraction:${leftFraction}fr;--lg-right-fraction:${100 - leftFraction}fr`,
  };
}

function emptyParagraph() {
  return { type: "paragraph", attrs: { id: freshID() } };
}
function defaultRow() {
  return {
    type: "listGridRow",
    content: [
      { type: "listGridLabel", content: [emptyParagraph()] },
      { type: "listGridValue", content: [emptyParagraph()] },
    ],
  };
}
export function listGridJSON(rows = 3, attrs = {}) {
  const count = Math.max(1, Math.min(24, Math.floor(rows) || 3));
  return {
    type: "listGrid",
    attrs: { id: freshID(), ...LIST_GRID_DEFAULTS, ...attrs },
    content: Array.from({ length: count }, defaultRow),
  };
}

export function createListGrid({ post, snapshot, selectionActive }) {
  const notifySaved = () => { try { post("snapshot", snapshot()); } catch (_e) {} };

  const listGrid = Node.create({
    name: "listGrid",
    group: "block",
    content: "listGridRow+",
    isolating: true,
    defining: true,
    selectable: true,
    addAttributes() {
      return {
        id: {
          default: null,
          parseHTML: element => element.getAttribute("data-vellix-block-id"),
          renderHTML: () => ({}),
        },
        cardBackground: { default: LIST_GRID_DEFAULTS.cardBackground, parseHTML: el => el.getAttribute("data-lg-card-bg") },
        cardBorder: { default: LIST_GRID_DEFAULTS.cardBorder, parseHTML: el => el.getAttribute("data-lg-card-border") },
        leftBackground: { default: LIST_GRID_DEFAULTS.leftBackground, parseHTML: el => el.getAttribute("data-lg-left-bg") },
        rightBorder: { default: LIST_GRID_DEFAULTS.rightBorder, parseHTML: el => el.getAttribute("data-lg-right-border") },
        leftFraction: {
          default: LIST_GRID_DEFAULTS.leftFraction,
          parseHTML: el => clampFraction(el.getAttribute("data-lg-left-fraction")),
        },
      };
    },
    parseHTML() { return [{ tag: "div[data-list-grid]" }]; },
    renderHTML({ node, HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, gridHTMLAttributes(node.attrs)), 0];
    },
    addNodeView() {
      return ({ node, getPos }) => {
        let current = node;
        const dom = document.createElement("div");
        dom.className = "penned-list-grid";
        const render = attrs => {
          for (const [name, value] of Object.entries(gridHTMLAttributes(attrs))) {
            if (name === "class") continue;
            if (value == null) dom.removeAttribute(name);
            else if (dom.getAttribute(name) !== value) dom.setAttribute(name, value);
          }
        };
        const setTouchPending = (pending, held = false) => {
          dom.toggleAttribute("data-list-grid-touch-pending", pending);
          if (pending && held) dom.setAttribute("contenteditable", "false");
          else dom.removeAttribute("contenteditable");
        };
        render(current.attrs);
        gridSurfaces.set(dom, { getPos, setTouchPending });
        return {
          dom,
          contentDOM: dom,
          update(next) {
            if (next.type !== current.type) return false;
            if (next.attrs !== current.attrs) render(next.attrs);
            current = next;
            return true;
          },
          stopEvent(event) {
            return dom.getAttribute("contenteditable") === "false" && /^(touch|pointer|mouse|contextmenu)/.test(event.type);
          },
          ignoreMutation(mutation) { return mutation.type === "attributes" && mutation.target === dom; },
          destroy() { gridSurfaces.delete(dom); },
        };
      };
    },
  });

  const listGridRow = Node.create({
    name: "listGridRow",
    content: "listGridLabel listGridValue",
    isolating: true,
    selectable: false,
    addAttributes() {
      return {
        isHeader: {
          default: false,
          parseHTML: element => element.getAttribute("data-lg-header") === "true",
          renderHTML: () => ({}),
        },
        rowStyle: {
          default: null,
          parseHTML: element => {
            const style = element.getAttribute("data-lg-row-style");
            return ROW_STYLES.has(style) ? style : null;
          },
          renderHTML: () => ({}),
        },
      };
    },
    parseHTML() { return [{ tag: "div[data-list-grid-row]" }]; },
    renderHTML({ node, HTMLAttributes }) {
      const style = gridRowStyle(node.attrs);
      return ["div", mergeAttributes(HTMLAttributes, {
        class: "penned-list-grid-row", "data-list-grid-row": "", "data-lg-row-style": style,
        ...(style === "filled" ? { "data-lg-header": "true" } : {}),
      }), 0];
    },
  });

  const listGridLabel = Node.create({
    name: "listGridLabel",
    content: "paragraph",
    isolating: true,
    defining: true,
    selectable: false,
    parseHTML() { return [{ tag: "div[data-list-grid-label]" }]; },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { class: "penned-list-grid-label", "data-list-grid-label": "" }), 0];
    },
  });

  const listGridValue = Node.create({
    name: "listGridValue",
    content: "paragraph",
    isolating: true,
    defining: true,
    selectable: false,
    parseHTML() { return [{ tag: "div[data-list-grid-value]" }]; },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { class: "penned-list-grid-value", "data-list-grid-value": "" }), 0];
    },
  });

  function findGrid(editor, blockID) {
    if (typeof blockID !== "string" || !blockID) return null;
    const dom = editor.view.dom.querySelector(`[data-list-grid][data-vellix-block-id="${CSS.escape(blockID)}"]`);
    const pos = listGridSurface(dom)?.getPos();
    const liveNode = Number.isInteger(pos) ? editor.state.doc.nodeAt(pos) : null;
    if (liveNode?.type.name === "listGrid" && liveNode.attrs.id === blockID) return { node: liveNode, pos };

    let match = null;
    editor.state.doc.descendants((node, pos) => {
      if (match) return false;
      if (node.type.name !== "listGrid") return !node.isLeaf;
      if (node.attrs.id === blockID) match = { node, pos };
      return false;
    });
    return match;
  }

  function rowPositions(grid, gridPos) {
    const rows = [];
    grid.node.forEach((row, offset) => {
      if (row.type.name === "listGridRow") rows.push({ node: row, pos: gridPos + 1 + offset });
    });
    return rows;
  }

  function cellText(cell) {
    return cell ? cell.textBetween(0, cell.content.size, "\n", "") : "";
  }

  function publishSettings(editor, blockID) {
    const grid = findGrid(editor, blockID);
    if (!grid) return false;
    const rows = rowPositions(grid, grid.pos).map(({ node }) => ({
      label: cellText(node.child(0)),
      value: cellText(node.child(1)),
      rowStyle: gridRowStyle(node.attrs),
    }));
    post("listGridSettings", {
      blockId: blockID,
      ...gridAppearance(grid.node.attrs),
      defaults: { ...LIST_GRID_DEFAULTS },
      rows,
    });
    return true;
  }

  function setGridAttrs(editor, blockID, patch) {
    const grid = findGrid(editor, blockID);
    if (!grid) return false;
    const changes = Object.entries(patch).filter(([key, value]) => grid.node.attrs[key] !== value);
    if (!changes.length) return true;
    const tr = closeHistory(editor.state.tr);
    for (const [key, value] of changes) tr.setNodeAttribute(grid.pos, key, value);
    editor.view.dispatch(tr);
    const saved = findGrid(editor, blockID);
    if (!saved || changes.some(([key, value]) => saved.node.attrs[key] !== value)) return false;
    notifySaved();
    return true;
  }

  function command(editor, name, args = {}) {
    if (typeof name !== "string" || !name.startsWith("listGrid")) return undefined;

    if (name === "listGridRequestSelectedSettings") {
      let gridID = null;
      const { $from } = editor.state.selection;
      for (let depth = $from.depth; depth >= 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name === "listGrid") { gridID = node.attrs.id; break; }
      }
      return gridID ? publishSettings(editor, gridID) : false;
    }
    if (name === "listGridRequestSettings") return publishSettings(editor, args.blockId);

    if (!editor.isEditable || selectionActive()) return false;

    if (name === "listGridSetColor") {
      const target = args.target;
      const color = validColor(args.color);
      if (!COLOR_TARGETS.has(target) || !color) return false;
      return setGridAttrs(editor, args.blockId, { [target]: color });
    }

    if (name === "listGridSetProportion") {
      // Reuse the table engine's internal-boundary resizing calculation;
      // unlike tables, only the settings sheet invokes this operation.
      const grid = findGrid(editor, args.blockId);
      if (!grid) return false;
      const element = editor.view.nodeDOM(grid.pos);
      const row = element?.firstElementChild;
      const gap = row ? parseFloat(row.ownerDocument.defaultView.getComputedStyle(row).columnGap) || 0 : 0;
      const width = Math.max(112, Math.round((row?.clientWidth || element?.clientWidth || editor.view.dom.clientWidth || 320) - gap));
      const originalLeft = Math.round(width * clampFraction(grid.node.attrs.leftFraction) / 100);
      const original = [originalLeft, width - originalLeft];
      const desired = Math.round(width * clampFraction(args.leftFraction) / 100);
      const resize = globalThis.VellixTables?.resizeWidths;
      // Use the very same resizeWidths implementation as table column handles.
      // Never silently substitute a different sizing algorithm.
      if (typeof resize !== "function") return false;
      const result = resize(original, 1, desired - originalLeft, 0).widths;
      const leftFraction = clampFraction(result[0] / width * 100);
      return setGridAttrs(editor, args.blockId, { leftFraction }) ? leftFraction : false;
    }

    if (name === "listGridRestoreProportion") {
      const { leftFraction } = LIST_GRID_DEFAULTS;
      return setGridAttrs(editor, args.blockId, { leftFraction }) ? leftFraction : false;
    }

    if (name === "listGridSetRowStyle") {
      const { index, rowStyle } = args;
      if (!Number.isInteger(index) || index < 0 || !ROW_STYLES.has(rowStyle)) return false;
      const grid = findGrid(editor, args.blockId);
      if (!grid) return false;
      const row = rowPositions(grid, grid.pos)[index];
      if (!row) return false;
      if (gridRowStyle(row.node.attrs) === rowStyle) return true;
      editor.view.dispatch(closeHistory(editor.state.tr).setNodeAttribute(row.pos, "rowStyle", rowStyle));
      const saved = findGrid(editor, args.blockId)?.node.maybeChild(index);
      if (saved?.attrs.rowStyle !== rowStyle) return false;
      notifySaved();
      return true;
    }

    if (name === "listGridAddRow") {
      const grid = findGrid(editor, args.blockId);
      if (!grid) return false;
      const insertAt = grid.pos + grid.node.nodeSize - 1;
      const row = editor.schema.nodeFromJSON(defaultRow());
      editor.view.dispatch(closeHistory(editor.state.tr).insert(insertAt, row));
      notifySaved();
      return true;
    }

    if (name === "listGridRemoveRow") {
      const grid = findGrid(editor, args.blockId);
      if (!grid) return false;
      const rows = rowPositions(grid, grid.pos);
      const index = Number(args.index);
      if (!Number.isInteger(index) || index < 0 || index >= rows.length) return false;
      const tr = closeHistory(editor.state.tr);
      if (rows.length <= 1) {
        // Removing the last row removes the whole grid (a grid cannot have zero rows).
        tr.delete(grid.pos, grid.pos + grid.node.nodeSize);
        editor.view.dispatch(tr);
        notifySaved();
        return true;
      }
      const target = rows[index];
      tr.delete(target.pos, target.pos + target.node.nodeSize);
      editor.view.dispatch(tr);
      notifySaved();
      return true;
    }

    return false;
  }

  // Defensive structural guard: a listGrid can never be valid with zero rows, but
  // if an edit or paste ever leaves an empty grid behind, drop it rather than let
  // an invalid node linger.
  const guardKey = new PluginKey("vellixListGridGuard");
  const guard = new Plugin({
    key: guardKey,
    // iOS uses the editing host's caret color, not the descendant's color.
    props: { attributes: gridCaretAttributes },
    appendTransaction(transactions, _old, state) {
      if (!transactions.some(tr => tr.docChanged)) return null;
      const empties = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name === "listGrid" && node.childCount === 0) empties.push(pos);
        return node.type.name === "doc";
      });
      if (!empties.length) return null;
      const tr = state.tr;
      for (const pos of empties.sort((a, b) => b - a)) {
        const node = tr.doc.nodeAt(pos);
        if (node) tr.delete(pos, pos + node.nodeSize);
      }
      return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
    },
  });

  return { nodes: [listGrid, listGridRow, listGridLabel, listGridValue], plugins: [guard], command, listGridJSON };
}

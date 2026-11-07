import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Transform } from "@tiptap/pm/transform";
import { closeHistory } from "@tiptap/pm/history";

const key = new PluginKey("pennedCaretSlots");

function removable(doc, position) {
  const boundary = doc.resolve(position);
  return boundary.parent.canReplace(boundary.index(), boundary.index() + 1);
}

function emptySlot(doc, position, id) {
  const node = doc.nodeAt(position);
  return node?.type.name === "paragraph" && node.attrs.id === id && !node.content.size;
}

function columnAtSelection(state, target) {
  if (!target) return null;
  const { $from, $to } = state.selection;
  if (!$from.sameParent($to) || $from.parent.type.name !== "paragraph" || $from.depth < 2 ||
      $from.before() !== target.position || $from.parent.attrs.id !== target.id ||
      $from.node(-1).type.name !== "plainCalloutRow" || $from.node(-1).attrs.id !== target.rowID) return null;
  return { ...target, node: $from.parent, row: $from.node(-1) };
}

// Only tap-created, unused paragraphs are temporary. Existing blank lines are content.
export const CaretSlots = Extension.create({
  name: "pennedCaretSlots",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      key,
      state: {
        init: () => ({ slots: new Map(), column: null, sheet: null }),
        apply(transaction, previous) {
          const action = transaction.getMeta(key);
          if (action?.reset) return { slots: new Map(), column: null, sheet: null };
          if (!transaction.docChanged && !transaction.selectionSet && !action) return previous;
          let slots = previous.slots;
          if (transaction.docChanged || action?.slot) {
            slots = new Map();
            for (const [id, position] of previous.slots) {
              const mapped = transaction.mapping.mapResult(position, 1);
              if (!mapped.deleted && emptySlot(transaction.doc, mapped.pos, id)) slots.set(id, mapped.pos);
            }
            const added = action?.slot;
            if (added && emptySlot(transaction.doc, added.position, added.id)) slots.set(added.id, added.position);
          }
          let column = previous.column;
          if (column && transaction.docChanged) {
            const mapped = transaction.mapping.mapResult(column.position, 1);
            column = mapped.deleted ? null : { ...column, position: mapped.pos };
          }
          column = action?.column ?? column;
          if (!columnAtSelection({ selection: transaction.selection }, column)) column = null;
          let sheet = previous.sheet;
          if (sheet?.active) {
            const bookmark = sheet.bookmark.map(transaction.mapping);
            const expected = bookmark.resolve(transaction.doc);
            sheet = { ...sheet, bookmark, active: transaction.selection.eq(expected) };
          }
          if (action?.begin) sheet = { token: action.begin, bookmark: transaction.selection.getBookmark(), active: true };
          if (action?.end === sheet?.token) sheet = null;
          return { slots, column, sheet };
        },
      },
      appendTransaction(transactions, _oldState, state) {
        if (editor.view.composing || !transactions.some(tr => tr.docChanged || tr.selectionSet)) return null;
        const { slots } = key.getState(state);
        if (!slots.size) return null;
        const { from, to } = state.selection;
        const abandoned = [...slots.values()].filter(position => {
          const end = position + state.doc.nodeAt(position).nodeSize;
          return to < position + 1 || from > end - 1;
        }).sort((a, b) => b - a);
        const tr = state.tr;
        for (const position of abandoned) {
          if (removable(tr.doc, position)) tr.delete(position, position + tr.doc.nodeAt(position).nodeSize);
        }
        return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
      },
    })];
  },
});

export function documentWithoutUnusedCaretSlots(state) {
  const slots = key.getState(state)?.slots;
  if (!slots?.size) return state.doc;
  const transform = new Transform(state.doc);
  for (const position of [...slots.values()].sort((a, b) => b - a)) {
    if (removable(transform.doc, position)) {
      transform.delete(position, position + transform.doc.nodeAt(position).nodeSize);
    }
  }
  return transform.doc;
}

// Leaving the editor (dismissing the keyboard, tapping away) does not move the
// ProseMirror selection, so the in-editor cleanup never fires. Remove any empty,
// untyped tap-slots when focus leaves, so they do not linger or get saved.
export function clearUnusedCaretSlots(editor) {
  const state = editor.state;
  const { slots, sheet } = key.getState(state);
  if (!slots?.size) return;
  const tr = state.tr;
  for (const position of [...slots.values()].sort((a, b) => b - a)) {
    // Preserve the actual insertion location, inside OR outside a row, only
    // while its native insertion sheet owns the current selection.
    if (sheet?.active &&
        state.selection.from > position && state.selection.to < position + state.doc.nodeAt(position).nodeSize) continue;
    const node = tr.doc.nodeAt(position);
    if (node && emptySlot(tr.doc, position, node.attrs.id) && removable(tr.doc, position)) {
      tr.delete(position, position + node.nodeSize);
    }
  }
  if (tr.docChanged) editor.view.dispatch(closeHistory(tr).setMeta("addToHistory", false));
}

export function placeCaretInSlot(editor, position, { column = false } = {}) {
  const { state } = editor;
  const boundary = state.doc.resolve(Math.max(0, Math.min(position, state.doc.content.size)));
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph || !boundary.parent.canReplaceWith(boundary.index(), boundary.index(), paragraph)) return false;
  const reusable = node => node?.type === paragraph && !node.content.size &&
    !editor.storage?.vellixStructuredPlaceholders?.isProtected?.(node);

  let start = boundary.pos;
  let tr = state.tr;
  if (reusable(boundary.nodeAfter)) {
    // Reuse existing empty paragraphs without making them temporary.
  } else if (reusable(boundary.nodeBefore)) {
    start -= boundary.nodeBefore.nodeSize;
  } else {
    const id = crypto.randomUUID();
    tr = closeHistory(tr.insert(start, paragraph.create({ id })));
    tr.setMeta(key, { slot: { id, position: start } }).setMeta("addToHistory", false);
  }
  if (column && boundary.parent.type.name === "plainCalloutRow") {
    tr.setMeta(key, { ...tr.getMeta(key), column: {
      id: tr.doc.nodeAt(start).attrs.id, rowID: boundary.parent.attrs.id, position: start,
    } });
  }
  tr.setSelection(TextSelection.create(tr.doc, start + 1)).setMeta("pointer", true);
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

export function activeColumnInsertion(state) {
  return columnAtSelection(state, key.getState(state)?.column);
}

export function beginCaretInsertion(editor) {
  const token = crypto.randomUUID();
  editor.view.dispatch(editor.state.tr.setMeta(key, { begin: token }).setMeta("addToHistory", false));
  return token;
}

export function hasCaretInsertion(editor, token) {
  return typeof token === "string" && key.getState(editor.state)?.sheet?.token === token;
}

export function restoreCaretInsertion(editor, token) {
  const sheet = key.getState(editor.state)?.sheet;
  if (!sheet || sheet.token !== token) return false;
  const tr = editor.state.tr;
  // Explicitly moving the selection cancels the old bookmark, not the user's
  // insertion. In that case the current document position wins.
  if (sheet.active) tr.setSelection(sheet.bookmark.resolve(tr.doc));
  editor.view.dispatch(tr.setMeta(key, { end: token }).setMeta("addToHistory", false));
  return true;
}

export function endCaretInsertion(editor, token) {
  if (key.getState(editor.state)?.sheet?.token !== token) return false;
  editor.view.dispatch(editor.state.tr.setMeta(key, { end: token }).setMeta("addToHistory", false));
  if (!editor.view.hasFocus()) clearUnusedCaretSlots(editor);
  return true;
}

export function resetCaretInsertions(editor) {
  editor.view.dispatch(editor.state.tr.setMeta(key, { reset: true }).setMeta("addToHistory", false));
}

// Detects a trailing hard break / literal newline on the final line of the last item
// of a list. Covers numbered (orderedList), bulleted (bulletList) and checklists
// (taskList); the item node is listItem for the first two and taskItem for tasks.
export function trailingNumberedLine(state, position = state.selection.$from) {
  if (position.depth < 3 || position.parent.type.name !== "paragraph" ||
      position.parentOffset !== position.parent.content.size) return null;
  const itemName = position.node(-1).type.name, listName = position.node(-2).type.name;
  const listed = (itemName === "listItem" && (listName === "orderedList" || listName === "bulletList")) ||
                 (itemName === "taskItem" && listName === "taskList");
  if (!listed ||
      position.index(-1) !== position.node(-1).childCount - 1 ||
      position.index(-2) !== position.node(-2).childCount - 1) return null;
  const last = position.parent.lastChild;
  const newline = last?.isText ? last.text.match(/\r?\n$/)?.[0] : null;
  const size = last?.type.name === "hardBreak" ? last.nodeSize : newline?.length;
  if (!size) return null;
  const after = position.after(position.depth - 2), boundary = state.doc.resolve(after);
  if (!boundary.parent.canReplaceWith(boundary.index(), boundary.index(), state.doc.type.schema.nodes.paragraph)) return null;
  return { position, size, after };
}

export function separateTrailingNumberedLine(tr) {
  if (!tr.selection.empty) return false;
  const line = trailingNumberedLine(tr);
  if (!line) return false;
  const { position, size, after } = line;
  const marks = tr.storedMarks || position.marks();
  const paragraph = tr.doc.type.schema.nodes.paragraph.create({
    id: crypto.randomUUID(), indent: position.parent.attrs.indent || 0,
    textAlign: position.parent.attrs.textAlign || null,
  });
  // Move exactly the final line break into a real sibling paragraph. Everything
  // before that break, including the numbered item and its rich text, stays put.
  tr.delete(position.pos - size, position.pos);
  tr.insert(after - size, paragraph);
  tr.setSelection(TextSelection.create(tr.doc, after - size + 1));
  tr.ensureMarks(marks);
  return true;
}

export function placeCaretOnTrailingNumberedLine(editor, target, clientX, clientY) {
  const { view, state } = editor;
  if (!view.dom.contains(target) || target.closest("table, .vellix-table-wrapper")) return false;
  const hit = view.posAtCoords({ left: clientX, top: clientY });
  if (!hit) return false;
  const line = trailingNumberedLine(state, state.doc.resolve(hit.pos));
  if (!line || editor.storage?.vellixStructuredPlaceholders?.isProtected?.(line.position.parent)) return false;
  const element = view.nodeDOM(line.position.before());
  if (!(element instanceof HTMLElement)) return false;
  const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
  const height = parseFloat(style.lineHeight);
  const bottom = rect.bottom - (parseFloat(style.paddingBottom) || 0);
  if (!Number.isFinite(height) || height <= 0 || clientX < rect.left || clientX > rect.right ||
      clientY < bottom - height || clientY > rect.bottom) return false;
  const tr = state.tr.setSelection(TextSelection.create(state.doc, line.position.pos));
  if (!separateTrailingNumberedLine(tr)) return false;
  editor.view.dispatch(tr.setMeta("pointer", true).scrollIntoView());
  editor.view.focus();
  return true;
}

function blockBounds(view, node, position) {
  const element = view.nodeDOM(position);
  if (!(element instanceof HTMLElement) || element.hidden) return null;
  const surface = element.matches(".vellix-page-reference")
    ? element.querySelector(".vellix-page-reference-button") : element;
  const rect = surface?.getBoundingClientRect();
  if (!rect || rect.height <= 0 || rect.width <= 0) return null;
  // Lists have no painted surface of their own. Their trailing padding must not
  // turn a tap below the last textblock into a paragraph inside the last item.
  if (["orderedList", "bulletList", "listItem"].includes(node.type.name) && node.lastChild) {
    const last = blockBounds(view, node.lastChild, position + node.nodeSize - 1 - node.lastChild.nodeSize);
    if (last) return { top: rect.top, bottom: last.bottom };
  }
  if (!node.isTextblock || node.type.spec.code || !node.content.size) return rect;
  const range = document.createRange();
  range.selectNodeContents(element);
  const lines = [...range.getClientRects()].filter(line => line.width > 0 && line.height > 0);
  return lines.length ? {
    top: Math.min(...lines.map(line => line.top)),
    bottom: Math.max(...lines.map(line => line.bottom)),
  } : rect;
}

export function blockGapAtPoint(editor, target, clientX, clientY) {
  const { view, state } = editor;
  if (!view.dom.contains(target) || target.closest(
    "button, a, input, textarea, select, audio, video, iframe, [role='button'], table, .vellix-table-wrapper",
  )) return null;
  const hit = view.posAtCoords({ left: clientX, top: clientY });
  if (!hit) return null;
  const candidates = new Set();
  const seeds = [hit.pos];
  if (hit.inside >= 0) seeds.push(hit.inside);
  seeds.push(view.posAtDOM(target, 0));
  for (const seed of seeds) {
    const resolved = state.doc.resolve(seed);
    for (let depth = resolved.depth; depth >= 0; depth--) {
      const parent = resolved.node(depth);
      if (!parent.isTextblock) {
        const index = resolved.index(depth);
        candidates.add(resolved.posAtIndex(index, depth));
        if (index < parent.childCount) candidates.add(resolved.posAtIndex(index + 1, depth));
      }
      if (depth) {
        candidates.add(resolved.before(depth));
        candidates.add(resolved.after(depth));
      }
    }
  }
  for (const position of candidates) {
    const boundary = state.doc.resolve(position);
    const parent = boundary.parent;
    // Horizontal row insertion belongs exclusively to the explicit empty-column
    // target. Vertical gap hit-testing must not create another cell in that row.
    if (parent.type.name === "plainCalloutRow") continue;
    // Item-edge whitespace belongs to the surrounding list, not an implicit
    // continuation paragraph. Genuine gaps between an item's blocks still work.
    if (parent.type.name === "listItem" &&
        (boundary.index() === 0 || boundary.index() === parent.childCount)) continue;
    if (!parent.canReplaceWith(boundary.index(), boundary.index(), state.schema.nodes.paragraph)) continue;
    // A toggle's first block is its summary, not an insertion gap above its body.
    if (parent.type.name === "toggleItem" && boundary.index() === 0) continue;
    const before = boundary.nodeBefore;
    const after = boundary.nodeAfter;
    const left = before && blockBounds(view, before, position - before.nodeSize);
    const right = after && blockBounds(view, after, position);
    if ((before && !left) || (after && !right)) continue;
    const container = boundary.depth ? view.nodeDOM(boundary.before()) : view.dom;
    if (!(container instanceof HTMLElement)) continue;
    const rect = container.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right) continue;
    const top = left?.bottom ?? rect.top;
    const bottom = right?.top ?? rect.bottom;
    if (clientY >= top && clientY < bottom) return position;
  }
  return null;
}

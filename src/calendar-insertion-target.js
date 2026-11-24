import { NodeSelection, TextSelection } from '@tiptap/pm/state';

// A Calendar can display Friday while ProseMirror's selection still points at
// the first (hidden) date panel. All block insertion commands use the selection,
// so resolve it to the visible date before any insertion code runs.
export function ensureCalendarInsertionSelection(tr, { stripPos = null, date = null, force = false } = {}) {
  let containerPos = stripPos;
  const { $from } = tr.selection;
  let selectedPanelDate = null;
  if (containerPos == null) {
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type.name === 'weekDayPanel') selectedPanelDate = $from.node(depth).attrs.date;
      if ($from.node(depth).type.name === 'weekStrip') {
        containerPos = $from.before(depth);
        break;
      }
    }
    if (containerPos == null && tr.selection instanceof NodeSelection &&
        tr.selection.node.type.name === 'weekStrip') containerPos = tr.selection.from;
  }
  if (!Number.isInteger(containerPos)) return null;
  const strip = tr.doc.nodeAt(containerPos);
  if (strip?.type.name !== 'weekStrip') return null;
  const active = date ?? strip.attrs.selectedDate;
  if (typeof active !== 'string') return null;
  let targetPos = null, target = null;
  strip.forEach((panel, offset) => {
    if (panel.type.name === 'weekDayPanel' && panel.attrs.date === active) {
      targetPos = containerPos + 1 + offset;
      target = panel;
    }
  });
  if (targetPos == null || !target) return null;
  // Do not interfere with normal typing, text selection, or an explicit caret
  // already inside the active date. Only stale/atomic selections need repair.
  if (!force && selectedPanelDate === active && tr.selection instanceof TextSelection) return null;

  let paragraphPos = null;
  let addedParagraph = false;
  target.forEach((child, offset) => {
    if (child.isTextblock) paragraphPos = targetPos + 1 + offset;
  });
  if (paragraphPos == null) {
    const type = tr.doc.type.schema.nodes.paragraph;
    if (!type || !target.canReplaceWith(target.childCount, target.childCount, type)) return null;
    const insertAt = targetPos + target.nodeSize - 1;
    const attrs = type.spec.attrs && 'id' in type.spec.attrs ? { id: globalThis.crypto.randomUUID() } : undefined;
    tr.insert(insertAt, type.create(attrs));
    paragraphPos = insertAt;
    addedParagraph = true;
  }
  const textblock = tr.doc.nodeAt(paragraphPos);
  if (!textblock?.isTextblock) return null;
  tr.setSelection(TextSelection.create(tr.doc, paragraphPos + 1 + textblock.content.size));
  return { date: active, stripID: strip.attrs.id ?? null, addedParagraph };
}

// The direct Insert Divider route used to always append to the document root.
export function selectionInsideCalendar(selection) {
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'weekDayPanel') return true;
  }
  return selection instanceof NodeSelection && selection.node.type.name === 'weekStrip';
}

// Remember which Calendar the user last navigated or tapped. WKWebView can
// restore an older native caret after dismissing the formatting toolbar, even
// though the visible Calendar date has not changed.
const recentlyActiveCalendar = new WeakMap();
export function rememberActiveCalendar(editor, stripID, date) {
  if (editor && typeof stripID === 'string' && typeof date === 'string') {
    recentlyActiveCalendar.set(editor, { stripID, date });
  }
}
export function forgetActiveCalendar(editor) {
  recentlyActiveCalendar.delete(editor);
}
export function activeCalendarTarget(editor) {
  const remembered = recentlyActiveCalendar.get(editor);
  if (!remembered) return null;
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'weekStrip' && node.attrs.id === remembered.stripID) {
      if (node.attrs.selectedDate === remembered.date &&
          node.content.content.some(child => child.attrs.date === remembered.date)) {
        found = { stripID: remembered.stripID, date: remembered.date, stripPos: pos };
      }
      return false;
    }
  });
  return found;
}

// The Add Block > Paragraph action and taps in the empty area below an Event
// must establish a *real text caret* in that day's own contentDOM. Reuse the
// last empty paragraph, otherwise append below the last existing block.
// Never replace or move an existing Page Card, Event, or other child node.
export function appendParagraphToCalendarDate(tr, { stripID, date }) {
  if (typeof stripID !== 'string' || typeof date !== 'string') return null;
  let stripPos = null, strip = null;
  tr.doc.descendants((node, pos) => {
    if (node.type.name === 'weekStrip' && node.attrs.id === stripID) {
      stripPos = pos; strip = node; return false;
    }
  });
  if (!strip) return null;
  let panelPos = null, panel = null;
  strip.forEach((child, offset) => {
    if (child.type.name === 'weekDayPanel' && child.attrs.date === date) {
      panelPos = stripPos + 1 + offset; panel = child;
    }
  });
  if (panelPos === null || !panel) return null;
  const paragraphType = tr.doc.type.schema.nodes.paragraph;
  if (!paragraphType) return null;
  const last = panel.lastChild;
  const reuse = last?.type === paragraphType && last.content.size === 0;
  let position;
  if (reuse) {
    position = panelPos + panel.nodeSize - 1 - last.nodeSize;
  } else {
    if (!panel.canReplaceWith(panel.childCount, panel.childCount, paragraphType)) return null;
    position = panelPos + panel.nodeSize - 1;
    const attrs = paragraphType.spec.attrs && 'id' in paragraphType.spec.attrs
      ? { id: globalThis.crypto.randomUUID() } : undefined;
    tr.insert(position, paragraphType.create(attrs));
  }
  tr.setSelection(TextSelection.create(tr.doc, position + 1));
  return { stripID, date, inserted: !reuse, position };
}

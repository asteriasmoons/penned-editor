import { ReplaceStep } from "@tiptap/pm/transform";

// Index only feature nodes; map their positions instead of walking unchanged text.
export function changedRanges(transaction) {
  const ranges = [];
  const add = (from, to, remaining) => {
    from = remaining.map(from, -1); to = remaining.map(to, 1);
    const size = transaction.doc.content.size;
    from = Math.max(0, Math.min(size, from)); to = Math.max(from, Math.min(size, to));
    ranges.push({ from, to });
  };
  transaction.steps.forEach((step, index) => {
    const remaining = transaction.mapping.slice(index + 1);
    let mapped = false;
    step.getMap().forEach((_from, _to, from, to) => { mapped = true; add(from, to, remaining); });
    if (!mapped && Number.isFinite(step.from)) add(step.from, step.to ?? step.from, remaining);
    else if (!mapped && Number.isFinite(step.pos)) add(step.pos, step.pos + 1, remaining);
  });
  ranges.sort((a, b) => a.from - b.from);
  return ranges.reduce((result, range) => {
    const last = result[result.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else result.push({ ...range });
    return result;
  }, []);
}

export function createNodeIndex(doc, accepts, descendIntoMatch = true) {
  const records = [];
  const descend = node => typeof descendIntoMatch === "function" ? descendIntoMatch(node) : descendIntoMatch;
  doc.descendants((node, pos) => {
    if (accepts(node)) { records.push({ node, pos }); return descend(node); }
    return !node.isText;
  });
  return { doc, records, changed: records };
}

export function updateNodeIndex(previous, transaction, accepts, descendIntoMatch = true) {
  if (!previous || previous.doc !== transaction.before) return createNodeIndex(transaction.doc, accepts, descendIntoMatch);
  if (!transaction.docChanged) return previous;
  const descend = node => typeof descendIntoMatch === "function" ? descendIntoMatch(node) : descendIntoMatch;
  const ranges = changedRanges(transaction), byPosition = new Map();
  for (const record of previous.records) {
    const start = transaction.mapping.mapResult(record.pos, 1);
    if (start.deleted) continue;
    const end = transaction.mapping.map(record.pos + record.node.nodeSize, -1);
    const touched = ranges.some(range => range.from <= end && range.to >= start.pos);
    const node = touched ? transaction.doc.nodeAt(start.pos) : record.node;
    if (node && touched) {
      const resolved = transaction.doc.resolve(start.pos);
      let drop = false;
      for (let depth = resolved.depth; depth > 0; depth--) {
        const ancestor = resolved.node(depth);
        if (accepts(ancestor)) { drop = !descend(ancestor); break; }
      }
      if (drop) continue;
    }
    if (node && accepts(node)) byPosition.set(start.pos, node === record.node && start.pos === record.pos ? record : { node, pos: start.pos });
  }
  for (const range of ranges) {
    const from = Math.max(0, range.from - 1), to = Math.min(transaction.doc.content.size, range.to + 1);
    if (from >= to) continue;
    transaction.doc.nodesBetween(from, to, (node, pos) => {
      if (accepts(node)) { byPosition.set(pos, { node, pos }); return descend(node); }
      return !node.isText;
    });
  }
  const records = [...byPosition.values()].sort((a, b) => a.pos - b.pos);
  const oldNodes = new Set(previous.records.map(record => record.node));
  return { doc: transaction.doc, records, changed: records.filter(record => !oldNodes.has(record.node)) };
}

const textEdits = new WeakMap();

// A closed replacement of text inside one textblock keeps all block IDs and
// reference/attachment nodes intact. Atoms, structural edits and attr steps
// deliberately use the regular path.
export function inlineTextEdit(transaction) {
  if (!transaction.docChanged) return false;
  if (textEdits.has(transaction)) return textEdits.get(transaction);
  const inline = transaction.steps.every((step, index) => {
    if (!(step instanceof ReplaceStep) || step.slice.openStart || step.slice.openEnd) return false;
    const doc = transaction.docs[index], from = doc.resolve(step.from);
    const to = step.from === step.to ? from : doc.resolve(step.to);
    if (!from.sameParent(to) || !from.parent.isTextblock) return false;
    let textOnly = true;
    step.slice.content.forEach(node => { if (!node.isText) textOnly = false; });
    if (textOnly && step.from !== step.to) {
      from.parent.nodesBetween(from.parentOffset, to.parentOffset, node => { if (!node.isText) textOnly = false; });
    }
    return textOnly;
  });
  textEdits.set(transaction, inline);
  return inline;
}

globalThis.PennedIncrementalNodes = { changedRanges, createNodeIndex, updateNodeIndex, inlineTextEdit };

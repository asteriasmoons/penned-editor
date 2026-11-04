import test from "node:test";
import assert from "node:assert/strict";
import { getSchema, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { history, undo, redo } from "@tiptap/pm/history";
import { separateTrailingNumberedLine, trailingNumberedLine } from "../src/caret-slots.js";

const PlainCallout = Node.create({ name: "plainCallout", group: "block", content: "block+", isolating: true,
  addAttributes: () => ({ id: { default: null }, widthPercent: { default: 50 } }) });
const schema = getSchema([StarterKit, PlainCallout]);
const p = content => ({ type: "paragraph", ...(content ? { content } : {}) });
function fixture(kind, inCallout, prefix = []) {
  const last = kind === "hardBreak" ? { type: "hardBreak" } : { type: "text", text: "\n" };
  const list = { type: "orderedList", content: [p(), p(), p(), p([...prefix, last])]
    .map(paragraph => ({ type: "listItem", content: [paragraph] })) };
  const content = inCallout ? [{ type: "plainCallout", attrs: { id: "box", widthPercent: 50 }, content: [list] }] : [list];
  content.push(p([{ type: "text", text: "Outside" }]));
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content }), plugins: [history()] });
  let end;
  state.doc.descendants((node, pos) => { if (node.isTextblock && node.lastChild?.type.name === (kind === "hardBreak" ? "hardBreak" : "text") &&
    (kind === "hardBreak" || node.textContent.endsWith("\n"))) end = pos + 1 + node.content.size; });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)));
  return { get state() { return state; }, dispatch(tr) { state = state.apply(tr); } };
}

for (const kind of ["hardBreak", "newline"]) {
  for (const inCallout of [false, true]) {
    test(`${kind} trailing blank line exits to a sibling paragraph ${inCallout ? "inside a callout" : "in the document"}`, () => {
      const h = fixture(kind, inCallout);
      const original = h.state.doc.toJSON();
      assert.equal(h.state.selection.$from.parent.nodeSize, 3, "Matches the reported one-inline-unit paragraph");
      assert.equal(h.state.selection.$from.parentOffset, 1);
      assert(trailingNumberedLine(h.state));
      const tr = h.state.tr;
      assert.equal(separateTrailingNumberedLine(tr), true);
      h.dispatch(tr);
      const saved = h.state.doc.toJSON();
      const siblings = inCallout ? saved.content[0].content : saved.content;
      const beforeList = inCallout ? original.content[0].content[0] : original.content[0];
      assert.equal(siblings[0].content.length, 4);
      assert.deepEqual(siblings[0].content.slice(0, 3), beforeList.content.slice(0, 3));
      assert.equal(siblings[0].content[3].content[0].content, undefined);
      assert.equal(siblings[1].type, "paragraph");
      assert.equal(h.state.selection.$from.node(-1).type.name, inCallout ? "plainCallout" : "doc");
      assert.equal(h.state.selection.$from.parentOffset, 0);
      assert.deepEqual(saved.content.at(-1), original.content.at(-1));
      if (inCallout) assert.deepEqual(saved.content[0].attrs, original.content[0].attrs);
      assert(undo(h.state, h.dispatch));
      assert.deepEqual(h.state.doc.toJSON(), original);
      assert(redo(h.state, h.dispatch));
      assert.deepEqual(h.state.doc.toJSON(), saved);
    });

    test(`${kind} exit retains the numbered text and marks before its final break`, () => {
      const prefix = [{ type: "text", text: "Keep item four", marks: [{ type: "bold" }] }];
      const h = fixture(kind, inCallout, prefix);
      const tr = h.state.tr.setStoredMarks([schema.marks.bold.create()]);
      assert.equal(separateTrailingNumberedLine(tr), true);
      h.dispatch(tr);
      const saved = h.state.doc.toJSON();
      const list = inCallout ? saved.content[0].content[0] : saved.content[0];
      assert.deepEqual(list.content[3].content[0].content, prefix);
      h.dispatch(h.state.tr.insertText("Next line"));
      assert.equal(h.state.selection.$from.parent.textContent, "Next line");
      assert(h.state.selection.$from.parent.firstChild.marks.some(mark => mark.type.name === "bold"));
    });
  }
}

test("only the final break moves; earlier blank lines remain in item four", () => {
  const h = fixture("hardBreak", true, [{ type: "hardBreak" }]);
  const tr = h.state.tr;
  assert.equal(separateTrailingNumberedLine(tr), true);
  h.dispatch(tr);
  assert.deepEqual(h.state.doc.toJSON().content[0].content[0].content[3].content[0].content, [{ type: "hardBreak" }]);
});

test("a range selection and the position before the break do not trigger this exit", () => {
  const h = fixture("hardBreak", true);
  const end = h.state.selection.from;
  h.dispatch(h.state.tr.setSelection(TextSelection.create(h.state.doc, end - 1, end)));
  assert.equal(separateTrailingNumberedLine(h.state.tr), false);
  h.dispatch(h.state.tr.setSelection(TextSelection.create(h.state.doc, end - 1)));
  assert.equal(trailingNumberedLine(h.state), null);
});

test("a break in a nonfinal numbered item retains normal list-line behavior", () => {
  const h = fixture("hardBreak", false);
  const list = h.state.doc.firstChild;
  h.dispatch(h.state.tr.insert(list.nodeSize - 1, schema.nodes.listItem.create(null, schema.nodes.paragraph.create()))));
  assert.equal(trailingNumberedLine(h.state), null);
});

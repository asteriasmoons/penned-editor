import test from "node:test";
import assert from "node:assert/strict";
import { Extension, Node, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ListItem } from "@tiptap/extension-list";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { history, undo, redo } from "@tiptap/pm/history";
import { createCalloutListBackspace } from "../src/callout-list-backspace.js";

const Callout = Node.create({ name: "callout", group: "block", content: "block+", isolating: true,
  addAttributes: () => ({ id: { default: null }, color: { default: "#8FE9FF" }, widthPercent: { default: null } }) });
const PlainCallout = Callout.extend({ name: "plainCallout" });
const Row = Node.create({ name: "plainCalloutRow", group: "block", content: "block*", selectable: false,
  addAttributes: () => ({ id: { default: null } }) });
const IDs = Extension.create({ name: "testIDs", addGlobalAttributes: () => [{
  types: ["paragraph", "heading", "orderedList", "bulletList", "listItem"],
  attributes: { id: { default: null } },
}] });
const schema = getSchema([StarterKit.configure({ listItem: false }),
  ListItem.extend({ content: "(paragraph | heading) block*" }), Callout, PlainCallout, Row, IDs]);
const paragraph = (id, text) => ({ type: "paragraph", attrs: { id },
  content: text ? [{ type: "text", text, marks: [{ type: "bold" }] }] : [] });
const numbered = () => ({ type: "orderedList", attrs: { id: "numbers", start: 3 }, content: [
  { type: "listItem", attrs: { id: "one" }, content: [paragraph("one-text", "One")] },
  { type: "listItem", attrs: { id: "two" }, content: [paragraph("two-text", "Two")] },
] });
const box = (type, content, id = "box") => ({ type, attrs: { id, color: "#8FE9FF", widthPercent: 50 }, content });

function setup(content, options = {}) {
  const transactions = [];
  const editor = { isEditable: options.editable !== false,
    commands: { undoInputRule: () => options.undoInputRule === true } };
  const extension = createCalloutListBackspace({ selectionActive: () => options.selectionActive === true });
  const plugin = extension.config.addProseMirrorPlugins.call({ editor })[0];
  editor.state = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content }), plugins: [plugin, history()] });
  editor.view = { composing: options.composing === true, dispatch(tr) {
    const result = editor.state.applyTransaction(tr);
    editor.state = result.state;
    transactions.push(...result.transactions);
  } };
  const select = (id, offset = 0) => {
    let at;
    editor.state.doc.descendants((node, pos) => { if (node.isTextblock && node.attrs.id === id) at = pos + 1 + offset; });
    assert.notEqual(at, undefined);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
  };
  const key = overrides => plugin.props.handleKeyDown(editor.view, { key: "Backspace", ...overrides });
  const beforeinput = overrides => {
    const event = { inputType: "deleteContentBackward", cancelable: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...overrides };
    return { handled: plugin.props.handleDOMEvents.beforeinput(editor.view, event), event };
  };
  const calloutID = () => {
    const { $from } = editor.state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      if (["callout", "plainCallout"].includes($from.node(depth).type.name)) return $from.node(depth).attrs.id;
    }
    return null;
  };
  return { editor, transactions, select, key, beforeinput, calloutID };
}

for (const type of [null, "callout", "plainCallout"]) {
  for (const input of ["key", "beforeinput"]) {
    test(`${type || "document"} blank numbered tail exits to an ordinary paragraph through ${input}`, () => {
      const list = numbered();
      list.content.push({ type: "listItem", attrs: { id: "empty-item" }, content: [paragraph("exit", "")] });
      const content = type ? [box(type, [list])] : [list];
      const h = setup([...content, paragraph("outside", "Outside")]);
      h.select("exit");
      const original = h.editor.state.doc.toJSON();
      const previousList = structuredClone(type ? original.content[0].content[0] : original.content[0]);
      previousList.content.pop();
      h.transactions.length = 0;
      assert.equal(input === "key" ? h.key() : h.beforeinput().handled, true);
      assert.equal(h.transactions.length, 1);
      const saved = h.editor.state.doc.toJSON();
      const siblings = type ? saved.content[0].content : saved.content;
      assert.deepEqual(siblings[0], previousList);
      assert.equal(siblings[1].type, "paragraph");
      assert.equal(siblings[1].attrs.id, "exit");
      assert.equal(h.editor.state.selection.$from.parent.attrs.id, "exit");
      assert.equal(h.editor.state.selection.$from.parentOffset, 0);
      assert.equal(h.editor.state.selection.$from.node(-1).type.name, type || "doc");
      assert.deepEqual(saved.content.at(-1), original.content.at(-1));
      if (type) assert.deepEqual(saved.content[0].attrs, original.content[0].attrs);
      assert(undo(h.editor.state, tr => h.editor.view.dispatch(tr)));
      assert.deepEqual(h.editor.state.doc.toJSON(), original);
      assert(redo(h.editor.state, tr => h.editor.view.dispatch(tr)));
      assert.deepEqual(h.editor.state.doc.toJSON(), saved);
      assert.equal(h.editor.state.selection.$from.parent.attrs.id, "exit");
    });
  }

  test(`${type || "document"} a blank continuation after item text exits without moving the numbered content`, () => {
    const list = numbered();
    list.content[1].content.push(paragraph("exit", ""));
    const h = setup(type ? [box(type, [list])] : [list]);
    h.select("exit");
    const original = h.editor.state.doc.toJSON();
    const previousList = structuredClone(type ? original.content[0].content[0] : original.content[0]);
    previousList.content[1].content.pop();
    assert.equal(h.key(), true);
    const saved = h.editor.state.doc.toJSON();
    const siblings = type ? saved.content[0].content : saved.content;
    assert.deepEqual(siblings[0], previousList);
    assert.equal(siblings[1].type, "paragraph");
    assert.equal(siblings[1].attrs.id, "exit");
    assert.equal(h.editor.state.selection.$from.node(-1).type.name, type || "doc");
    assert.equal(h.editor.state.selection.$from.parentOffset, 0);
  });
}

test("a nested numbered tail exits only its inner list and retains the outer item", () => {
  const inner = numbered();
  inner.attrs.id = "inner-numbers";
  inner.content.push({ type: "listItem", attrs: { id: "empty-item" }, content: [paragraph("exit", "")] });
  const outer = { type: "orderedList", attrs: { id: "outer-numbers" }, content: [
    { type: "listItem", attrs: { id: "outer-item" }, content: [paragraph("outer-text", "Outer"), inner] },
  ] };
  const h = setup([outer]);
  h.select("exit");
  const original = h.editor.state.doc.toJSON();
  assert.equal(h.beforeinput().handled, true);
  const saved = h.editor.state.doc.toJSON();
  assert.deepEqual(saved.content[0].attrs, original.content[0].attrs);
  const item = saved.content[0].content[0];
  assert.deepEqual(item.attrs, original.content[0].content[0].attrs);
  assert.deepEqual(item.content[0], original.content[0].content[0].content[0]);
  assert.equal(item.content[1].type, "orderedList");
  assert.equal(item.content[1].content.length, 2);
  assert.equal(item.content[2].type, "paragraph");
  assert.equal(h.editor.state.selection.$from.parent.attrs.id, "exit");
  assert.equal(h.editor.state.selection.$from.node(-1).attrs.id, "outer-item");
});

test("numbered items with following content do not use the trailing-line exit", () => {
  const list = numbered();
  list.content[0].content = [paragraph("empty-first", "")];
  const h = setup([list]);
  h.select("empty-first");
  assert.equal(h.key(), false);
  const trailingBlocks = numbered();
  trailingBlocks.content[1].content = [paragraph("empty-before-text", ""), paragraph("kept", "Keep")];
  const h2 = setup([trailingBlocks]);
  h2.select("empty-before-text");
  assert.equal(h2.beforeinput().handled, false);
});

test("exiting a blank numbered line preserves the other side-by-side callout", () => {
  const list = numbered();
  list.content[1].content.push(paragraph("exit", ""));
  const h = setup([{ type: "plainCalloutRow", attrs: { id: "row" }, content: [
    box("plainCallout", [list], "left"), box("plainCallout", [paragraph("right-text", "Keep this")], "right"),
  ] }]);
  h.select("exit");
  const original = h.editor.state.doc.toJSON();
  assert.equal(h.beforeinput().handled, true);
  const saved = h.editor.state.doc.toJSON();
  assert.equal(h.calloutID(), "left");
  assert.deepEqual(saved.content[0].attrs, original.content[0].attrs);
  assert.deepEqual(saved.content[0].content[0].attrs, original.content[0].content[0].attrs);
  assert.deepEqual(saved.content[0].content[1], original.content[0].content[1]);
  assert.equal(saved.content[0].content[0].content[1].attrs.id, "exit");
});

test("ordinary-document list exits still respect read-only, composition, and block selection", () => {
  for (const options of [{ editable: false }, { composing: true }, { selectionActive: true }]) {
    const list = numbered();
    list.content[1].content.push(paragraph("exit", ""));
    const h = setup([list], options);
    h.select("exit");
    const original = h.editor.state.doc.toJSON();
    assert.equal(h.key(), false);
    assert.equal(h.beforeinput().handled, false);
    assert.deepEqual(h.editor.state.doc.toJSON(), original);
  }
});

for (const type of ["callout", "plainCallout"]) {
  test(`${type} numbered Backspace joins the preceding item and keeps the caret at the join`, () => {
    const h = setup([box(type, [numbered()]), paragraph("outside", "Outside")]);
    h.select("two-text");
    const original = h.editor.state.doc.toJSON();
    h.transactions.length = 0;
    assert.equal(h.key(), true);
    assert.equal(h.transactions.length, 1);
    assert.equal(h.calloutID(), "box");
    assert.equal(h.editor.state.selection.$from.parent.textContent, "OneTwo");
    assert.equal(h.editor.state.selection.$from.parentOffset, 3);
    const saved = h.editor.state.doc.toJSON();
    assert.equal(saved.content[0].content[0].type, "orderedList");
    assert.equal(saved.content[0].content[0].content.length, 1);
    assert.deepEqual(saved.content[0].attrs, original.content[0].attrs);
    assert.deepEqual(saved.content[1], original.content[1]);
    assert(undo(h.editor.state, tr => h.editor.view.dispatch(tr)));
    assert.deepEqual(h.editor.state.doc.toJSON(), original);
    assert(redo(h.editor.state, tr => h.editor.view.dispatch(tr)));
    assert.deepEqual(h.editor.state.doc.toJSON(), saved);
    assert.equal(h.editor.state.selection.$from.parentOffset, 3);
  });

  test(`${type} first numbered item unlists inside the same callout`, () => {
    const h = setup([box(type, [numbered()]), paragraph("outside", "Outside")]);
    h.select("one-text");
    const original = h.editor.state.doc.toJSON();
    assert.equal(h.key(), true);
    assert.equal(h.calloutID(), "box");
    assert.equal(h.editor.state.selection.$from.parent.attrs.id, "one-text");
    assert.equal(h.editor.state.selection.$from.parentOffset, 0);
    const saved = h.editor.state.doc.toJSON();
    assert.equal(saved.content[0].type, type);
    assert.equal(saved.content[0].content[0].type, "paragraph");
    assert.deepEqual(saved.content[0].attrs, original.content[0].attrs);
    assert.deepEqual(saved.content[1], original.content[1]);
    assert.equal(h.editor.state.doc.textContent, "OneTwoOutside");
  });
}

test("native beforeinput uses the same numbered boundary operation", () => {
  const h = setup([box("plainCallout", [numbered()])]);
  h.select("two-text");
  const result = h.beforeinput();
  assert.equal(result.handled, true);
  assert.equal(result.event.defaultPrevented, true);
  assert.equal(h.editor.state.selection.$from.parent.textContent, "OneTwo");
  assert.equal(h.editor.state.selection.$from.parentOffset, 3);
  assert.equal(h.calloutID(), "box");
});

test("numbered Backspace cannot move into another side-by-side callout", () => {
  const h = setup([{ type: "plainCalloutRow", attrs: { id: "row" }, content: [
    box("plainCallout", [numbered()], "left"), box("plainCallout", [paragraph("right-text", "Keep this")], "right"),
  ] }]);
  h.select("two-text");
  const original = h.editor.state.doc.toJSON();
  assert.equal(h.key(), true);
  const saved = h.editor.state.doc.toJSON();
  assert.equal(h.calloutID(), "left");
  assert.deepEqual(saved.content[0].attrs, original.content[0].attrs);
  assert.deepEqual(saved.content[0].content[0].attrs, original.content[0].content[0].attrs);
  assert.deepEqual(saved.content[0].content[1], original.content[0].content[1]);
});

test("Backspace inside a callout nested in a numbered item must not lift the outer item", () => {
  const list = numbered();
  list.content[0].content.push(box("plainCallout", [paragraph("inner", "")], "inner-box"));
  const h = setup([list]);
  h.select("inner");
  const original = h.editor.state.doc.toJSON(), selection = h.editor.state.selection;
  assert.equal(h.key(), true);
  assert.deepEqual(h.editor.state.doc.toJSON(), original);
  assert(h.editor.state.selection.eq(selection));
  assert.equal(h.calloutID(), "inner-box");
});

test("a paragraph after a numbered list joins back without the list keymap's cut-and-reselect path", () => {
  const h = setup([box("plainCallout", [numbered(), paragraph("following", "After")])]);
  h.select("following");
  assert.equal(h.key(), true);
  assert.equal(h.editor.state.selection.$from.parent.textContent, "TwoAfter");
  assert.equal(h.editor.state.selection.$from.parentOffset, 3);
  assert.equal(h.calloutID(), "box");
});

test("ordinary character deletion, ranges, other lists, and non-callout numbered lists stay on existing paths", () => {
  const h = setup([box("plainCallout", [numbered()])]);
  h.select("two-text", 2);
  const before = h.editor.state.doc.toJSON();
  assert.equal(h.key(), false);
  assert.deepEqual(h.editor.state.doc.toJSON(), before);
  const end = h.editor.state.selection.from;
  h.editor.view.dispatch(h.editor.state.tr.setSelection(TextSelection.create(h.editor.state.doc, end - 1, end)));
  assert.equal(h.key(), false);
  const outside = setup([numbered()]);
  outside.select("two-text");
  assert.equal(outside.key(), false);
  const bullet = numbered(); bullet.type = "bulletList";
  const bullets = setup([box("plainCallout", [bullet])]);
  bullets.select("two-text");
  assert.equal(bullets.key(), false);
});

test("read-only, composition, selection mode, modifiers, and noncancelable input are not intercepted", () => {
  for (const options of [{ editable: false }, { composing: true }, { selectionActive: true }]) {
    const h = setup([box("plainCallout", [numbered()])], options);
    h.select("two-text");
    assert.equal(h.key(), false);
    assert.equal(h.beforeinput().handled, false);
  }
  const h = setup([box("plainCallout", [numbered()])]);
  h.select("two-text");
  assert.equal(h.key({ metaKey: true }), false);
  assert.equal(h.key({ altKey: true }), false);
  assert.equal(h.beforeinput({ inputType: "deleteWordBackward" }).handled, false);
  assert.equal(h.beforeinput({ cancelable: false }).handled, false);
});

test("existing input-rule undo takes precedence at a numbered callout boundary", () => {
  const h = setup([box("plainCallout", [numbered()])], { undoInputRule: true });
  h.select("one-text");
  const original = h.editor.state.doc.toJSON();
  assert.equal(h.key(), true);
  assert.deepEqual(h.editor.state.doc.toJSON(), original);
});

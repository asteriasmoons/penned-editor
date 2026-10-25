import test from "node:test";
import assert from "node:assert/strict";
import { Extension, Node, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DOMSerializer, Slice } from "@tiptap/pm/model";
import { history, undo, redo } from "@tiptap/pm/history";
import "../src/structured-placeholders.js";

// Exercise the real schema and transaction plugins without launching a browser or app.
function setup(json) {
  globalThis.window = globalThis;
  globalThis.document = { createElement: () => ({}), head: { appendChild() {} } };
  const requests = [];
  globalThis.webkit = { messageHandlers: { tiptap: { postMessage: event => requests.push(event) } } };
  globalThis.tiptapCommand = async () => true;
  const extension = globalThis.VellixStructuredPlaceholders.createExtension({
    Extension, Plugin, PluginKey, Decoration, DecorationSet, TextSelection, DOMSerializer
  });
  const Callout = Node.create({ name: "callout", group: "block", content: "block+",
    addAttributes() { return { color: { default: "#FF00BB" }, icon: { default: "sparkle" } }; },
    renderHTML() { return ["div", 0]; } });
  const PlainCallout = Node.create({ name: "plainCallout", group: "block", content: "block+",
    addAttributes() { return { color: { default: "#FF00BB" } }; }, renderHTML() { return ["div", 0]; } });
  const Toggle = Node.create({ name: "toggleItem", group: "block", content: "block+",
    addAttributes() { return { open: { default: true } }; }, renderHTML() { return ["div", 0]; } });
  const IDs = Extension.create({ name: "testIDs", addGlobalAttributes() {
    return [{ types: ["paragraph", "heading", "codeBlock", "callout", "plainCallout", "toggleItem"], attributes: { id: { default: null } } }];
  } });
  const schema = getSchema([StarterKit, Callout, PlainCallout, Toggle, IDs, extension]);
  const plugin = extension.config.addProseMirrorPlugins()[0];
  const doc = schema.nodeFromJSON(json);
  const editor = {
    state: EditorState.create({ schema, doc, plugins: [plugin, history()] }), schema,
    extensionManager: { extensions: [extension] }, isFocused: true,
    getJSON() { return this.state.doc.toJSON(); }
  };
  const transactions = [];
  editor.view = {
    dom: { classList: { toggle() {} } }, focus() {},
    dispatch(tr) {
      const result = editor.state.applyTransaction(tr);
      transactions.push(...result.transactions);
      editor.state = result.state;
    }
  };
  globalThis.VellixStructuredPlaceholders.initialize(editor);
  return { editor, plugin, requests, transactions, command: globalThis.tiptapCommand };
}
function paragraph(text = "", attrs = {}) {
  return { type: "paragraph", attrs, content: text ? [{ type: "text", text }] : [] };
}
function select(editor, pos) { editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos))); }

test("authoring guidance is serialized separately and shown only in empty consumer regions", async () => {
  const { editor, plugin, command } = setup({ type: "doc", content: [paragraph()] });
  await command("setTemplateEditing", { enabled: true });
  await command("setPlaceholderMode", { active: true });
  editor.view.dispatch(editor.state.tr.insertText("What did you learn?"));
  assert.equal(editor.state.doc.textContent, "What did you learn?");
  const saved = editor.getJSON();
  assert.deepEqual(saved.content[0].content, []);
  assert.equal(saved.content[0].attrs.placeholderGuidance[0].text, "What did you learn?");
  assert.equal(editor.getText(), "");
  assert(!("placeholderProjection" in saved.content[0].attrs));
  await command("setPlaceholderMode", { active: false });
  assert.equal(editor.state.doc.textContent, "");
  let decorations = plugin.props.decorations(editor.state).find();
  assert.equal(decorations[0].type.attrs["data-vellix-guidance"], "What did you learn?");
  await command("setTemplateEditing", { enabled: false });
  editor.view.dispatch(editor.state.tr.insertText("I learned to draw."));
  assert.equal(plugin.props.decorations(editor.state).find().length, 0);
  assert.equal(editor.getText(), "I learned to draw.");
  editor.view.dispatch(editor.state.tr.delete(1, editor.state.doc.content.size - 1));
  assert.equal(plugin.props.decorations(editor.state).find().length, 1);
});

test("existing content needs explicit conversion and guidance can return to ordinary content", async () => {
  const { editor, requests, command } = setup({ type: "doc", content: [paragraph("Keep this instruction")] });
  await command("setTemplateEditing", { enabled: true });
  await command("setPlaceholderMode", { active: true });
  assert.equal(editor.getText(), "Keep this instruction");
  assert.equal(requests[0].kind, "placeholderConversionRequest");
  await command("placeholderAction", { action: "convert", token: requests[0].payload.token });
  assert.equal(editor.getText(), "");
  await command("placeholderAction", { action: "ordinary" });
  assert.equal(editor.getText(), "Keep this instruction");
  assert.equal(editor.getJSON().content[0].attrs.placeholderEnabled, false);
});

test("callouts inside toggles retain styling and permanent siblings", async () => {
  const { editor, command } = setup({ type: "doc", content: [{ type: "toggleItem", content: [
    paragraph("Permanent instruction"), { type: "callout", attrs: { color: "#FF00BB", icon: "moon" }, content: [paragraph()] }
  ] }] });
  let target;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === "paragraph" && !node.textContent) target = pos + 1; });
  select(editor, target);
  await command("setTemplateEditing", { enabled: true });
  await command("setPlaceholderMode", { active: true });
  editor.view.dispatch(editor.state.tr.insertText("Describe your day"));
  const saved = editor.getJSON();
  assert.equal(saved.content[0].content[0].content[0].text, "Permanent instruction");
  const callout = saved.content[0].content[1];
  assert.equal(callout.attrs.color, "#FF00BB");
  assert.equal(callout.attrs.icon, "moon");
  assert.deepEqual(callout.content[0].content, []);
  assert.equal(callout.content[0].attrs.placeholderGuidance[0].text, "Describe your day");
});

test("guidance edits use ProseMirror history and cannot be copied as text", async () => {
  const { editor, plugin, command } = setup({ type: "doc", content: [paragraph()] });
  await command("setTemplateEditing", { enabled: true });
  await command("setPlaceholderMode", { active: true });
  editor.view.dispatch(editor.state.tr.insertText("Prompt"));
  const slice = new Slice(editor.state.doc.content, 0, 0);
  assert.equal(plugin.props.clipboardTextSerializer(slice), "");
  const copied = plugin.props.transformCopied(slice);
  assert.equal(copied.content.textBetween(0, copied.content.size), "");
  assert(undo(editor.state, tr => editor.view.dispatch(tr)));
  assert.equal(editor.getText(), "");
  assert(redo(editor.state, tr => editor.view.dispatch(tr)));
  assert.equal(editor.getJSON().content[0].attrs.placeholderGuidance[0].text, "Prompt");
  await command("placeholderAction", { action: "clear" });
  assert.equal(editor.getJSON().content[0].attrs.placeholderEnabled, false);
  assert.equal(editor.getText(), "");
});

test("ordinary documents cannot activate creation controls", async () => {
  const { editor, command } = setup({ type: "doc", content: [paragraph("Actual content")] });
  assert.equal(await command("setPlaceholderMode", { active: true }), false);
  assert.equal(await command("placeholderAction", { action: "convert" }), false);
  assert.equal(editor.getText(), "Actual content");
});

test("multiple fields remain independent when focus moves", async () => {
  const { editor, command } = setup({ type: "doc", content: [paragraph("", { id: "first" }), paragraph("", { id: "second" })] });
  await command("setTemplateEditing", { enabled: true });
  await command("setPlaceholderMode", { active: true });
  editor.view.dispatch(editor.state.tr.insertText("First prompt"));
  const secondPos = editor.state.doc.child(0).nodeSize + 1;
  select(editor, secondPos);
  editor.view.dispatch(editor.state.tr.insertText("Second prompt"));
  const saved = editor.getJSON();
  assert.equal(saved.content[0].attrs.placeholderGuidance[0].text, "First prompt");
  assert.equal(saved.content[1].attrs.placeholderGuidance[0].text, "Second prompt");
  assert.equal(editor.getText().trim(), "");
});

test("heading conversion retains guidance and its inline formatting", async () => {
  const { editor, command } = setup({ type: "doc", content: [paragraph("", { id: "field" })] });
  await command("setTemplateEditing", { enabled: true });
  await command("setPlaceholderMode", { active: true });
  editor.view.dispatch(editor.state.tr.insertText("Heading prompt"));
  editor.view.dispatch(editor.state.tr.addMark(1, 15, editor.schema.marks.bold.create()));
  await command("setPlaceholderMode", { active: false });
  editor.view.dispatch(editor.state.tr.setNodeMarkup(0, editor.schema.nodes.heading, { id: "field", level: 2 }));
  const saved = editor.getJSON().content[0];
  assert.equal(saved.type, "heading");
  assert.equal(saved.attrs.placeholderGuidance[0].text, "Heading prompt");
  assert.equal(saved.attrs.placeholderGuidance[0].marks[0].type, "bold");
  assert.deepEqual(saved.content || [], []);
});

test("block deletion in guidance mode is not mistaken for text conversion", async () => {
  const { editor, command } = setup({ type: "doc", content: [paragraph("Delete this", { id: "first" }), paragraph("Keep this", { id: "second" })] });
  await command("setTemplateEditing", { enabled: true });
  await command("setPlaceholderMode", { active: true });
  await command("cancelPlaceholderConversion");
  editor.view.dispatch(editor.state.tr.delete(0, editor.state.doc.child(0).nodeSize));
  assert.equal(editor.state.doc.childCount, 1);
  assert.equal(editor.getText(), "Keep this");
});

test("pasted blocks in guidance mode become metadata, not permanent text", async () => {
  const { editor, plugin, command } = setup({ type: "doc", content: [paragraph()] });
  await command("setTemplateEditing", { enabled: true });
  await command("setPlaceholderMode", { active: true });
  const raw = new Slice(editor.schema.nodeFromJSON({ type: "doc", content: [paragraph("Pasted prompt")] }).content, 0, 0);
  const slice = plugin.props.transformPasted(raw);
  editor.view.dispatch(editor.state.tr.replaceSelection(slice));
  assert.equal(editor.getText(), "");
  assert.equal(editor.getJSON().content[0].attrs.placeholderGuidance[0].text, "Pasted prompt");
});

test("code blocks use the same guidance metadata without changing their type", async () => {
  const { editor, command } = setup({ type: "doc", content: [{ type: "codeBlock", attrs: { id: "code", language: "javascript" }, content: [] }] });
  await command("setTemplateEditing", { enabled: true });
  await command("setPlaceholderMode", { active: true });
  editor.view.dispatch(editor.state.tr.insertText("Write your code here"));
  const saved = editor.getJSON().content[0];
  assert.equal(saved.type, "codeBlock");
  assert.equal(saved.attrs.language, "javascript");
  assert.equal(saved.attrs.placeholderGuidance[0].text, "Write your code here");
  assert.equal(editor.getText(), "");
  await command("setTemplateEditing", { enabled: false });
  editor.view.dispatch(editor.state.tr.insertText("const answer = 42;"));
  assert.equal(editor.getText(), "const answer = 42;");
});

for (const type of ["callout", "plainCallout"]) {
  test(`${type} uppercase guidance typing preserves textblock markup without per-key metadata replacements`, async () => {
    const { editor, command, transactions } = setup({ type: "doc", content: [
      { type, attrs: { id: "callout" }, content: [paragraph("", { id: "prompt" })] }
    ] });
    await command("setTemplateEditing", { enabled: true });
    await command("setPlaceholderMode", { active: true });
    const original = editor.state.selection.$from.parent;
    for (const letter of "MOON PHASE Today") {
      transactions.length = 0;
      editor.view.dispatch(editor.state.tr.insertText(letter).setMeta("composition", 12));
      assert.equal(transactions.length, 1, "Typing must not append a textblock replacement that resets the native keyboard");
      assert(editor.state.selection.$from.parent.sameMarkup(original));
    }
    const saved = editor.getJSON();
    assert.equal(saved.content[0].content[0].attrs.placeholderGuidance[0].text, "MOON PHASE Today");
    assert.deepEqual(saved.content[0].content[0].content, []);
    assert.equal(editor.getText(), "");
    await command("setPlaceholderMode", { active: false });
    assert.equal(editor.state.doc.textContent, "");
    assert.equal(editor.state.doc.child(0).child(0).attrs.placeholderGuidance[0].text, "MOON PHASE Today");
    await command("setPlaceholderMode", { active: true });
    assert.equal(editor.state.doc.textContent, "MOON PHASE Today");
    assert.deepEqual(editor.getJSON(), saved);
  });

  test(`${type} retains uppercase replacements, formatting and caret during guidance composition`, async () => {
    const { editor, command, transactions } = setup({ type: "doc", content: [{ type,
      attrs: { id: "note", color: "#7EEAC8" }, content: [paragraph("", { id: "prompt", placeholderEnabled: true,
        placeholderGuidance: [{ type: "text", text: "moon", marks: [{ type: "bold" }] }] })]
    }] });
    await command("setTemplateEditing", { enabled: true });
    await command("setPlaceholderMode", { active: true });
    const original = editor.state.doc.child(0).child(0);
    transactions.length = 0;
    editor.view.dispatch(editor.state.tr.insertText("MOON", 2, 6).setMeta("composition", 30));
    assert.equal(transactions.length, 1);
    assert.equal(editor.state.selection.from, 6);
    assert(editor.state.doc.child(0).child(0).sameMarkup(original));
    const saved = editor.getJSON();
    assert.equal(saved.content[0].attrs.color, "#7EEAC8");
    assert.deepEqual(saved.content[0].content[0].attrs.placeholderGuidance, [{ type: "text", text: "MOON", marks: [{ type: "bold" }] }]);
    assert(undo(editor.state, tr => editor.view.dispatch(tr)));
    assert.equal(editor.getJSON().content[0].content[0].attrs.placeholderGuidance[0].text, "moon");
    assert(redo(editor.state, tr => editor.view.dispatch(tr)));
    assert.deepEqual(editor.getJSON(), saved);
    await command("setPlaceholderMode", { active: false });
    const hidden = editor.getJSON().content[0].content[0];
    assert.deepEqual(hidden.attrs, saved.content[0].content[0].attrs);
    assert.deepEqual(hidden.content || [], []);
  });
}

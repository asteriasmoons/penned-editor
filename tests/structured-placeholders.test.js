import test from "node:test";
import assert from "node:assert/strict";
import { Extension, Node, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { AllSelection, EditorState, NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DOMSerializer, Slice } from "@tiptap/pm/model";
import { history, isHistoryTransaction, undo, redo } from "@tiptap/pm/history";
import { ReplaceStep } from "@tiptap/pm/transform";
import { CaretSlots, documentWithoutUnusedCaretSlots, placeCaretInSlot } from "../src/caret-slots.js";
import "../src/structured-placeholders.js";
import "../src/incremental-nodes.js";

// Exercise the real schema and transaction plugins without launching a browser or app.
function setup(json) {
  globalThis.window = globalThis;
  globalThis.document = { createElement: () => ({}), head: { appendChild() {} } };
  const requests = [];
  globalThis.webkit = { messageHandlers: { tiptap: { postMessage: event => requests.push(event) } } };
  globalThis.tiptapCommand = async () => true;
  const extension = globalThis.VellixStructuredPlaceholders.createExtension({
    Extension, Plugin, PluginKey, Decoration, DecorationSet, TextSelection, NodeSelection, DOMSerializer,
    ReplaceStep, isHistoryTransaction
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
    schema,
    storage: { vellixStructuredPlaceholders: extension.config.addStorage() },
    extensionManager: { extensions: [extension] }, isFocused: true,
    getJSON() { return this.state.doc.toJSON(); }
  };
  const caretPlugins = CaretSlots.config.addProseMirrorPlugins.call({ editor });
  editor.state = EditorState.create({ schema, doc, plugins: [...caretPlugins, plugin, history()] });
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
  await command("setTemplateEditing", { enabled: true, documentID: "template-document", templateID: "template-record" });
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
  select(editor, 1);
  editor.view.dispatch(editor.state.tr.insertText("I learned to draw."));
  assert.equal(plugin.props.decorations(editor.state).find().length, 0);
  assert.equal(editor.getText(), "I learned to draw.");
  editor.view.dispatch(editor.state.tr.delete(1, editor.state.doc.content.size - 1));
  assert.equal(plugin.props.decorations(editor.state).find().length, 1);
});

test("existing content needs explicit conversion and guidance can return to ordinary content", async () => {
  const { editor, requests, command } = setup({ type: "doc", content: [paragraph("Keep this instruction")] });
  await command("setTemplateEditing", { enabled: true, documentID: "template-document", templateID: "template-record" });
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
  await command("setTemplateEditing", { enabled: true, documentID: "template-document", templateID: "template-record" });
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
  await command("setTemplateEditing", { enabled: true, documentID: "template-document", templateID: "template-record" });
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
  assert.equal(await command("setTemplateEditing", { enabled: true }), false);
  assert.equal(await command("setTemplateEditing", { enabled: true, documentID: "ordinary", templateID: null }), false);
  assert.equal(await command("setPlaceholderMode", { active: true }), false);
  assert.equal(await command("placeholderAction", { action: "convert" }), false);
  assert.equal(editor.getText(), "Actual content");
});

const protectedPrompt = () => paragraph("", { id: "prompt", placeholderEnabled: true,
  placeholderGuidance: [{ type: "text", text: "Keep this prompt", marks: [{ type: "italic" }] }] });

test("disabled Placeholder Mode protects guidance against edits and paste starting outside the placeholder", async () => {
  const h = setup({ type: "doc", content: [paragraph("Before", { id: "before" }), protectedPrompt(), paragraph("After", { id: "after" })] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  const { editor } = h, original = editor.getJSON();
  const position = editor.state.doc.firstChild.nodeSize;
  const end = position + editor.state.doc.child(1).nodeSize;
  const attempts = [
    () => editor.state.tr.insertText("Overwrite", position + 1),
    () => editor.state.tr.delete(1, end + 1),
    () => editor.state.tr.join(position),
    () => editor.state.tr.delete(position - 1, end),
    () => editor.state.tr.replaceWith(1, end + 1, editor.schema.text("Pasted text")),
    () => editor.state.tr.setNodeMarkup(position, undefined, { id: "prompt", placeholderEnabled: false }),
    () => editor.state.tr.setNodeMarkup(position, undefined, { ...editor.state.doc.child(1).attrs,
      placeholderGuidance: [{ type: "text", text: "Changed metadata" }] }),
  ];
  for (const attempt of attempts) {
    editor.view.dispatch(attempt());
    assert.deepEqual(editor.getJSON(), original);
  }
  editor.view.dispatch(editor.state.tr.insertText("Safe edit ", 1));
  assert(editor.getText().startsWith("Safe edit Before"));
  assert.deepEqual(editor.getJSON().content[1], original.content[1]);
});

test("only attempts to enter protected guidance are blocked without moving the ordinary caret elsewhere", async () => {
  const h = setup({ type: "doc", content: [paragraph("Before", { id: "before" }), protectedPrompt(), paragraph("After", { id: "after" })] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  const position = h.editor.state.doc.firstChild.nodeSize;
  const before = h.editor.state.selection;
  select(h.editor, position + 1);
  assert(h.editor.state.selection.eq(before));
  select(h.editor, position + h.editor.state.doc.child(1).nodeSize + 1);
  const after = h.editor.state.selection;
  select(h.editor, position + 1);
  assert(h.editor.state.selection.eq(after));
  assert.equal(h.editor.state.doc.childCount, 3);
  assert.equal(h.plugin.props.decorations(h.editor.state).find()[0].type.attrs.contenteditable, "false");
});

test("disabling Placeholder Mode locks the live guidance immediately, including metadata actions", async () => {
  const h = setup({ type: "doc", content: [protectedPrompt()] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  await h.command("setPlaceholderMode", { active: true });
  select(h.editor, 1);
  h.editor.view.dispatch(h.editor.state.tr.insertText("Edited "));
  const saved = h.editor.getJSON();
  await h.command("setPlaceholderMode", { active: false });
  assert(h.editor.state.selection instanceof NodeSelection, "The caret cannot remain inside newly locked guidance");
  assert.equal(h.editor.state.doc.childCount, 1, "Protection must not insert fallback paragraphs");
  assert.equal(await h.command("placeholderAction", { action: "clear" }), false);
  h.editor.view.dispatch(h.editor.state.tr.insertText("Replacement", 1));
  assert.deepEqual(h.editor.getJSON(), saved);
  await h.command("setPlaceholderMode", { active: true });
  select(h.editor, 1);
  assert(h.editor.state.selection instanceof TextSelection);
  assert.equal(h.editor.state.doc.textContent, "Edited Keep this prompt");
});

test("an all-placeholder template uses normal user-initiated blank-space insertion without automatic extra blocks", async () => {
  const h = setup({ type: "doc", content: [protectedPrompt()] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  assert(h.editor.state.selection instanceof NodeSelection);
  assert.equal(h.editor.getJSON().content.length, 1);
  assert(placeCaretInSlot(h.editor, h.editor.state.doc.content.size));
  assert(h.editor.state.selection instanceof TextSelection);
  assert.equal(h.editor.state.selection.$head.parent.attrs.placeholderEnabled, false);
  h.editor.view.dispatch(h.editor.state.tr.insertText("Ordinary template content"));
  const saved = h.editor.getJSON();
  assert.deepEqual(saved.content[0].attrs.placeholderGuidance, protectedPrompt().attrs.placeholderGuidance);
  assert.equal(saved.content[0].content.length, 0);
  assert.equal(saved.content[1].content[0].text, "Ordinary template content");
  assert.equal(saved.content[1].attrs.placeholderEnabled, false);
});

test("blank-space caret placement never reuses a protected empty paragraph", async () => {
  const h = setup({ type: "doc", content: [paragraph("Before", { id: "before" }), protectedPrompt()] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  assert(placeCaretInSlot(h.editor, h.editor.state.doc.content.size));
  assert(h.editor.state.selection instanceof TextSelection);
  assert.equal(h.editor.state.selection.$head.parent.attrs.placeholderEnabled, false);
  assert.notEqual(h.editor.state.selection.$head.parent.attrs.id, "before");
  assert.equal(h.editor.state.doc.childCount, 3);
  assert.equal(documentWithoutUnusedCaretSlots(h.editor.state).childCount, 2);
  h.editor.view.dispatch(h.editor.state.tr.insertText("After"));
  assert.equal(h.editor.getJSON().content[2].content[0].text, "After");
  assert.deepEqual(h.editor.getJSON().content[1].attrs.placeholderGuidance, protectedPrompt().attrs.placeholderGuidance);
});

test("blank template paragraphs retain the original caret and normal typing with Placeholder Mode off", async () => {
  const h = setup({ type: "doc", content: [paragraph("", { id: "blank" })] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  const originalCaret = h.editor.state.selection;
  assert(h.editor.state.selection instanceof TextSelection);
  assert.equal(h.editor.state.selection.$head.parent.attrs.placeholderEnabled, false);
  const unchanged = h.editor.getJSON();
  for (let repeat = 0; repeat < 3; repeat++) {
    await h.command("setPlaceholderMode", { active: false });
    assert.deepEqual(h.editor.getJSON(), unchanged);
    assert.equal(h.editor.state.doc.childCount, 1);
    assert(h.editor.state.selection.eq(originalCaret));
  }
  h.editor.view.dispatch(h.editor.state.tr.insertText("I can type"));
  assert.equal(h.editor.getText(), "I can type");
  assert.equal(h.editor.state.doc.firstChild.attrs.placeholderEnabled, false);
});

test("guidance typed into a new blank paragraph still uses the existing authoring path", async () => {
  const h = setup({ type: "doc", content: [paragraph("", { id: "blank" })] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  await h.command("setPlaceholderMode", { active: true });
  h.editor.view.dispatch(h.editor.state.tr.insertText("Write your answer"));
  await h.command("setPlaceholderMode", { active: false });
  const saved = h.editor.getJSON();
  assert.equal(saved.content.length, 1);
  assert.equal(saved.content[0].attrs.placeholderEnabled, true);
  assert.equal(saved.content[0].attrs.placeholderGuidance[0].text, "Write your answer");
  assert(h.editor.state.selection instanceof NodeSelection);
});

test("template placeholder protection does not intercept the editor's normal click selection", async () => {
  const h = setup({ type: "doc", content: [paragraph("Ordinary"), protectedPrompt()] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  assert.equal(h.plugin.props.handleClickOn, undefined);
  assert.equal(h.plugin.props.decorations(h.editor.state).find()[0].type.attrs.contenteditable, "false");
  await h.command("setPlaceholderMode", { active: true });
  assert.equal(h.plugin.props.handleClickOn, undefined);
});

test("locked template guidance does not collapse native text ranges with endpoints in a placeholder", async () => {
  const h = setup({ type: "doc", content: [paragraph("Before", { id: "before" }),
    paragraph("Read-only guidance", protectedPrompt().attrs), paragraph("After", { id: "after" })] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  const original = h.editor.getJSON();
  const position = h.editor.state.doc.firstChild.nodeSize;
  const after = position + h.editor.state.doc.child(1).nodeSize;
  for (const [anchor, head] of [[position + 3, after + 3], [after + 3, position + 3], [2, position + 3]]) {
    const selection = TextSelection.create(h.editor.state.doc, anchor, head);
    h.transactions.length = 0;
    h.editor.view.dispatch(h.editor.state.tr.setSelection(selection));
    assert(h.editor.state.selection.eq(selection), "Highlighting must not be converted into a caret or node selection");
    assert.equal(h.transactions.length, 1, "Selection alone must not append a caret-restoration transaction");
    assert.deepEqual(h.editor.getJSON(), original);
    h.editor.view.dispatch(h.editor.state.tr.insertText("Replacement"));
    assert.deepEqual(h.editor.getJSON(), original, "Typing over the range must still preserve protected guidance");
    assert(h.editor.state.selection.eq(selection));
    h.editor.view.dispatch(h.editor.state.tr.deleteSelection());
    assert.deepEqual(h.editor.getJSON(), original, "Deleting the selected range must not remove protected guidance");
    const paste = new Slice(h.editor.schema.nodeFromJSON({ type: "doc", content: [paragraph("Pasted")] }).content, 0, 0);
    h.editor.view.dispatch(h.editor.state.tr.replaceSelection(paste));
    assert.deepEqual(h.editor.getJSON(), original, "Pasting over the selection must not replace protected guidance");
  }
});

test("node selection and Select All remain available while template guidance is protected", async () => {
  const h = setup({ type: "doc", content: [paragraph("Before"), protectedPrompt(), paragraph("After")] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  const original = h.editor.getJSON();
  const position = h.editor.state.doc.firstChild.nodeSize;
  for (const selection of [NodeSelection.create(h.editor.state.doc, position), new AllSelection(h.editor.state.doc)]) {
    h.transactions.length = 0;
    h.editor.view.dispatch(h.editor.state.tr.setSelection(selection));
    assert(h.editor.state.selection.eq(selection));
    assert.equal(h.transactions.length, 1);
    h.editor.view.dispatch(h.editor.state.tr.setMeta("selectionPresentation", true).setMeta("addToHistory", false));
    assert(h.editor.state.selection.eq(selection), "Selection-only metadata must not reset the selected blocks");
    assert.deepEqual(h.editor.getJSON(), original);
  }
});

test("selected placeholder blocks can be deleted or cut with Placeholder Mode off and restored by history", async () => {
  for (const uiEvent of [null, "cut"]) {
    const h = setup({ type: "doc", content: [paragraph("Before"), protectedPrompt(), paragraph("After")] });
    await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
    const original = h.editor.getJSON();
    const position = h.editor.state.doc.firstChild.nodeSize;
    h.editor.view.dispatch(h.editor.state.tr.setSelection(NodeSelection.create(h.editor.state.doc, position)));
    const deletion = h.editor.state.tr.deleteSelection();
    if (uiEvent) deletion.setMeta("uiEvent", uiEvent);
    h.editor.view.dispatch(deletion);
    assert.equal(h.editor.state.doc.childCount, 2);
    assert.equal(h.editor.getJSON().content.some(node => node.attrs.id === "prompt"), false);
    assert(undo(h.editor.state, tr => h.editor.view.dispatch(tr)));
    assert.deepEqual(h.editor.getJSON(), original);
    assert(redo(h.editor.state, tr => h.editor.view.dispatch(tr)));
    assert.equal(h.editor.state.doc.childCount, 2);
    assert.equal(h.editor.getJSON().content.some(node => node.attrs.id === "prompt"), false);
  }
});

test("Select All can delete a template including its placeholders and keep the normal empty editor", async () => {
  const h = setup({ type: "doc", content: [protectedPrompt()] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  const original = h.editor.getJSON();
  h.editor.view.dispatch(h.editor.state.tr.setSelection(new AllSelection(h.editor.state.doc)));
  h.editor.view.dispatch(h.editor.state.tr.deleteSelection());
  assert.equal(h.editor.state.doc.childCount, 1);
  assert.equal(h.editor.state.doc.firstChild.type.name, "paragraph");
  assert.equal(h.editor.state.doc.firstChild.attrs.placeholderEnabled, false);
  assert(h.editor.state.selection instanceof TextSelection);
  assert(undo(h.editor.state, tr => h.editor.view.dispatch(tr)));
  assert.deepEqual(h.editor.getJSON(), original);
  assert(redo(h.editor.state, tr => h.editor.view.dispatch(tr)));
  assert.equal(h.editor.state.doc.firstChild.attrs.placeholderEnabled, false);
});

test("a text selection covering a whole placeholder can delete it without entering guidance", async () => {
  const h = setup({ type: "doc", content: [paragraph("Before"), protectedPrompt(), paragraph("After")] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  h.editor.view.dispatch(h.editor.state.tr.setSelection(TextSelection.create(h.editor.state.doc, 1, h.editor.state.doc.content.size - 1)));
  h.editor.view.dispatch(h.editor.state.tr.deleteSelection());
  assert.equal(h.editor.state.doc.childCount, 1);
  assert.equal(h.editor.state.doc.firstChild.attrs.placeholderEnabled, false);
  assert.equal(h.editor.getText(), "");
});

test("deleting a selected nested placeholder preserves the parent's required empty editing block", async () => {
  const h = setup({ type: "doc", content: [{ type: "plainCallout", attrs: { id: "callout" }, content: [protectedPrompt()] }] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  h.editor.view.dispatch(h.editor.state.tr.setSelection(NodeSelection.create(h.editor.state.doc, 1)));
  h.editor.view.dispatch(h.editor.state.tr.deleteSelection());
  let promptRemains = false;
  h.editor.state.doc.descendants(node => { if (node.attrs.id === "prompt") promptRemains = true; });
  assert.equal(promptRemains, false);
  assert.equal(h.editor.state.doc.textContent, "");
  assert(h.editor.state.selection instanceof TextSelection);
});

test("typing or pasting over a selected placeholder is not treated as deliberate deletion", async () => {
  const h = setup({ type: "doc", content: [protectedPrompt()] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  const original = h.editor.getJSON();
  h.editor.view.dispatch(h.editor.state.tr.insertText("Overwrite"));
  assert.deepEqual(h.editor.getJSON(), original);
  const pasted = new Slice(h.editor.schema.nodeFromJSON({ type: "doc", content: [paragraph("Pasted")] }).content, 0, 0);
  h.editor.view.dispatch(h.editor.state.tr.replaceSelection(pasted).setMeta("uiEvent", "paste"));
  assert.deepEqual(h.editor.getJSON(), original);
});

test("block deletion can remove selected nested placeholders without deleting unselected guidance", async () => {
  const first = protectedPrompt(), second = paragraph("", { ...protectedPrompt().attrs, id: "second" });
  const kept = paragraph("", { ...protectedPrompt().attrs, id: "kept" });
  const h = setup({ type: "doc", content: [{ type: "plainCallout", attrs: { id: "callout" },
    content: [first, paragraph("Keep ordinary content"), second] }, kept] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  const ranges = [];
  let keptPosition;
  h.editor.state.doc.descendants((node, pos) => {
    if (["prompt", "second"].includes(node.attrs.id)) ranges.push({ from: pos, to: pos + node.nodeSize });
    if (node.attrs.id === "kept") keptPosition = pos;
  });
  const original = h.editor.getJSON();
  h.editor.view.dispatch(h.editor.state.tr.delete(keptPosition, keptPosition + h.editor.state.doc.nodeAt(keptPosition).nodeSize)
    .setMeta("pennedPlaceholderDeletion", ranges));
  assert.deepEqual(h.editor.getJSON(), original, "A deletion command must not remove an unselected placeholder");
  const deletion = h.editor.state.tr;
  for (const range of ranges.slice().sort((a, b) => b.from - a.from)) deletion.delete(range.from, range.to);
  h.editor.view.dispatch(deletion.setMeta("pennedPlaceholderDeletion", ranges));
  const saved = h.editor.getJSON();
  assert.equal(saved.content[0].content.length, 1);
  assert.equal(saved.content[0].content[0].content[0].text, "Keep ordinary content");
  assert.deepEqual(saved.content[1], original.content[1]);
});

test("whole-document block deletion keeps remaining placeholders intact through undo and redo", async () => {
  const kept = paragraph("", { ...protectedPrompt().attrs, id: "kept" });
  const h = setup({ type: "doc", content: [paragraph("Before"), protectedPrompt(), kept, paragraph("After")] });
  await h.command("setTemplateEditing", { enabled: true, documentID: "template", templateID: "template" });
  const original = h.editor.getJSON(), doc = h.editor.state.doc;
  const position = doc.firstChild.nodeSize;
  const remaining = [];
  doc.forEach(node => { if (node.attrs.id !== "prompt") remaining.push(node); });
  h.editor.view.dispatch(h.editor.state.tr.replaceWith(0, doc.content.size, remaining)
    .setMeta("pennedPlaceholderDeletion", [{ from: position, to: position + doc.child(1).nodeSize }]));
  const deleted = h.editor.getJSON();
  assert.equal(deleted.content.length, 3);
  assert.deepEqual(deleted.content[1], original.content[2]);
  assert(undo(h.editor.state, tr => h.editor.view.dispatch(tr)));
  assert.deepEqual(h.editor.getJSON(), original);
  assert(redo(h.editor.state, tr => h.editor.view.dispatch(tr)));
  assert.deepEqual(h.editor.getJSON(), deleted);
});

test("ordinary-document placeholder filling retains the original blank-space caret behavior", async () => {
  const h = setup({ type: "doc", content: [protectedPrompt()] });
  assert(placeCaretInSlot(h.editor, h.editor.state.doc.content.size));
  assert.equal(h.editor.state.doc.childCount, 1);
  assert.equal(h.editor.state.selection.from, 1);
  h.editor.view.dispatch(h.editor.state.tr.insertText("My answer"));
  assert.equal(h.editor.getText(), "My answer");
  assert.deepEqual(h.editor.getJSON().content[0].attrs.placeholderGuidance, protectedPrompt().attrs.placeholderGuidance);
});

test("ordinary template copies can fill placeholders without enabling authoring or changing guidance", async () => {
  const h = setup({ type: "doc", content: [protectedPrompt()] });
  assert.equal(await h.command("setPlaceholderMode", { active: true }), false);
  select(h.editor, 1);
  h.editor.view.dispatch(h.editor.state.tr.insertText("My actual answer"));
  const saved = h.editor.getJSON().content[0];
  assert.equal(saved.content[0].text, "My actual answer");
  assert.deepEqual(saved.attrs.placeholderGuidance, protectedPrompt().attrs.placeholderGuidance);
  assert.equal(h.plugin.props.decorations(h.editor.state).find().length, 0);
});

test("multiple fields remain independent when focus moves", async () => {
  const { editor, command } = setup({ type: "doc", content: [paragraph("", { id: "first" }), paragraph("", { id: "second" })] });
  await command("setTemplateEditing", { enabled: true, documentID: "template-document", templateID: "template-record" });
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
  await command("setTemplateEditing", { enabled: true, documentID: "template-document", templateID: "template-record" });
  await command("setPlaceholderMode", { active: true });
  editor.view.dispatch(editor.state.tr.insertText("Heading prompt"));
  editor.view.dispatch(editor.state.tr.addMark(1, 15, editor.schema.marks.bold.create()));
  editor.view.dispatch(editor.state.tr.setNodeMarkup(0, editor.schema.nodes.heading, { id: "field", level: 2 }));
  const saved = editor.getJSON().content[0];
  assert.equal(saved.type, "heading");
  assert.equal(saved.attrs.placeholderGuidance[0].text, "Heading prompt");
  assert.equal(saved.attrs.placeholderGuidance[0].marks[0].type, "bold");
  assert.deepEqual(saved.content || [], []);
  await command("setPlaceholderMode", { active: false });
  editor.view.dispatch(editor.state.tr.setNodeMarkup(0, editor.schema.nodes.heading, { id: "field", level: 3 }));
  assert.equal(editor.getJSON().content[0].attrs.level, 2, "Disabled Placeholder Mode also protects placeholder formatting");
});

test("block deletion in guidance mode is not mistaken for text conversion", async () => {
  const { editor, command } = setup({ type: "doc", content: [paragraph("Delete this", { id: "first" }), paragraph("Keep this", { id: "second" })] });
  await command("setTemplateEditing", { enabled: true, documentID: "template-document", templateID: "template-record" });
  await command("setPlaceholderMode", { active: true });
  await command("cancelPlaceholderConversion");
  editor.view.dispatch(editor.state.tr.delete(0, editor.state.doc.child(0).nodeSize));
  assert.equal(editor.state.doc.childCount, 1);
  assert.equal(editor.getText(), "Keep this");
});

test("pasted blocks in guidance mode become metadata, not permanent text", async () => {
  const { editor, plugin, command } = setup({ type: "doc", content: [paragraph()] });
  await command("setTemplateEditing", { enabled: true, documentID: "template-document", templateID: "template-record" });
  await command("setPlaceholderMode", { active: true });
  const raw = new Slice(editor.schema.nodeFromJSON({ type: "doc", content: [paragraph("Pasted prompt")] }).content, 0, 0);
  const slice = plugin.props.transformPasted(raw);
  editor.view.dispatch(editor.state.tr.replaceSelection(slice));
  assert.equal(editor.getText(), "");
  assert.equal(editor.getJSON().content[0].attrs.placeholderGuidance[0].text, "Pasted prompt");
});

test("code blocks use the same guidance metadata without changing their type", async () => {
  const { editor, command } = setup({ type: "doc", content: [{ type: "codeBlock", attrs: { id: "code", language: "javascript" }, content: [] }] });
  await command("setTemplateEditing", { enabled: true, documentID: "template-document", templateID: "template-record" });
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
    await command("setTemplateEditing", { enabled: true, documentID: "template-document", templateID: "template-record" });
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
    await command("setTemplateEditing", { enabled: true, documentID: "template-document", templateID: "template-record" });
    await command("setPlaceholderMode", { active: true });
    select(editor, 2);
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

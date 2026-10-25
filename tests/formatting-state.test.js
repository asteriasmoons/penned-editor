import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";

const paragraph = (text = "", marks = []) => ({ type: "paragraph", attrs: { id: randomUUID() },
  content: text ? [{ type: "text", text, marks: marks.map(type => ({ type })) }] : [] });

async function runtime(content = [paragraph("Text")]) {
  const events = [];
  const dom = new JSDOM("<!doctype html><div id='editor'></div>",
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://penned.test" });
  const { window } = dom;
  window.console.log = window.console.info = () => {};
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.crypto.randomUUID = randomUUID;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.scrollBy = () => {};
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  window.webkit = { messageHandlers: { tiptap: { postMessage(message) { events.push(JSON.parse(JSON.stringify(message))); } } } };
  for (const file of ["vendor/formula-parser.min.js", "table-formulas.js", "vellix-tables.js", "vendor/table-library.js", "tiptap.bundle.js"]) {
    window.eval(await readFile(new URL("../dist/" + file, import.meta.url), "utf8"));
  }
  const command = (name, args = {}) => window.tiptapCommand(name, args);
  await command("setContent", { document: { type: "doc", content } });
  const editor = window.document.querySelector(".tiptap-editor").editor;
  return { editor, events, command, state: () => events.filter(event => event.kind === "formattingState").at(-1)?.payload,
    close: () => window.close() };
}

test("active text marks follow the real selection, including mixed selections", async () => {
  const h = await runtime([paragraph("Styled", ["bold", "italic", "underline", "strike"]), paragraph("Plain")]);
  try {
    h.editor.commands.setTextSelection(2);
    for (const mark of ["bold", "italic", "underline", "strike"]) assert.equal(h.state()?.[mark], true);
    assert.equal(h.state().code, false);
    h.editor.commands.setTextSelection({ from: 1, to: 12 });
    for (const mark of ["bold", "italic", "underline", "strike"]) assert.equal(h.state()[mark], false);
    h.editor.commands.setTextSelection(10);
    assert.equal(h.state().bold, false);
    const before = h.editor.getJSON();
    h.editor.commands.setTextSelection({ from: 1, to: 7 });
    assert.equal(h.state().bold, true);
    assert.deepEqual(h.editor.getJSON(), before, "Reporting selection never edits the document");
  } finally { h.close(); }
});

test("empty-paragraph stored marks, typing, and inline code update native state", async () => {
  const h = await runtime([paragraph()]);
  try {
    assert.equal(h.state()?.bold, false);
    await h.command("formatCurrentSelection", { action: "bold" });
    assert.equal(h.state().bold, true, "Stored marks must update even without a document change");
    h.editor.commands.insertContent("Bold typing");
    assert.equal(h.state().bold, true);
    await h.command("formatCurrentSelection", { action: "bold" });
    assert.equal(h.state().bold, false);
    await h.command("formatCurrentSelection", { action: "code" });
    assert.equal(h.state().code, true);
    await h.command("formatCurrentSelection", { action: "code" });
    assert.equal(h.state().code, false);
  } finally { h.close(); }
});

test("alignment reflects default left, actual commands, and mixed paragraphs", async () => {
  const right = paragraph("Right"); right.attrs.textAlign = "right";
  const h = await runtime([paragraph("Left"), right]);
  try {
    h.editor.commands.setTextSelection(2);
    assert.equal(h.state()?.alignment, "left");
    for (const alignment of ["center", "right", "left"]) {
      await h.command("formatCurrentSelection", { action: "align", value: alignment });
      assert.equal(h.state().alignment, alignment);
    }
    h.editor.commands.setTextSelection({ from: 1, to: 10 });
    assert.equal(h.state().alignment, null);
    await h.command("formatCurrentSelection", { action: "align", value: "center" });
    assert.equal(h.state().alignment, "center");
  } finally { h.close(); }
});

test("checklist, bullet, and numbered states turn on and off with their existing commands", async () => {
  const h = await runtime();
  try {
    for (const [action, key] of [["bulletList", "bulletList"], ["numberList", "numberList"], ["checkList", "checklist"]]) {
      await h.command("setContent", { document: { type: "doc", content: [paragraph("Item")] } });
      assert.equal(h.state()?.[key], false);
      await h.command("formatCurrentSelection", { action });
      assert.equal(h.state()[key], true);
      await h.command("formatCurrentSelection", { action });
      assert.equal(h.state()[key], false);
    }
  } finally { h.close(); }
});

test("undo, redo, document reload, read-only and block modes never retain stale active styles", async () => {
  const h = await runtime();
  try {
    await h.command("formatCurrentSelection", { action: "bold" });
    assert.equal(h.state()?.bold, true);
    await h.command("undo"); assert.equal(h.state().bold, false);
    await h.command("redo"); assert.equal(h.state().bold, true);
    await h.command("setEditable", { editable: false });
    assert.equal(h.state().bold, false); assert.equal(h.state().alignment, null);
    await h.command("setEditable", { editable: true });
    assert.equal(h.state().bold, true);
    await h.command("setSelectionMode", { mode: "multi" });
    assert.equal(h.state().bold, false); assert.equal(h.state().alignment, null);
    await h.command("setSelectionMode", { mode: "off" });
    assert.equal(h.state().bold, true);
    await h.command("setContent", { document: { type: "doc", content: [paragraph("Other document")] } });
    assert.equal(h.state().bold, false); assert.equal(h.state().alignment, "left");
  } finally { h.close(); }
});

test("unchanged formatting is deduplicated but each loaded document reports its state", async () => {
  const h = await runtime([paragraph()]);
  try {
    assert(h.state(), "An initial formatting event must be available");
    const count = () => h.events.filter(event => event.kind === "formattingState").length;
    const before = count();
    for (const text of ["a", "b", "c"]) h.editor.commands.insertContent(text);
    assert.equal(count(), before, "Typing in the same style must not flood the native toolbar");
    const document = h.editor.getJSON();
    await h.command("setContent", { document });
    assert(count() > before, "A new native session can require an identical state after load");
  } finally { h.close(); }
});

test("template callout guidance uses its projected marks for active formatting", async () => {
  const guided = paragraph();
  guided.attrs.placeholderEnabled = true;
  guided.attrs.placeholderGuidance = [{ type: "text", text: "Guidance", marks: [{ type: "bold" }] }];
  const h = await runtime([{ type: "plainCallout", attrs: { id: "plain", color: "#7EEAC8" }, content: [guided] }]);
  try {
    await h.command("setTemplateEditing", { enabled: true });
    await h.command("setPlaceholderMode", { active: true });
    let position;
    h.editor.state.doc.descendants((node, pos) => { if (node.attrs.id === guided.attrs.id) position = pos + 1; });
    h.editor.commands.setTextSelection(position);
    assert.equal(h.state()?.bold, true);
    assert.equal(h.state().italic, false);
    await h.command("formatCurrentSelection", { action: "italic" });
    assert.equal(h.state().italic, true);
    const saved = await h.command("getDocument");
    const text = saved.content[0].content[0].attrs.placeholderGuidance[0];
    assert(text.marks.some(mark => mark.type === "bold"));
    assert(text.marks.some(mark => mark.type === "italic"));
    assert.equal(saved.content[0].content[0].content?.length ?? 0, 0);
  } finally { h.close(); }
});

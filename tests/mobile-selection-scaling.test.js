import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";

const p = (id, text = "Editable text") => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
const native = async () => {
  const source = await readFile(new URL("../../Vellix/Vellix/Editor/MobileBlockSelection.swift", import.meta.url), "utf8");
  return source.match(/static let script = #"""\n([\s\S]*?)\n"""#/)[1].replaceAll("\\#(selectionGutter)", "6");
};
async function runtime(content) {
  const dom = new JSDOM("<!doctype html><html><head></head><body><main class='vellix-editor-page'><div id='editor'></div></main></body></html>",
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://penned.test" });
  const w = dom.window;
  w.crypto.randomUUID = randomUUID;
  w.console.log = w.console.info = () => {};
  w.webkit = { messageHandlers: { tiptap: { postMessage() {} } } };
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 20, left: 0, right: 0 });
  w.eval(await native());
  for (const file of ["vendor/formula-parser.min.js", "table-formulas.js", "vellix-tables.js", "vendor/table-library.js", "tiptap.bundle.js"])
    w.eval(await readFile(new URL("../dist/" + file, import.meta.url), "utf8"));
  await w.tiptapCommand("setContent", { document: { type: "doc", content } });
  const editor = w.document.querySelector(".tiptap-editor").editor;
  const plugin = editor.state.plugins.find(plugin => plugin.key.startsWith("pennedBlockSelection$"));
  const position = id => w.PennedBlockSelection.records(editor.state.doc).find(r => r.node.attrs.id === id)?.pos;
  return { w, editor, plugin, position,
    paint: () => plugin.props.decorations(editor.state).find(),
    close: () => { editor.destroy(); w.close(); },
  };
}

for (const count of [20, 1500]) test(`${count} blocks: idle typing and selection-only transactions have no permanent selection decorations`, async () => {
  const h = await runtime(Array.from({ length: count }, (_, i) => p(`p-${i}`)));
  try {
    assert.equal(h.paint().length, 0);
    h.editor.commands.setTextSelection(h.position(`p-${Math.floor(count / 2)}`) + 2);
    h.editor.commands.insertContent("typed");
    assert.equal(h.paint().length, 0);
    h.editor.view.dispatch(h.editor.state.tr);
    assert.equal(h.paint().length, 0);
    const index = h.w.PennedBlockSelection.records(h.editor.state.doc);
    const key = index.find(r => r.node.attrs.id === "p-1").key;
    await h.w.tiptapCommand("setSelectionMode", { mode: "multi" });
    h.w.PennedBlockSelection.selectionFacade().add(key);
    assert.equal(h.paint().length, 1, "Only the selected block contributes a span");
    assert.equal(h.w.document.querySelectorAll(".penned-block-selected").length, 1);
    await h.w.tiptapCommand("setSelectionMode", { mode: "off" });
    assert.equal(h.paint().length, 0);
    assert.equal(h.editor.isEditable, true);
  } finally { h.close(); }
});

test("stable node markers keep nested cards, callouts, lists, tables and inserted blocks independently bound", async () => {
  const h = await runtime([
    { type: "plainCallout", attrs: { id: "callout" }, content: [p("nested"),
      { type: "pageReference", attrs: { id: "card" } }] },
    { type: "bulletList", content: [{ type: "listItem", content: [p("bullet")] }] },
    { type: "orderedList", content: [{ type: "listItem", content: [p("number")] }] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { id: "task" }, content: [p("check")] }] },
    { type: "heading", attrs: { id: "heading", level: 2 }, content: [{ type: "text", text: "Heading" }] },
    { type: "divider", attrs: { id: "divider", style: "fourCircles" } },
    { type: "table", attrs: { id: "table", name: "Table1" }, content: [{ type: "tableRow", content: [
      { type: "tableCell", content: [p("cell")] }] }] }, p("last"),
  ]);
  try {
    for (const id of ["nested", "card", "bullet", "number", "check", "heading", "divider", "table", "last"]) assert.notEqual(h.position(id), undefined, id);
    const swipe = async (id, pos = h.position(id)) => {
      const element = h.editor.view.nodeDOM(pos);
      element.getBoundingClientRect = () => ({ top: 10, bottom: 50, left: 0, right: 300, width: 300, height: 40 });
      element.getClientRects = () => [element.getBoundingClientRect()];
      const event = (type, x, touches = true) => {
        const event = new h.w.Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "touches", { value: touches ? [{ identifier: 1, clientX: x, clientY: 30, screenY: 30 }] : [] });
        Object.defineProperty(event, "changedTouches", { value: [{ identifier: 1, clientX: x, clientY: 30, screenY: 30 }] });
        element.dispatchEvent(event);
      };
      event("touchstart", 50); await Promise.resolve();
      assert.equal(h.plugin.getState(h.editor.state).gesture?.origin.pos, pos, id + " keeps its gesture binding");
      event("touchmove", 85); event("touchend", 85, false);
      assert.deepEqual(Array.from(h.w.PennedBlockSelection.selectedRecords(), r => r.pos), [pos]);
      assert.equal(h.paint().length, 1);
      await h.w.tiptapCommand("setSelectionMode", { mode: "off" });
    };
    await swipe("card");
    assert.equal(h.w.document.querySelector('[data-vellix-block-id="callout"]').classList.contains("penned-block-selected"), false);
    for (const id of ["callout", "bullet", "number", "check", "heading", "divider", "table"]) await swipe(id);
    h.editor.commands.setTextSelection(h.position("last") + 1);
    h.editor.commands.splitBlock();
    const inserted = h.editor.state.selection.$from.before();
    // Newly split blocks need gesture bindings before they receive a persistent ID.
    await new Promise(done => h.w.setTimeout(done, 0));
    await swipe("new paragraph", inserted);
    assert.equal(h.paint().length, 0);
  } finally { h.close(); }
});

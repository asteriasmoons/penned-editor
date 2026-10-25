import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import FormulaParser from "fast-formula-parser";
import { Editor, Node, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import * as stateAPI from "@tiptap/pm/state";
import * as modelAPI from "@tiptap/pm/model";
import * as viewAPI from "@tiptap/pm/view";
import * as transformAPI from "@tiptap/pm/transform";
import * as keymapAPI from "@tiptap/pm/keymap";
import "../src/vendor/table-library.js";
import "../src/table-formulas.js";
import "../src/vellix-tables.js";

function mountedEditor(content) {
  const dom = new JSDOM("<!doctype html><html><body><div id='editor'></div></body></html>", { pretendToBeVisual: true });
  for (const key of ["window", "document", "HTMLElement", "Element", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"])
    globalThis[key] = typeof dom.window[key] === "function" && ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  dom.window.Range.prototype.getClientRects = () => [];
  dom.window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 24, right: 100 });
  globalThis.FormulaParser = FormulaParser;
  const events = [];
  const extensions = globalThis.VellixTables.createExtensions({ Node, Extension, ...stateAPI, ...viewAPI,
    post: (kind, payload) => events.push({ kind, payload }), selectionActive: () => false,
    modules: { "prosemirror-state": stateAPI, "prosemirror-model": modelAPI, "prosemirror-view": viewAPI,
      "prosemirror-transform": transformAPI, "prosemirror-keymap": keymapAPI } });
  let transactions = 0, runaway = false;
  const editor = new Editor({ element: document.querySelector("#editor"), extensions: [StarterKit, ...extensions],
    content: content || { type: "doc", content: [{ type: "table", attrs: { id: "table", name: "Table1" }, content: [
      { type: "tableRow", attrs: { id: "row" }, content: ["tableHeader", "tableHeader"].map((type, index) => ({
        type, attrs: { id: "cell" + index, colwidth: [150] }, content: [{ type: "paragraph" }]
      })) }
    ] }, { type: "paragraph" }] },
    onTransaction() { if (++transactions > 40 && !runaway) { runaway = true; editor.destroy(); } }
  });
  globalThis.tiptapCommand = async () => false;
  globalThis.VellixTables.initialize(editor);
  return { editor, dom, events, count: () => transactions, runaway: () => runaway };
}

test("table focus and cell menu do not trigger a DOM mutation transaction loop", async () => {
  const { editor, dom, count, runaway } = mountedEditor();
  try {
    editor.commands.setTextSelection(4);
    editor.view.focus();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(runaway(), false, "table chrome must not be reparsed as user content");
    assert(count() < 15);
    assert(document.querySelector(".vellix-table-active .vellix-table-cell-menu"));
  } finally { if (!editor.isDestroyed) editor.destroy(); dom.window.close(); }
});

test("the first header cell accepts typing, exposes its menu, and saves cell colors immediately", async () => {
  const { editor, dom, events } = mountedEditor();
  try {
    editor.commands.setTextSelection(4); editor.view.focus();
    await new Promise(resolve => setTimeout(resolve, 30));
    editor.commands.insertContent("First cell");
    const menu = document.querySelector(".vellix-table-cell-menu");
    assert(menu); menu.click();
    const opened = events.findLast(event => event.kind === "tableMenuRequest");
    assert.equal(opened.payload.cellID, "cell0");
    assert.equal(opened.payload.contents, "First cell");
    assert(globalThis.VellixTables.command("setCellStyle", { fillColor: "#FF0088", textColor: "#FFFFFF" }));
    assert(globalThis.VellixTables.command("stripeColor", { value: "#0099FF" }));
    const saved = events.findLast(event => event.kind === "tableSnapshot").payload.document;
    assert.equal(saved.content[0].attrs.stripeColor, "#0099FF");
    assert.equal(saved.content[0].content[0].content[0].attrs.fillColor, "#FF0088");
    assert.equal(saved.content[0].content[0].content[0].attrs.textColor, "#FFFFFF");
    assert.equal(editor.schema.nodeFromJSON(saved).firstChild.firstChild.firstChild.textContent, "First cell");
    globalThis.VellixTables.command("close"); editor.view.dom.blur();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(document.querySelector(".vellix-table-active"), null);
  } finally { if (!editor.isDestroyed) editor.destroy(); dom.window.close(); }
});

for (const [rows, columns] of [[0, 2], [3, 0], [0, 0]]) {
  test(`a ${rows}-row, ${columns}-column table survives serialization and can be expanded`, () => {
    const { editor, dom, events } = mountedEditor({ type: "doc", content: [{ type: "paragraph" }] });
    try {
      globalThis.VellixTables.command("requestInsert");
      assert(globalThis.VellixTables.command("insert", { rows, columns }));
      const saved = events.findLast(event => event.kind === "tableSnapshot").payload.document;
      const table = saved.content.find(node => node.type === "table");
      assert(table); assert.equal(table.attrs.rowCount, rows); assert.equal(table.attrs.columnCount, columns);
      assert.equal(table.attrs.emptyTable, true); assert.equal(table.content?.length || 0, 0);
      editor.commands.setContent(saved);
      let position;
      editor.state.doc.descendants((node, pos) => { if (node.type.name === "table") position = pos; });
      editor.commands.setNodeSelection(position);
      assert.equal(globalThis.VellixTables.context().rowCount, rows);
      assert.equal(globalThis.VellixTables.context().columnCount, columns);
      assert(document.querySelector(".vellix-empty-table:not([hidden])"));
      if (!rows) assert(globalThis.VellixTables.command("insertRow"));
      if (!columns) assert(globalThis.VellixTables.command("insertColumn"));
      const expanded = editor.state.doc.nodeAt(position);
      assert.equal(expanded.attrs.emptyTable, false);
      assert.equal(expanded.childCount, rows || 1);
      assert.equal(expanded.firstChild.childCount, columns || 1);
      editor.commands.selectAll(); editor.commands.setTextSelection(position + 4);
      assert(globalThis.VellixTables.command("deleteRows"));
      if ((rows || 1) === 1) assert.equal(editor.state.doc.nodeAt(position).attrs.emptyTable, true);
    } finally { if (!editor.isDestroyed) editor.destroy(); dom.window.close(); }
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import FormulaParser from "fast-formula-parser";
import { Node, Extension, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import * as stateAPI from "@tiptap/pm/state";
import * as modelAPI from "@tiptap/pm/model";
import * as viewAPI from "@tiptap/pm/view";
import * as transformAPI from "@tiptap/pm/transform";
import * as keymapAPI from "@tiptap/pm/keymap";
import { history, undo, redo } from "@tiptap/pm/history";
import "../src/vendor/table-library.js";
import "../src/table-formulas.js";
import "../src/vellix-tables.js";

globalThis.FormulaParser = FormulaParser;
const F = globalThis.VellixTableFormulas;
const cell = (value, formula = null) => ({ value, formula, format: "text" });

test("formulas calculate ranges, chained dependencies, conditions and cross-table references", () => {
  const tables = [{ id: "one", name: "Table1", cells: [
    [cell("10"), cell("", "=SUM(A1:A2)")],
    [cell("20"), cell("", "=ROUND(B1/7,2)")],
    [cell("", '=IF(A1>5,"yes","no")'), cell("", '=Table2!A1+$A$1')],
  ] }, { id: "two", name: "Table2", cells: [[cell("7")]] }];
  const workbook = F.createWorkbook(tables);
  assert.equal(workbook.value("one", 0, 1), 30);
  assert.equal(workbook.value("one", 1, 1), 4.29);
  assert.equal(workbook.value("one", 2, 0), "yes");
  assert.equal(workbook.value("one", 2, 1), 17);
  assert.equal(workbook.preview("one", 2, 1, "=AVERAGE(A1:A2)"), 15);
  assert.equal(tables[0].cells[2][1].formula, "=Table2!A1+$A$1");
});

test("formula errors are visible and circular references are bounded", () => {
  const workbook = F.createWorkbook([{ id: "one", name: "Table1", cells: [
    [cell("", "=B1"), cell("", "=A1"), cell("", "=1/0"), cell("", "=NOTAFUNCTION(1)")],
  ] }]);
  assert.match(F.display(workbook.value("one", 0, 0)), /^#/);
  assert.equal(F.display(workbook.value("one", 0, 2)), "#DIV/0!");
  assert.equal(F.display(workbook.value("one", 0, 3)), "#NAME?");
});

test("reference rewriting uses parsed tokens without rewriting quoted text", () => {
  const move = (row, col) => ({ row: row + 1, col });
  assert.equal(F.rewriteReferences('=SUM($A$1:A2)+IF(A1=1,"A1 stays text",0)', "Table1", "Table1", move),
    '=SUM($A$2:A3)+IF(A2=1,"A1 stays text",0)');
  assert.equal(F.rewriteReferences("=Table2!A1+Table1!A2", "Table2", "Table1", move), "=Table2!A1+Table1!A3");
});

test("renaming a table preserves string literals and escapes new table names", () => {
  assert.equal(F.renameReferences('=Table1!A1+IF(A1=1,"Table1!A1",0)', "Table2", "Table1", "Today's Log"),
    '=\'Today\'\'s Log\'!A1+IF(A1=1,"Table1!A1",0)');
  assert.equal(F.renameReferences("='Old Name'!A1", "Table2", "Old Name", "New Name"), "='New Name'!A1");
});

function setup() {
  globalThis.window = globalThis;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.document = { createElement: () => ({}) };
  const events = [];
  const extensions = globalThis.VellixTables.createExtensions({ Node, Extension,
    ...stateAPI, ...viewAPI, post: (kind, payload) => events.push({ kind, payload }), selectionActive: () => false,
    modules: { "prosemirror-state": stateAPI, "prosemirror-model": modelAPI, "prosemirror-view": viewAPI,
      "prosemirror-transform": transformAPI, "prosemirror-keymap": keymapAPI } });
  const schema = getSchema([StarterKit, ...extensions]);
  const editor = { schema, isEditable: true, isFocused: false };
  const table = { type: "table", attrs: { id: "table", name: "Table1" }, content: [1, 2].map((_, row) => ({
    type: "tableRow", attrs: { id: `row${row}` }, content: [1, 2].map((_, col) => ({
      type: row === 0 ? "tableHeader" : "tableCell", attrs: { id: `cell${row}${col}`, colwidth: [150] },
      content: [{ type: "paragraph", content: [{ type: "text", text: String((row + 1) * 10 + col) }] }]
    }))
  })) };
  const tableExtension = extensions.at(-1);
  const plugins = tableExtension.config.addProseMirrorPlugins.call({ editor });
  editor.state = stateAPI.EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content: [table] }), plugins: [history(), ...plugins] });
  editor.view = {
    dom: { clientWidth: 320, querySelectorAll: () => [] }, focus() { editor.isFocused = true; },
    dispatch(tr) { editor.state = editor.state.applyTransaction(tr).state; },
  };
  editor.commands = {};
  globalThis.tiptapCommand = async () => false;
  globalThis.VellixTables.initialize(editor);
  const map = globalThis.VellixTableLibrary({ "prosemirror-state": stateAPI, "prosemirror-model": modelAPI,
    "prosemirror-view": viewAPI, "prosemirror-keymap": keymapAPI, "prosemirror-transform": transformAPI });
  function select(row, col) {
    const offsets = map.TableMap.get(editor.state.doc.firstChild);
    const pos = 1 + offsets.map[row * offsets.width + col];
    editor.view.dispatch(editor.state.tr.setSelection(stateAPI.TextSelection.create(editor.state.doc, pos + 2)));
  }
  select(1, 1);
  return { editor, events, select, command: globalThis.VellixTables.command, tableExtension, plugins };
}

test("the add-menu insertion command opens table creation without inserting a paragraph", async () => {
  const { editor, events } = setup();
  const before = editor.state.doc.toJSON();
  assert.equal(await globalThis.tiptapCommand("insertBlock", { blockType: "table" }), true);
  assert(events.some(event => event.kind === "tableCreateRequest"));
  assert.deepEqual(editor.state.doc.toJSON(), before);
});

test("Table is exposed in the slash menu and routes through table creation", () => {
  const source = readFileSync(new URL("../src/editor.js", import.meta.url), "utf8");
  assert.match(source, /const SLASH_ITEMS = \[\s*\{ key: "table", title: "Table",[^\n]*icon: "blackcal" \}/);
  assert.match(source, /function insertBlockByKey\(key, range = null\) \{\s*if \(key === "table"\) \{\s*if \(range\) editor\.chain\(\)\.deleteRange\(range\)\.run\(\);\s*return window\.VellixTables\.command\("requestInsert"\);/);
});

test("the real table schema persists styles and formulas, and supports undo and redo", () => {
  const { editor, command } = setup();
  command("setCellStyle", { fillColor: "#FF0044", textColor: "#FFFFFF", bold: true, align: "right" });
  let cell = editor.state.doc.firstChild.child(1).child(1);
  assert.equal(cell.attrs.fillColor, "#FF0044");
  assert.equal(cell.attrs.align, "right");
  command("formula", { value: "=SUM(A1:A2)" });
  cell = editor.state.doc.firstChild.child(1).child(1);
  assert.equal(cell.attrs.formula, "=SUM(A1:A2)");
  assert.equal(cell.textContent, "");
  assert.equal(cell.attrs.calculated, "30");
  const reopened = editor.schema.nodeFromJSON(editor.state.doc.toJSON());
  assert.equal(reopened.firstChild.child(1).child(1).attrs.formula, "=SUM(A1:A2)");
  assert(undo(editor.state, editor.view.dispatch));
  assert(redo(editor.state, editor.view.dispatch));
  assert.equal(editor.state.doc.firstChild.child(1).child(1).attrs.formula, "=SUM(A1:A2)");
});

test("row and column operations use ProseMirror tables and retain formulas and styles", () => {
  const { editor, command, select } = setup();
  command("formula", { value: "=A2+1" });
  select(0, 0);
  assert(command("insertRow"));
  assert.equal(editor.state.doc.firstChild.childCount, 3);
  const formula = editor.state.doc.firstChild.child(2).child(1);
  assert.equal(formula.attrs.formula, "=A3+1");
  select(0, 0);
  assert(command("insertColumn"));
  assert.equal(editor.state.doc.firstChild.firstChild.childCount, 3);
  assert(command("deleteColumns"));
  assert.equal(editor.state.doc.firstChild.firstChild.childCount, 2);
});

test("typing over a formula recalculates dependent cells in the same transaction", () => {
  const { editor, command, select } = setup();
  select(1, 0);
  command("formula", { value: "=5+5" });
  select(1, 1);
  command("formula", { value: "=A2*2" });
  assert.equal(editor.state.doc.firstChild.child(1).child(1).attrs.calculated, "20");
  select(1, 0);
  editor.view.dispatch(editor.state.tr.insertText("4"));
  assert.equal(editor.state.doc.firstChild.child(1).child(0).attrs.formula, null);
  assert.equal(editor.state.doc.firstChild.child(1).child(1).attrs.calculated, "8");
});

test("all three resize boundary types are present and inactive cell menus are hidden", () => {
  const source = readFileSync(new URL("../src/vellix-tables.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/vellix-tables.css", import.meta.url), "utf8");
  assert(source.includes('"Resize left edge"'));
  assert(source.includes('"Resize right edge"'));
  assert(source.includes("boundary === widths.length"));
  assert(css.includes(".vellix-table-wrapper:not(.vellix-table-active) .vellix-table-cell-menu { display: none; }"));
});

test("left, interior and right resizing obey minimum widths and preserve opposite boundaries", () => {
  const resize = globalThis.VellixTables.resizeWidths;
  assert.deepEqual(resize([150, 150], 0, 30, 10), { widths: [120, 150], offset: 40 });
  assert.deepEqual(resize([150, 150], 0, -50, 10), { widths: [160, 150], offset: 0 });
  assert.deepEqual(resize([150, 150], 1, 30, 0), { widths: [180, 120], offset: 0 });
  assert.deepEqual(resize([150, 150], 1, 500, 0), { widths: [244, 56], offset: 0 });
  assert.deepEqual(resize([150, 150], 2, 30, 0), { widths: [150, 180], offset: 0 });
  assert.deepEqual(resize([150, 150], 2, -500, 0), { widths: [150, 56], offset: 0 });
  const { editor } = setup();
  const tr = editor.state.tr;
  globalThis.VellixTables.setWidths(tr, globalThis.VellixTables.grid({ node: editor.state.doc.firstChild, pos: 0 }), [120, 180], 25);
  editor.view.dispatch(tr);
  assert.equal(editor.state.doc.firstChild.attrs.leftOffset, 25);
  assert.deepEqual(editor.state.doc.firstChild.child(1).child(1).attrs.colwidth, [180]);
  assert(undo(editor.state, editor.view.dispatch));
  assert.deepEqual(editor.state.doc.firstChild.child(1).child(1).attrs.colwidth, [150]);
  assert(redo(editor.state, editor.view.dispatch));
  assert.deepEqual(editor.state.doc.firstChild.child(1).child(1).attrs.colwidth, [180]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";

const paragraph = (id, text, marks = []) => ({ type: "paragraph", attrs: { id },
  ...(text ? { content: [{ type: "text", text, ...(marks.length ? { marks } : {}) }] } : {}) });
const pair = () => [paragraph("first", "First paragraph", [{ type: "bold" }]), paragraph("second", "Second paragraph")];
const rect = (top, bottom) => ({ top, bottom, left: 20, right: 320, width: 300, height: bottom - top });

async function mountedRuntime(content) {
  const events = [], boxes = new Map();
  const dom = new JSDOM("<!doctype html><html><body><main class='vellix-editor-page'><div id='editor'></div></main></body></html>",
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://vellix.test" });
  const window = dom.window;
  window.console.log = window.console.info = () => {};
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.webkit = { messageHandlers: { tiptap: { postMessage(message) { events.push(message); } } } };
  window.crypto.randomUUID = randomUUID;
  window.scrollBy = () => {};
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return boxes.get(this.dataset?.vellixBlockId)?.box ?? rect(0, 0);
  };
  window.Range.prototype.getClientRects = function () {
    const element = this.startContainer.nodeType === 1 ? this.startContainer : this.startContainer.parentElement;
    return boxes.get(element?.closest("p")?.dataset.vellixBlockId)?.text ?? [];
  };
  window.Range.prototype.getBoundingClientRect = function () { return this.getClientRects()[0] ?? rect(0, 0); };
  for (const file of ["vendor/formula-parser.min.js", "table-formulas.js", "vellix-tables.js", "vendor/table-library.js", "tiptap.bundle.js"])
    window.eval(await readFile(new URL("../dist/" + file, import.meta.url), "utf8"));
  await window.tiptapCommand("setContent", { document: { type: "doc", content } });
  const editor = window.document.querySelector(".tiptap-editor").editor;
  const layout = () => {
    let index = 0;
    for (const p of window.document.querySelectorAll(".tiptap-editor p")) {
      const top = 20 + index++ * 30;
      boxes.set(p.dataset.vellixBlockId, { box: rect(top, top + 30), text: p.textContent ? [rect(top + 5, top + 25)] : [] });
    }
  };
  layout();
  return { window, editor, events, boxes, layout,
    click(selector, x, y) {
      const element = window.document.querySelector(selector);
      assert(element, selector);
      element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    },
    json: () => window.tiptapCommand("getDocument", {}),
    close: () => window.close(),
  };
}

test("tapping paragraph padding inserts a persisted paragraph between siblings and places its native caret", async () => {
  const h = await mountedRuntime(pair());
  try {
    const before = await h.json();
    h.click("p[data-vellix-block-id='first']", 60, 48);
    const saved = await h.json();
    assert.equal(saved.content.length, 3);
    assert.deepEqual(saved.content[0], before.content[0]);
    assert.deepEqual(saved.content[2], before.content[1]);
    assert.equal(saved.content[1].type, "paragraph");
    assert(!saved.content[1].content?.length);
    assert(saved.content[1].attrs.id);
    const anchor = h.window.document.getSelection().anchorNode;
    const element = anchor.nodeType === 1 ? anchor : anchor.parentElement;
    assert.equal(element.closest("p").dataset.vellixBlockId, saved.content[1].attrs.id);
    await h.window.tiptapCommand("undo", {});
    assert.deepEqual((await h.json()).content, before.content);
    await h.window.tiptapCommand("redo", {});
    assert.equal((await h.json()).content.length, 3);
    await h.window.tiptapCommand("setContent", { document: saved });
    assert.deepEqual((await h.json()).content, saved.content);
  } finally { h.close(); }
});

const numbered = () => ({ type: "orderedList", attrs: { id: "numbers" }, content:
  Array.from({ length: 4 }, (_, index) => ({ type: "listItem", attrs: { id: `item-${index + 1}` },
    content: [paragraph(`line-${index + 1}`, "")] })) });
const inContainer = (type, list) => type
  ? [{ type, attrs: { id: "container", color: "#8FE9FF" }, content: [list] }] : [list];

function selectParagraph(h, id) {
  let position;
  h.editor.state.doc.descendants((node, pos) => { if (node.isTextblock && node.attrs.id === id) position = pos; });
  assert.notEqual(position, undefined);
  h.editor.commands.setTextSelection(position + 1);
}

for (const type of [null, "plainCallout"]) {
  test(`${type || "document"}: exit item 4, re-enable numbering, tap below it, and number item 5`, async () => {
    const h = await mountedRuntime(inContainer(type, numbered()));
    try {
      selectParagraph(h, "line-4");
      h.editor.view.dom.dispatchEvent(new h.window.KeyboardEvent("keydown", {
        key: "Enter", code: "Enter", bubbles: true, cancelable: true,
      }));
      assert.equal(h.editor.isActive("orderedList"), false);
      assert.equal(h.editor.state.selection.$from.parent.type.name, "paragraph");
      assert.equal(await h.window.tiptapCommand("formatCurrentSelection", { action: "numberList" }), true);
      assert.equal(h.editor.isActive("orderedList"), true);
      const beforeTap = JSON.parse(JSON.stringify(await h.json()));
      const originalList = type ? beforeTap.content[0].content[0] : beforeTap.content[0];
      assert.equal(originalList.content.length, 4);

      const { $from } = h.editor.state.selection;
      const paragraphPosition = $from.before(), itemPosition = $from.before($from.depth - 1);
      const listPosition = $from.before($from.depth - 2);
      const itemDOM = h.editor.view.nodeDOM(itemPosition);
      h.editor.view.nodeDOM(paragraphPosition).getBoundingClientRect = () => rect(170, 200);
      itemDOM.getBoundingClientRect = () => rect(170, 230);
      h.editor.view.nodeDOM(listPosition).getBoundingClientRect = () => rect(20, 240);
      h.editor.view.dom.getBoundingClientRect = () => rect(0, 300);
      if (type) h.editor.view.nodeDOM(0).getBoundingClientRect = () => rect(0, 300);
      // WebKit may report the nearest text position inside item 4 even though
      // the tap is below its text. Insertion must resolve the parent list edge.
      h.editor.view.posAtCoords = () => ({ pos: paragraphPosition + 1, inside: itemPosition });
      const tap = new h.window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 60, clientY: 215 });
      itemDOM.dispatchEvent(tap);
      assert.equal(tap.defaultPrevented, true);
      assert.equal(h.editor.isActive("orderedList"), false);
      assert.equal(h.editor.state.selection.$from.node(-1).type.name, type || "doc");
      assert.equal(h.events.filter(event => event.kind === "formattingState").at(-1).payload.numberList, false);
      const afterTap = JSON.parse(JSON.stringify(await h.json()));
      assert.deepEqual(type ? afterTap.content[0].content[0] : afterTap.content[0], originalList);
      assert.equal(await h.window.tiptapCommand("formatCurrentSelection", { action: "numberList" }), true);
      const saved = await h.json(), list = type ? saved.content[0].content[0] : saved.content[0];
      assert.equal(list.content.length, 5);
      assert.deepEqual(list.content.slice(0, 4), originalList.content);
      assert(list.content.every(item => item.content.length === 1));
      assert.equal(h.editor.isActive("orderedList"), true);
      h.editor.commands.insertContent("Fifth item");
      assert.equal(h.editor.state.selection.$from.parent.textContent, "Fifth item");
    } finally { h.close(); }
  });

  test(`${type || "document"}: numbering repairs an existing blank continuation without moving item 4`, async () => {
    const list = numbered();
    list.content[3].content.push(paragraph("stray-line", ""));
    const h = await mountedRuntime(inContainer(type, list));
    try {
      selectParagraph(h, "stray-line");
      const before = JSON.parse(JSON.stringify(await h.json()));
      const originalList = type ? before.content[0].content[0] : before.content[0];
      assert.equal(h.events.filter(event => event.kind === "formattingState").at(-1).payload.numberList, false);
      assert.equal(await h.window.tiptapCommand("formatCurrentSelection", { action: "numberList" }), true);
      const saved = JSON.parse(JSON.stringify(await h.json()));
      const result = type ? saved.content[0].content[0] : saved.content[0];
      assert.equal(result.content.length, 5);
      assert.deepEqual(result.content.slice(0, 3), originalList.content.slice(0, 3));
      assert.deepEqual(result.content[3].content[0], originalList.content[3].content[0]);
      assert.equal(result.content[3].content.length, 1);
      assert.equal(result.content[4].content[0].attrs.id, "stray-line");
      assert.notEqual(result.content[4].attrs.id, result.content[3].attrs.id);
      assert.equal(h.editor.state.selection.$from.parent.attrs.id, "stray-line");
      assert.equal(h.editor.state.selection.$from.parentOffset, 0);
      assert.equal(h.events.filter(event => event.kind === "formattingState").at(-1).payload.numberList, true);
      h.editor.commands.undo();
      assert.deepEqual(JSON.parse(JSON.stringify(await h.json())), before);
      h.editor.commands.redo();
      assert.deepEqual(JSON.parse(JSON.stringify(await h.json())), saved);
    } finally { h.close(); }
  });
}

test("a genuine gap between paragraphs within a numbered item still stays in that item", async () => {
  const h = await mountedRuntime([{ type: "orderedList", attrs: { id: "numbers" }, content: [
    { type: "listItem", attrs: { id: "item" }, content: pair() },
  ] }]);
  try {
    h.boxes.set("item", { box: rect(10, 100) });
    h.boxes.set("numbers", { box: rect(10, 100) });
    let first;
    h.editor.state.doc.descendants((node, pos) => { if (node.attrs.id === "first") first = pos; });
    h.editor.view.posAtCoords = () => ({ pos: first + 1, inside: first });
    h.click("p[data-vellix-block-id='first']", 60, 48);
    assert.equal(h.editor.state.selection.$from.node(-1).type.name, "listItem");
    assert.equal((await h.json()).content[0].content[0].content.length, 3);
  } finally { h.close(); }
});

for (const type of [null, "plainCallout"]) {
  for (const tap of [true, false]) {
    test(`${type || "document"}: ${tap ? "tapping" : "numbering"} the blank line after an inline break preserves item 4`, async () => {
      const list = numbered();
      list.content[3].content[0].content = [{ type: "hardBreak" }];
      const h = await mountedRuntime(inContainer(type, list));
      try {
        selectParagraph(h, "line-4");
        h.editor.commands.setTextSelection(h.editor.state.selection.from + 1);
        assert.equal(h.editor.state.selection.$from.parent.nodeSize, 3);
        const before = JSON.parse(JSON.stringify(await h.json()));
        if (tap) {
          const position = h.editor.state.selection.from;
          const element = h.editor.view.nodeDOM(h.editor.state.selection.$from.before());
          element.style.lineHeight = "21.28px";
          element.style.paddingBottom = "1.5px";
          element.getBoundingClientRect = () => rect(170, 215.56);
          h.editor.view.posAtCoords = () => ({ pos: position, inside: position - 2 });
          element.dispatchEvent(new h.window.MouseEvent("click", {
            bubbles: true, cancelable: true, clientX: 60, clientY: 205,
          }));
          assert.equal(h.editor.isActive("orderedList"), false);
          assert.equal(h.editor.state.selection.$from.node(-1).type.name, type || "doc");
        }
        assert.equal(h.events.filter(event => event.kind === "formattingState").at(-1).payload.numberList, false);
        assert.equal(await h.window.tiptapCommand("formatCurrentSelection", { action: "numberList" }), true);
        const saved = JSON.parse(JSON.stringify(await h.json()));
        const result = type ? saved.content[0].content[0] : saved.content[0];
        const previous = type ? before.content[0].content[0] : before.content[0];
        assert.equal(result.content.length, 5);
        assert.deepEqual(result.content.slice(0, 3), previous.content.slice(0, 3));
        assert.equal(result.content[3].content[0].attrs.id, "line-4");
        assert(!result.content[3].content[0].content?.length);
        assert.equal(h.editor.state.selection.$from.parentOffset, 0);
        assert.equal(h.editor.state.selection.$from.node(-1).attrs.id, result.content[4].attrs.id);
        assert(result.content.every(item => item.content.length === 1));
        if (!tap) {
          h.editor.commands.undo();
          assert.deepEqual(JSON.parse(JSON.stringify(await h.json())), before);
          h.editor.commands.redo();
          assert.deepEqual(JSON.parse(JSON.stringify(await h.json())), saved);
        }
      } finally { h.close(); }
    });
  }
}

test("a repeated gap tap reuses the adjacent blank paragraph", async () => {
  const h = await mountedRuntime(pair());
  try {
    h.click("p[data-vellix-block-id='first']", 60, 48);
    const id = (await h.json()).content[1].attrs.id;
    h.layout();
    h.click("p[data-vellix-block-id='first']", 60, 48);
    const result = await h.json();
    assert.equal(result.content.length, 3);
    assert.equal(result.content[1].attrs.id, id);
  } finally { h.close(); }
});

test("text taps and whitespace between wrapped lines do not create paragraphs", async () => {
  const h = await mountedRuntime(pair());
  try {
    const before = await h.json();
    h.click("p[data-vellix-block-id='first']", 60, 30);
    assert.deepEqual((await h.json()).content, before.content);
    h.boxes.set("first", { box: rect(20, 80), text: [rect(25, 45), rect(55, 75)] });
    h.boxes.set("second", { box: rect(80, 110), text: [rect(85, 105)] });
    h.click("p[data-vellix-block-id='first']", 60, 50);
    assert.deepEqual((await h.json()).content, before.content);
  } finally { h.close(); }
});

test("nested paragraph gaps insert inside their existing container", async () => {
  const h = await mountedRuntime([{ type: "blockquote", attrs: { id: "quote" }, content: pair() }]);
  try {
    h.click("p[data-vellix-block-id='first']", 60, 48);
    const result = await h.json();
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "blockquote");
    assert.equal(result.content[0].content.length, 3);
    assert(!result.content[0].content[1].content?.length);
  } finally { h.close(); }
});

test("table-cell gaps keep their existing cell editing behavior", async () => {
  const h = await mountedRuntime([{ type: "table", attrs: { id: "table", name: "Table1" }, content: [
    { type: "tableRow", attrs: { id: "row" }, content: [{ type: "tableCell", attrs: { id: "cell", colwidth: [300] }, content: pair() }] }
  ] }]);
  try {
    h.click("p[data-vellix-block-id='first']", 60, 48);
    assert.equal((await h.json()).content[0].content[0].content[0].content.length, 2);
  } finally { h.close(); }
});

test("read-only documents and block-selection mode never insert on gap taps", async () => {
  const h = await mountedRuntime(pair());
  try {
    await h.window.tiptapCommand("setEditable", { editable: false });
    h.click("p[data-vellix-block-id='first']", 60, 48);
    assert.equal((await h.json()).content.length, 2);
    await h.window.tiptapCommand("setEditable", { editable: true });
    await h.window.tiptapCommand("setSelectionMode", { mode: "single" });
    h.click("p[data-vellix-block-id='first']", 60, 48);
    assert.equal((await h.json()).content.length, 2);
  } finally { h.close(); }
});

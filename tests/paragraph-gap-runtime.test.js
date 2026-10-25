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
  const layout = () => {
    let index = 0;
    for (const p of window.document.querySelectorAll(".tiptap-editor p")) {
      const top = 20 + index++ * 30;
      boxes.set(p.dataset.vellixBlockId, { box: rect(top, top + 30), text: p.textContent ? [rect(top + 5, top + 25)] : [] });
    }
  };
  layout();
  return { window, events, boxes, layout,
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

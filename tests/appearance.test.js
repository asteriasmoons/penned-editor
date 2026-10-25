import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import { applyEditorAppearance } from "../src/appearance.js";

test("light/dark presentation changes only root CSS and keeps explicit content colors", () => {
  const dom = new JSDOM('<div class="tiptap-editor"><p><span style="color:#9734c8;background-color:#ffee11">Custom</span></p></div>');
  try {
    const root = dom.window.document.documentElement;
    const body = dom.window.document.body.innerHTML;
    for (const colorScheme of ["light", "dark", "light"]) {
      applyEditorAppearance(root, { colorScheme, interfaceScheme: colorScheme, textColor: colorScheme === "light" ? "#211D29" : "#F7F7F7" });
      assert.equal(root.dataset.pennedDocumentScheme, colorScheme);
      assert.equal(root.style.colorScheme, colorScheme);
      assert.equal(dom.window.document.body.innerHTML, body);
    }
  } finally { dom.window.close(); }
});

test("custom dark document and light interface have independent palettes", () => {
  const dom = new JSDOM("");
  try {
    const root = dom.window.document.documentElement;
    applyEditorAppearance(root, { colorScheme: "dark", interfaceScheme: "light", textColor: "#FFF1DB", fontFamily: "ui-serif" });
    assert.equal(root.style.getPropertyValue("--vellix-primary-text"), "#FFF1DB");
    assert.equal(root.style.getPropertyValue("--vellix-neutral-rgb"), "255,255,255");
    assert.equal(root.style.getPropertyValue("--vellix-interface-surface"), "#f5f2f9");
    assert.equal(root.style.getPropertyValue("--vellix-font-family"), "ui-serif");
  } finally { dom.window.close(); }
});

test("light defaults include readable secondary text, tables, links, and inverse selection labels", () => {
  const dom = new JSDOM("");
  try {
    const root = dom.window.document.documentElement;
    applyEditorAppearance(root, { colorScheme: "light", interfaceScheme: "light", textColor: "#211D29" });
    for (const [key, value] of Object.entries({
      "--vellix-secondary-text": "#686171", "--vellix-property-accent": "#7955a0",
      "--vellix-link-color": "#7833bc", "--vellix-table-default-header": "#e7def2",
      "--vellix-component-selected-text": "#fff",
    })) assert.equal(root.style.getPropertyValue(key), value);
  } finally { dom.window.close(); }
});

test("the real editor keeps unsaved edits, explicit block colors, selection and undo history when switching themes", async () => {
  const events = [];
  const dom = new JSDOM("<!doctype html><div id='editor'></div>", { runScripts: "outside-only", pretendToBeVisual: true, url: "https://penned.test" });
  const { window } = dom;
  try {
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
    await window.tiptapCommand("setContent", { document: { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "Saved", marks: [{ type: "bold" }] }] },
      { type: "callout", attrs: { id: "explicit-callout", icon: "sparkle", color: "#9734C8" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Custom callout" }] }] },
    ] } });
    const editor = window.document.querySelector(".tiptap-editor").editor;
    editor.commands.insertContent("Unsaved");
    editor.commands.setTextSelection({ from: 2, to: 5 });
    const before = JSON.stringify(editor.getJSON()), selection = JSON.stringify(editor.state.selection.toJSON());
    const documentNode = editor.state.doc;
    const canUndo = editor.can().undo();
    events.length = 0;
    for (const colorScheme of ["light", "dark", "light"]) {
      await window.tiptapCommand("setAppearance", { colorScheme, interfaceScheme: colorScheme, textColor: colorScheme === "light" ? "#211D29" : "#F7F7F7" });
      assert.equal(JSON.stringify(editor.getJSON()), before);
      assert.equal(editor.state.doc, documentNode);
      assert.equal(JSON.stringify(editor.state.selection.toJSON()), selection);
      assert.equal(editor.can().undo(), canUndo);
      assert.equal(window.document.querySelector('[data-callout-color]').dataset.calloutColor, "#9734C8");
    }
    assert.equal(events.filter(event => ["update", "snapshot"].includes(event.kind)).length, 0);
  } finally { window.close(); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";

const paragraph = (text = "") => ({ type: "paragraph", attrs: { id: "quote-text" },
  content: text ? [{ type: "text", text }] : [] });
const quote = content => ({ type: "blockquote", attrs: { id: "quote", color: "#7EEAC8" }, content });

async function runtime(content) {
  const html = await readFile(new URL("../dist/tiptap.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://penned.test" });
  const { window } = dom, events = [];
  window.console.log = window.console.info = () => {};
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.crypto.randomUUID = randomUUID;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.scrollBy = () => {};
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  window.webkit = { messageHandlers: { tiptap: { postMessage(event) { events.push(event); } } } };
  for (const file of ["vendor/formula-parser.min.js", "table-formulas.js", "vellix-tables.js", "vendor/table-library.js", "tiptap.bundle.js"]) {
    window.eval(await readFile(new URL("../dist/" + file, import.meta.url), "utf8"));
  }
  const command = (name, args = {}) => window.tiptapCommand(name, args);
  await command("setContent", { document: { type: "doc", content } });
  return { window, events, command, editor: window.document.querySelector(".tiptap-editor").editor,
    host: () => window.document.querySelector("blockquote"),
    json: async () => {
      await command("requestSnapshot");
      return JSON.parse(JSON.stringify(events.filter(event => event.kind === "snapshot").at(-1).payload.document));
    }, close: () => window.close() };
}

test("blockquote centers its editable column within the existing minimum height without changing horizontal alignment", async () => {
  const h = await runtime([quote([paragraph()])]);
  try {
    const style = h.window.getComputedStyle(h.host());
    assert.equal(style.display, "flex");
    assert.equal(style.alignItems, "center");
    assert.equal(style.minHeight, "58px");
    assert.equal(style.paddingTop, "8px");
    assert.equal(style.paddingBottom, "8px");
    assert.equal(style.borderRadius, "22px");
    assert.equal(h.window.getComputedStyle(h.host().querySelector(".vellix-blockquote-content")).flexGrow, "1");
    assert.equal(h.window.getComputedStyle(h.host().querySelector("button")).position, "absolute");
    const before = await h.json();
    assert.equal(before.content[0].content[0].attrs.textAlign, null);
    await h.command("formatCurrentSelection", { action: "align", value: "right" });
    assert.equal((await h.json()).content[0].content[0].attrs.textAlign, "right");
  } finally { h.close(); }
});

test("blockquote guidance contributes its real height instead of pinning the caret to an estimated tall paragraph", async () => {
  const h = await runtime([quote([paragraph()])]);
  try {
    const rules = [...h.window.document.styleSheets].flatMap(sheet => [...sheet.cssRules]);
    const region = rules.find(rule => rule.selectorText === ".vellix-blockquote-content .vellix-guided-empty")?.style;
    const guidance = rules.find(rule => rule.selectorText === ".vellix-blockquote-content .vellix-guided-empty::before")?.style;
    assert(region && guidance);
    assert.equal(region.display, "flow-root");
    assert.equal(region.getPropertyValue("min-height"), "0px");
    assert.equal(region.getPropertyPriority("min-height"), "important");
    assert.equal(guidance.width, "100%");
    assert.equal(guidance.height, "auto");
    assert.equal(guidance.marginRight, "-100%");
  } finally { h.close(); }
});

test("blockquote typing, multiline editing, clearing, color actions and reload retain the existing document structure", async () => {
  const h = await runtime([quote([paragraph()])]);
  try {
    h.editor.commands.setTextSelection(2);
    h.editor.commands.insertContent("First line");
    h.editor.view.dom.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    h.editor.commands.insertContent("Second line");
    const saved = await h.json();
    assert.deepEqual(saved.content[0].content.map(node => node.content[0].text), ["First line", "Second line"]);
    assert.equal(saved.content[0].attrs.color, "#7EEAC8");
    await h.command("setContent", { document: saved });
    assert.deepEqual(await h.json(), saved);
    h.host().querySelector(".vellix-blockquote-color-button").click();
    assert(h.events.some(event => event.kind === "blockquoteColorPickerRequest" && event.payload.currentColor === "#7EEAC8"));
    await h.command("setContent", { document: { type: "doc", content: [quote([paragraph("Clear me")])] } });
    h.editor.view.dispatch(h.editor.state.tr.delete(2, 10));
    const empty = await h.json();
    assert.equal(empty.content[0].type, "blockquote");
    assert.equal(empty.content[0].content[0].content?.length ?? 0, 0);
    assert.equal(h.window.getComputedStyle(h.host()).alignItems, "center");
  } finally { h.close(); }
});

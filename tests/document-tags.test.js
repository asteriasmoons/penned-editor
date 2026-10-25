import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import { cleanTagName, normalizedTagName } from "../src/document-tags.js";

const tag = (name, id = randomUUID()) => ({ type: "inlineTag", attrs: { id, name } });
const p = (id, content) => ({ type: "paragraph", attrs: { id }, content });
const text = value => ({ type: "text", text: value });
async function runtime(content) {
  const events = [];
  const dom = new JSDOM("<!doctype html><html><body><main class='vellix-editor-page'><div id='editor'></div></main></body></html>",
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://penned.test" });
  const w = dom.window;
  w.console.log = w.console.info = () => {};
  w.ResizeObserver = class { observe() {} disconnect() {} };
  w.webkit = { messageHandlers: { tiptap: { postMessage: value => events.push(value) } } };
  w.crypto.randomUUID = randomUUID; w.scrollBy = () => {};
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => ({ top: 300, left: 30, bottom: 320, right: 200 });
  for (const file of ["vendor/formula-parser.min.js", "table-formulas.js", "vellix-tables.js", "vendor/table-library.js", "tiptap.bundle.js"])
    w.eval(await readFile(new URL("../dist/" + file, import.meta.url), "utf8"));
  const command = (name, args = {}) => w.tiptapCommand(name, args);
  await command("setContent", { document: { type: "doc", content } });
  const frame = () => new Promise(resolve => w.requestAnimationFrame(resolve));
  return { w, events, command, frame, json: async () => JSON.parse(JSON.stringify(await command("getDocument"))),
    async focus() { await command("focus"); await frame(); await frame(); },
    request() { return events.findLast(event => event.kind === "tagRequest")?.payload; },
    clickTag(id) { w.document.querySelector(`[data-tag-occurrence='${id}']`).dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })); },
    close() { w.close(); } };
}

test("tag names normalize case and composed Unicode without accepting empty or unsafe input", () => {
  assert.equal(normalizedTagName("#JOURNALS"), "journals");
  assert.equal(normalizedTagName("Cafe\u0301"), normalizedTagName("CAFÉ"));
  assert.equal(normalizedTagName("Straße"), normalizedTagName("STRASSE"));
  assert.equal(cleanTagName("free-write"), "free-write");
  for (const value of ["", "#", "two words", "foo/bar", "<b>", "a".repeat(81)]) assert.equal(cleanTagName(value), null);
});

test("choosing a suggestion inserts a structured tag; save/reload and undo/redo preserve it", async () => {
  const h = await runtime([p("block", [text("Hello #jour")])]);
  try {
    await h.command("tagCatalogue", { tags: [{ id: "journals", name: "Journals" }] });
    await h.focus();
    const menu = h.w.document.querySelector(".penned-tag-suggestions");
    assert(menu); assert.match(menu.textContent, /#Journals/); assert.match(menu.textContent, /Create #jour/);
    await h.command("tagCatalogue", { tags: [{ id: "journals", name: "Journals" }] });
    assert.equal(h.w.document.querySelector(".penned-tag-suggestions"), menu, "Unchanged suggestions must not detach during a tap");
    const before = await h.json();
    menu.querySelector("button").click();
    const request = h.request(); assert.equal(request.action, "commit");
    assert(await h.command("tagApply", { token: request.token, name: "Journals", tagID: "journals" }));
    const saved = await h.json();
    assert.equal(saved.content[0].content[1].type, "inlineTag");
    assert.equal(saved.content[0].content[1].attrs.name, "Journals");
    assert(h.events.some(event => event.kind === "snapshot" && event.payload.document.content[0].content.some(node => node.type === "inlineTag")));
    assert(await h.command("undo")); assert.deepEqual((await h.json()).content, before.content);
    assert(await h.command("redo")); assert.deepEqual((await h.json()).content, saved.content);
    await h.command("setContent", { document: saved }); assert.deepEqual((await h.json()).content, saved.content);
  } finally { h.close(); }
});

test("new-tag choice uses the typed capitalization and does not convert plain hashtags automatically", async () => {
  const h = await runtime([p("block", [text("#MyTag")])]);
  try {
    await h.focus();
    assert.equal(h.w.document.querySelector(".penned-tag-suggestions button").textContent, "Create #MyTag");
    assert.equal((await h.json()).content[0].content[0].type, "text");
    h.w.document.querySelector(".penned-tag-suggestions button").click();
    assert.equal(h.request().name, "MyTag");
    assert(await h.command("tagApply", { token: h.request().token, name: "MyTag" }));
    assert.equal((await h.json()).content[0].content[0].attrs.name, "MyTag");
  } finally { h.close(); }
});

test("swap and Turn into Text affect only the tapped occurrence and retain surrounding marks", async () => {
  const marked = { ...tag("journals", "first"), marks: [{ type: "bold" }] };
  const h = await runtime([p("one", [text("Before "), marked, text(" between "), tag("journals", "second"), text(" after")])]);
  try {
    h.clickTag("first"); assert.equal(h.request().action, "menu");
    assert(await h.command("tagApply", { token: h.request().token, name: "rituals", tagID: "r" }));
    let nodes = (await h.json()).content[0].content;
    assert.equal(nodes[1].attrs.name, "rituals"); assert.equal(nodes[3].attrs.name, "journals");
    assert.deepEqual(nodes[1].marks, [{ type: "bold" }]);
    h.clickTag("first");
    assert(await h.command("tagToText", { token: h.request().token, name: "stale-value" }));
    nodes = (await h.json()).content[0].content;
    assert.equal(nodes[1].text, "#rituals"); assert.deepEqual(nodes[1].marks, [{ type: "bold" }]);
    assert.equal(nodes[3].attrs.name, "journals");
    assert(await h.command("undo")); assert.equal((await h.json()).content[0].content[1].type, "inlineTag");
    assert(await h.command("redo")); assert.equal((await h.json()).content[0].content[1].text, "#rituals");
  } finally { h.close(); }
});

test("cancel and stale bookmarks cannot delete content in a different document", async () => {
  const h = await runtime([p("block", [tag("journals", "occurrence")])]);
  try {
    h.clickTag("occurrence"); const token = h.request().token, before = await h.json();
    await h.command("tagDismiss", { token });
    assert.equal(await h.command("tagApply", { token, name: "new" }), false);
    assert.deepEqual((await h.json()).content, before.content);
    h.clickTag("occurrence"); const old = h.request().token;
    await h.command("setContent", { document: { type: "doc", content: [p("another", [text("Keep this")])] } });
    assert.equal(await h.command("tagToText", { token: old, name: "journals" }), false);
    assert.equal((await h.json()).content[0].content[0].text, "Keep this");
  } finally { h.close(); }
});

test("exact-ID navigation reveals collapsed toggles without changing saved content", async () => {
  const h = await runtime([{ type: "toggleItem", attrs: { id: "toggle", open: false }, content: [p("summary", [text("Summary")]), p("target", [tag("journals", "tag-target"), text(" Exact block")])] }]);
  try {
    const before = await h.json();
    const rect = await h.command("tagLocate", { blockID: "target", occurrenceID: "tag-target" });
    assert(rect && rect.width > 0); assert.equal(h.w.document.querySelector("[data-vellix-toggle]").dataset.open, "true");
    assert(await h.command("tagHighlight", { blockID: "target" }));
    assert(h.w.document.querySelector("[data-vellix-block-id='target'].penned-tag-destination"));
    assert.deepEqual((await h.json()).content, before.content);
    h.w.document.querySelector(".vellix-toggle-button").click();
    assert.equal(h.w.document.querySelector("[data-vellix-toggle]").dataset.open, "false");
    assert.equal(await h.command("tagLocate", { blockID: "deleted" }), null);
    assert.equal(await h.command("tagLocate", { blockID: "target", occurrenceID: "deleted" }), null);
    await h.command("setContent", { document: before });
    assert.equal(h.w.document.querySelector("[data-vellix-toggle]").dataset.open, "false");
  } finally { h.close(); }
});

test("read-only mode supports tag navigation but rejects edits", async () => {
  const h = await runtime([p("p", [tag("journals", "tag")])]);
  try {
    await h.command("setEditable", { editable: false }); h.clickTag("tag");
    assert.equal(h.request().action, "menu");
    assert.equal(await h.command("tagApply", { token: h.request().token, name: "other" }), false);
    assert(await h.command("tagLocate", { blockID: "p", occurrenceID: "tag" }));
  } finally { h.close(); }
});

test("duplicate pasted block and occurrence IDs are repaired independently", async () => {
  const h = await runtime([p("p", [tag("journals", "tag")]), p("p", [tag("journals", "tag")])]);
  try {
    const saved = await h.json();
    assert.notEqual(saved.content[0].attrs.id, saved.content[1].attrs.id);
    assert.notEqual(saved.content[0].content[0].attrs.id, saved.content[1].content[0].attrs.id);
    await h.command("setContent", { document: saved });
    assert.deepEqual((await h.json()).content, saved.content);
  } finally { h.close(); }
});

test("pasting before a tagged source preserves the original block and occurrence targets through undo/redo", async () => {
  const h = await runtime([p("original", [tag("journals", "original-tag"), text(" Original content")])]);
  try {
    const editor = h.w.document.querySelector(".tiptap-editor").editor;
    const original = (await h.json()).content[0];
    // Separate this user paste from fixture loading without a wall-clock sleep.
    editor.view.dispatch(editor.state.tr.insert(0, editor.schema.nodeFromJSON(original)).setTime(Date.now() + 1000));
    const pasted = await h.json();
    assert.equal(pasted.content[1].attrs.id, "original");
    assert.equal(pasted.content[1].content[0].attrs.id, "original-tag");
    assert.notEqual(pasted.content[0].attrs.id, "original");
    assert.notEqual(pasted.content[0].content[0].attrs.id, "original-tag");
    assert(await h.command("undo")); assert.deepEqual((await h.json()).content, [original]);
    assert(await h.command("redo")); assert.deepEqual((await h.json()).content, pasted.content);
  } finally { h.close(); }
});

test("plain hashtags, URL fragments, code, and heading shortcuts are not converted", async () => {
  for (const value of ["#ordinary ", "https://example.com/#fragment", "word#suffix", "# "]) {
    const h = await runtime([p("p", [text(value)])]);
    try { await h.focus(); assert.equal(h.w.document.querySelector(".penned-tag-suggestions"), null); assert.equal((await h.json()).content[0].content[0].type, "text"); }
    finally { h.close(); }
  }
  const h = await runtime([{ type: "codeBlock", attrs: { id: "code" }, content: [text("#journals")] }]);
  try { await h.focus(); assert.equal(h.w.document.querySelector(".penned-tag-suggestions"), null); }
  finally { h.close(); }
});

test("Escape cancels suggestions and Enter explicitly accepts the highlighted choice", async () => {
  const h = await runtime([p("p", [text("#journals")])]);
  try {
    await h.focus();
    h.w.document.querySelector(".tiptap-editor").dispatchEvent(new h.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(h.w.document.querySelector(".penned-tag-suggestions"), null);
    assert.equal((await h.json()).content[0].content[0].type, "text");
    await h.command("setContent", { document: { type: "doc", content: [p("p", [text("#journals")])] } });
    await h.focus();
    h.w.document.querySelector(".tiptap-editor").dispatchEvent(new h.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    assert.equal(h.request().action, "commit");
    assert(await h.command("tagApply", { token: h.request().token, name: h.request().name }));
    assert.equal((await h.json()).content[0].content[0].type, "inlineTag");
  } finally { h.close(); }
});

test("page breaks do not delete a block whose only content is an inline tag", async () => {
  const h = await runtime([p("tagged-block", [tag("journals", "tag")])]);
  try {
    await h.focus(); await h.command("insertPageBreak");
    const saved = await h.json();
    assert.equal(saved.content[0].attrs.id, "tagged-block");
    assert.equal(saved.content[0].content[0].attrs.id, "tag");
    assert(saved.content.some(node => node.type === "pageBreak"));
  } finally { h.close(); }
});

test("ordinary block transformations preserve structured tags and their marks", async () => {
  const h = await runtime([p("p", [{ ...tag("journals", "tag"), marks: [{ type: "italic" }] }, text(" Keep text")])]);
  try {
    for (const type of ["heading", "plainCallout", "quote", "paragraph"]) {
      await h.command("selectAllBlocks");
      await h.command("setSelectedBlockType", { blockType: type, level: 2 });
      await h.command("clearBlockSelection");
      const saved = await h.json();
      let found;
      function walk(node) { if (node.type === "inlineTag") found = node; (node.content ?? []).forEach(walk); }
      walk(saved);
      assert(found, `Changing to ${type} must not turn a tag into plain text`);
      assert.equal(found.attrs.id, "tag"); assert.equal(found.attrs.name, "journals");
      assert.deepEqual(found.marks, [{ type: "italic" }]);
    }
  } finally { h.close(); }
});

test("tags in table cells serialize and navigate to their own paragraph IDs", async () => {
  const h = await runtime([{ type: "table", attrs: { id: "table", name: "Table1" }, content: [{ type: "tableRow", content: [
    { type: "tableCell", content: [p("cell-block", [tag("research", "cell-tag"), text(" actual cell text")])] }
  ] }] }]);
  try {
    const saved = await h.json();
    assert(await h.command("tagLocate", { blockID: "cell-block", occurrenceID: "cell-tag" }));
    assert.deepEqual((await h.json()).content, saved.content);
    await h.command("setContent", { document: saved });
    assert(h.w.document.querySelector("td [data-tag-occurrence='cell-tag']"));
  } finally { h.close(); }
});

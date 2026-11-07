import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";

const p = (id, text = "") => ({ type: "paragraph", attrs: { id }, ...(text ? { content: [{ type: "text", text }] } : {}) });
async function runtime() {
  const events = [];
  const dom = new JSDOM("<!doctype html><html><body><main class='vellix-editor-page'><div id='editor'></div></main></body></html>",
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://penned.test" });
  const w = dom.window;
  w.crypto.randomUUID = randomUUID;
  w.console.log = w.console.info = () => {};
  w.scrollBy = () => {};
  w.ResizeObserver = class { observe() {} disconnect() {} };
  w.webkit = { messageHandlers: { tiptap: { postMessage: event => events.push(event) } } };
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 20 });
  for (const file of ["vendor/formula-parser.min.js", "table-formulas.js", "vellix-tables.js", "vendor/table-library.js", "tiptap.bundle.js"])
    w.eval(await readFile(new URL("../dist/" + file, import.meta.url), "utf8"));
  const command = (name, args = {}) => w.tiptapCommand(name, args);
  await command("setContent", { document: { type: "doc", content: [p("before", "Before"), p("trigger", "/template"), p("after", "After")] } });
  const editor = w.document.querySelector(".tiptap-editor").editor;
  const select = id => {
    editor.state.doc.descendants((node, pos) => { if (node.attrs.id === id) editor.commands.setTextSelection(pos + 1 + node.content.size); });
  };
  select("trigger");
  return { w, editor, command, events, select,
    json: async () => JSON.parse(JSON.stringify(await command("getDocument"))),
    async open() {
      assert.equal(await command("chooseSlashItem", { key: "templates" }), true);
      const request = events.findLast(e => e.kind === "templateRequest");
      assert(request?.payload.token);
      return request.payload.token;
    },
    close() { editor.destroy(); w.close(); },
  };
}

const template = () => ({ type: "doc", content: [
  { type: "heading", attrs: { id: "inserted-title", level: 2 }, content: [{ type: "text", text: "Template heading", marks: [{ type: "bold" }] }] },
  { type: "plainCallout", attrs: { id: "inserted-callout", color: "#C65392" }, content: [p("inserted-text", "Inside callout")] },
  { type: "bulletList", attrs: { id: "inserted-list" }, content: [{ type: "listItem", attrs: { id: "inserted-item" }, content: [p("list-text", "List text")] }] },
] });

test("/template opens the gallery and inserts native blocks at the caret as one undoable edit", async () => {
  const h = await runtime();
  try {
    const menu = h.events.findLast(e => e.kind === "slashMenu" && e.payload.visible);
    assert.equal(menu.payload.items[0].key, "templates");
    const token = await h.open();
    assert.equal(h.editor.getText().includes("/template"), false);
    const before = await h.json();
    assert.equal(await h.command("templateInsertionAvailable", { token }), true);
    assert.equal(await h.command("insertTemplate", { token, document: template() }), true);
    const after = await h.json();
    assert.deepEqual(after.content[0], before.content[0]);
    assert.deepEqual(after.content.at(-1), before.content.at(-1));
    assert.equal(after.content[1].type, "heading");
    assert.equal(after.content[1].content[0].marks[0].type, "bold");
    assert.equal(after.content[2].content[0].content[0].text, "Inside callout");
    assert.equal(after.content[3].type, "bulletList");
    assert.equal(h.editor.state.selection.$from.parent.type.name, "paragraph");
    assert.equal(await h.command("templateInsertionAvailable", { token }), false);
    await h.command("undo"); assert.deepEqual(await h.json(), before);
    await h.command("redo"); assert.deepEqual(await h.json(), after);
    await h.command("setContent", { document: after }); assert.deepEqual(await h.json(), after);
  } finally { h.close(); }
});

test("dismissal, read-only mode and document reload cannot apply an old template request", async () => {
  const h = await runtime();
  try {
    const token = await h.open(), before = await h.json();
    await h.command("setEditable", { editable: false });
    assert.equal(await h.command("insertTemplate", { token, document: template() }), false);
    await h.command("setEditable", { editable: true });
    await h.command("templateEndInsertion", { token });
    assert.equal(await h.command("insertTemplate", { token, document: template() }), false);
    assert.deepEqual(await h.json(), before);
    await h.command("insertBlock", { blockType: "templates" });
    const next = h.events.findLast(e => e.kind === "templateRequest").payload.token;
    await h.command("setContent", { document: before });
    assert.equal(await h.command("insertTemplate", { token: next, document: template() }), false);
    assert.deepEqual(await h.json(), before);
  } finally { h.close(); }
});

test("changing the caret while the gallery is open uses the new position, not a stale block", async () => {
  const h = await runtime();
  try {
    const token = await h.open();
    h.select("after");
    assert.equal(await h.command("insertTemplate", { token, document: template() }), true);
    const content = (await h.json()).content;
    const after = content.findIndex(n => n.attrs.id === "after");
    const heading = content.findIndex(n => n.attrs.id === "inserted-title");
    assert(after < heading);
  } finally { h.close(); }
});

test("the toolbar entry inserts inside the current callout at a mid-paragraph caret", async () => {
  const h = await runtime();
  try {
    await h.command("setContent", { document: { type: "doc", content: [
      { type: "plainCallout", attrs: { id: "existing-callout" }, content: [p("middle", "LeftRight")] },
      p("outside", "Unchanged"),
    ] } });
    let caret;
    h.editor.state.doc.descendants((node, pos) => { if (node.attrs.id === "middle") caret = pos + 5; });
    h.editor.commands.setTextSelection(caret);
    const before = await h.json();
    await h.command("insertBlock", { blockType: "templates" });
    const token = h.events.findLast(e => e.kind === "templateRequest").payload.token;
    const inserted = { type: "doc", content: [p("new-block", "Inserted text")] };
    assert.equal(await h.command("insertTemplate", { token, document: inserted }), true);
    const after = await h.json();
    assert.deepEqual(after.content[0].content.map(n => n.content?.map(t => t.text).join("")), ["Left", "Inserted text", "Right"]);
    assert.deepEqual(after.content.at(-1), before.content.at(-1));
    await h.command("undo"); assert.deepEqual(await h.json(), before);
  } finally { h.close(); }
});

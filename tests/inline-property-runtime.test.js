import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import { PROPERTY_KINDS } from "../src/inline-properties.js";

async function mountedRuntime(content = [{ type: "paragraph" }]) {
  const events = [];
  const dom = new JSDOM("<!doctype html><html><body><main class='vellix-editor-page'><div id='editor'></div></main></body></html>",
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://vellix.test" });
  const { window } = dom;
  window.console.log = window.console.info = () => {};
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.webkit = { messageHandlers: { tiptap: { postMessage(message) { events.push(message); } } } };
  window.crypto.randomUUID = randomUUID;
  window.scrollBy = () => {};
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 24, right: 100 });
  for (const file of ["vendor/formula-parser.min.js", "table-formulas.js", "vellix-tables.js", "vendor/table-library.js", "tiptap.bundle.js"])
    window.eval(await readFile(file === "tiptap.bundle.js" && process.env.PENNED_EDITOR_RUNTIME
      ? process.env.PENNED_EDITOR_RUNTIME : new URL("../dist/" + file, import.meta.url), "utf8"));
  await window.tiptapCommand("setContent", { document: { type: "doc", content } });
  const command = (name, args = {}) => window.tiptapCommand(name, args);
  return { window, events, command,
    json: async () => JSON.parse(JSON.stringify(await command("getDocument"))),
    paragraphAtCaret() {
      assert.equal(window.document.activeElement === window.document.querySelector(".tiptap-editor"), true,
        "the text editor should own focus");
      const anchor = window.document.getSelection().anchorNode;
      return (anchor?.nodeType === 1 ? anchor : anchor?.parentElement)?.closest("p");
    },
    paste(text) {
      const event = new window.Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { getData: type => type === "text/plain" ? text : "" } });
      window.document.querySelector(".tiptap-editor").dispatchEvent(event);
    },
    close: () => window.close(),
  };
}

for (const { kind } of PROPERTY_KINDS) {
  for (const nested of [false, true]) {
    test(`${kind} property sheet round trips${nested ? " in a nested container" : ""} never insert a paragraph`, async () => {
      const property = { type: "inlineProperty", attrs: { id: "property", property: { kind, name: "Property" } } };
      const h = await mountedRuntime(nested ? [{ type: "blockquote", content: [property] }] : [property]);
      try {
        const before = await h.json();
        for (let attempt = 0; attempt < 3; attempt += 1) {
          h.window.document.querySelector(".vellix-property-name").click();
          const request = h.events.findLast(event => event.kind === "propertyEditorRequest").payload;
          assert.equal(request.blockId, "property");
          assert.deepEqual((await h.json()).content, before.content, "opening the sheet must not change content");
          await h.command("focusAfterInlineProperty", { blockId: request.blockId });
          assert.deepEqual((await h.json()).content, before.content, "closing the sheet must not insert a typing paragraph");
          assert.equal(h.window.document.querySelector(".tiptap-editor p"), null);
          assert.notEqual(h.window.document.activeElement, h.window.document.querySelector(".tiptap-editor"));
        }
        await h.command("setContent", { document: before });
        assert.deepEqual((await h.json()).content, before.content, "reopening the document must preserve its original blocks");
      } finally { h.close(); }
    });
  }
}

for (const { kind } of PROPERTY_KINDS) {
  for (const nested of [false, true]) {
    test(`Backspace below a ${kind} property${nested ? " in a nested container" : ""} deletes the empty paragraph and blurs without selecting the property`, async () => {
      const blocks = [{ type: "inlineProperty", attrs: { id: "property", property: { kind, name: "Property" } } },
        { type: "paragraph", attrs: { id: "below" } }];
      const h = await mountedRuntime(nested ? [{ type: "blockquote", content: blocks }] : blocks);
      try {
        // Loading strips the root's trailing empty paragraph; only an explicit page tap recreates it.
        if (!nested) assert(await h.command("focusDocumentEnd"));
        await h.command("focusAfterInlineProperty", { blockId: "property" });
        assert(h.paragraphAtCaret());
        const before = await h.json();
        const event = new h.window.KeyboardEvent("keydown", {
          key: "Backspace", code: "Backspace", keyCode: 8, bubbles: true, cancelable: true
        });
        h.window.document.querySelector(".tiptap-editor").dispatchEvent(event);
        await new Promise(resolve => h.window.requestAnimationFrame(resolve));
        assert(event.defaultPrevented);
        assert.notEqual(h.window.document.activeElement, h.window.document.querySelector(".tiptap-editor"));
        assert.equal(h.window.document.querySelector(".vellix-property.ProseMirror-selectednode"), null);
        assert.equal(h.window.document.getSelection().rangeCount, 0);
        assert.equal(h.events.findLast(event => event.kind === "focus").payload.focused, false);
        const saved = await h.json();
        const beforeBlocks = nested ? before.content[0].content : before.content;
        const savedBlocks = nested ? saved.content[0].content : saved.content;
        assert.deepEqual(savedBlocks, beforeBlocks.slice(0, 1));
        assert.equal(h.window.document.querySelector(".tiptap-editor p"), null);
        await h.command("setContent", { document: saved });
        assert.deepEqual((await h.json()).content, saved.content, "the deleted paragraph must stay deleted on reload");
      } finally { h.close(); }
    });
  }
}

test("deleting an empty paragraph below a property preserves following rich text and supports undo and redo", async () => {
  const h = await mountedRuntime([
    { type: "inlineProperty", attrs: { id: "property", property: { kind: "date", value: "2026-10-13" } } },
    { type: "paragraph", attrs: { id: "below" } },
    { type: "paragraph", attrs: { id: "following" }, content: [{ type: "text", text: "Keep this text", marks: [{ type: "bold" }] }] },
  ]);
  try {
    await h.command("focusAfterInlineProperty", { blockId: "property" });
    const before = await h.json();
    h.window.document.querySelector(".tiptap-editor").dispatchEvent(new h.window.KeyboardEvent("keydown", {
      key: "Backspace", code: "Backspace", keyCode: 8, bubbles: true, cancelable: true
    }));
    await new Promise(resolve => h.window.requestAnimationFrame(resolve));
    const saved = await h.json();
    assert.deepEqual(saved.content, before.content.filter((_, index) => index !== 1));
    assert.notEqual(h.window.document.activeElement, h.window.document.querySelector(".tiptap-editor"));
    assert.equal(h.window.document.querySelector(".vellix-property.ProseMirror-selectednode"), null);
    assert(await h.command("undo"));
    assert.deepEqual((await h.json()).content, before.content);
    assert(await h.command("redo"));
    assert.deepEqual((await h.json()).content, saved.content);
  } finally { h.close(); }
});

test("Backspace at the start of text below a property preserves the text and dismisses editing", async () => {
  const h = await mountedRuntime([{ type: "inlineProperty", attrs: { id: "property", property: { kind: "date" } } },
    { type: "paragraph", content: [{ type: "text", text: "Keep this text", marks: [{ type: "bold" }] }] }]);
  try {
    await h.command("focusAfterInlineProperty", { blockId: "property" });
    const before = await h.json();
    h.window.document.querySelector(".tiptap-editor").dispatchEvent(new h.window.KeyboardEvent("keydown", {
      key: "Backspace", code: "Backspace", keyCode: 8, bubbles: true, cancelable: true
    }));
    await new Promise(resolve => h.window.requestAnimationFrame(resolve));
    assert.notEqual(h.window.document.activeElement, h.window.document.querySelector(".tiptap-editor"));
    assert.deepEqual((await h.json()).content, before.content);
  } finally { h.close(); }
});

test("saving an inserted date property creates no typing paragraph until the user explicitly taps the page", async () => {
  const h = await mountedRuntime();
  try {
    assert(await h.command("insertBlock", { blockType: "property:date" }));
    const request = h.events.findLast(event => event.kind === "propertyEditorRequest").payload;
    assert(await h.command("updateInlineProperty", { blockId: request.blockId,
      property: { ...request.property, name: "Date", value: "2026-10-13" } }));
    const afterSave = await h.json();
    await h.command("focusAfterInlineProperty", { blockId: request.blockId });
    assert.deepEqual((await h.json()).content, afterSave.content, "saving and closing must only change property metadata");
    assert(await h.command("focusDocumentEnd"));
    assert(h.paragraphAtCaret());
    h.paste("Typing after the date");
    const saved = await h.json();
    const index = saved.content.findIndex(node => node.type === "inlineProperty");
    assert.equal(saved.content[index].attrs.property.value, "2026-10-13");
    assert.equal(saved.content[index + 1].content[0].text, "Typing after the date");
    await h.command("setContent", { document: saved });
    await h.command("focusAfterInlineProperty", { blockId: request.blockId });
    assert(h.paragraphAtCaret());
    assert.deepEqual((await h.json()).content, saved.content, "reopening a property must not add blank paragraphs");
  } finally { h.close(); }
});

test("closing a property before a heading focuses that existing text without inserting or reformatting content", async () => {
  const h = await mountedRuntime([
    { type: "inlineProperty", attrs: { id: "date", property: { kind: "date", name: "Date" } } },
    { type: "heading", attrs: { id: "heading", level: 2 }, content: [{ type: "text", text: "Keep this heading", marks: [{ type: "bold" }] }] },
  ]);
  try {
    const before = await h.json();
    assert(await h.command("focusAfterInlineProperty", { blockId: "date" }));
    assert.deepEqual((await h.json()).content, before.content);
    const anchor = h.window.document.getSelection().anchorNode;
    assert((anchor?.nodeType === 1 ? anchor : anchor?.parentElement)?.closest("h2"));
  } finally { h.close(); }
});

test("closing a property before another property preserves both blocks without creating a gap paragraph", async () => {
  const h = await mountedRuntime([
    { type: "inlineProperty", attrs: { id: "first", property: { kind: "multiSelect", name: "Types" } } },
    { type: "inlineProperty", attrs: { id: "second", property: { kind: "text", name: "Notes" } } },
  ]);
  try {
    const before = await h.json();
    await h.command("focusAfterInlineProperty", { blockId: "first" });
    assert.deepEqual((await h.json()).content, before.content);
    assert.equal(h.window.document.querySelector(".tiptap-editor p"), null);
  } finally { h.close(); }
});

test("a property save followed by sheet dismissal adds no separate paragraph history step", async () => {
  const h = await mountedRuntime([{ type: "inlineProperty", attrs: {
    id: "property", property: { kind: "text", name: "Original", value: "Keep this" }
  } }]);
  try {
    const before = await h.json();
    await h.command("updateInlineProperty", { blockId: "property", property: {
      ...before.content[0].attrs.property, name: "Updated"
    } });
    const updated = await h.json();
    await h.command("focusAfterInlineProperty", { blockId: "property" });
    assert.deepEqual((await h.json()).content, updated.content);
    assert(await h.command("undo"));
    assert.notDeepEqual((await h.json()).content, updated.content,
      "undo must reach earlier content, not merely remove an inserted paragraph");
    assert(await h.command("redo"));
    assert.deepEqual((await h.json()).content, updated.content);
  } finally { h.close(); }
});

for (const nativeTap of [false, true]) {
  test(`${nativeTap ? "the native blank-page tap command" : "tapping the web page below a date"} inserts a real paragraph and accepts typing`, async () => {
    const h = await mountedRuntime([{ type: "inlineProperty", attrs: {
      id: "date", property: { kind: "date", name: "Date", value: "2026-10-13" }
    } }]);
    try {
      if (nativeTap) assert(await h.command("focusDocumentEnd"));
      else h.window.document.querySelector(".vellix-editor-page").dispatchEvent(new h.window.MouseEvent("click", {
        bubbles: true, cancelable: true, clientX: 60, clientY: 180
      }));
      assert(h.paragraphAtCaret());
      h.paste("Typing after tapping the page");
      const saved = await h.json();
      assert.equal(saved.content[0].attrs.property.value, "2026-10-13");
      assert.equal(saved.content[1].type, "paragraph");
      assert.equal(saved.content[1].content[0].text, "Typing after tapping the page");
      assert(saved.content[1].attrs.id);
    } finally { h.close(); }
  });
}

test("deleting a property returns to text editing, while locked and selection-mode documents stay unchanged", async () => {
  const h = await mountedRuntime([{ type: "inlineProperty", attrs: {
    id: "date", property: { kind: "date", name: "Date", value: "2026-10-13" }
  } }]);
  try {
    const before = await h.json();
    await h.command("setEditable", { editable: false });
    assert.equal(await h.command("focusAfterInlineProperty", { blockId: "date" }), false);
    assert.deepEqual((await h.json()).content, before.content);
    await h.command("setEditable", { editable: true });
    await h.command("setSelectionMode", { mode: "single" });
    assert.equal(await h.command("focusAfterInlineProperty", { blockId: "date" }), false);
    assert.deepEqual((await h.json()).content, before.content);
    await h.command("setSelectionMode", { mode: "off" });
    assert(await h.command("deleteInlineProperty", { blockId: "date" }));
    assert(await h.command("focusAfterInlineProperty", { blockId: "date" }));
    assert(h.paragraphAtCaret());
    h.paste("Still editable");
    assert.equal((await h.json()).content[0].content[0].text, "Still editable");
  } finally { h.close(); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";

const paragraph = (text, id = randomUUID()) => ({ type: "paragraph", attrs: { id },
  content: text ? [{ type: "text", text, marks: [{ type: "bold" }] }] : [] });
const callout = (type, id, color, text) => ({ type, attrs: { id, color,
  ...(type === "callout" ? { icon: "heartwavy" } : {}) }, content: [paragraph(text, id + "-text")] });

async function runtime(content) {
  const events = [];
  const dom = new JSDOM("<!doctype html><html><body><main class='vellix-editor-page'><div id='editor'></div></main></body></html>",
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://penned.test" });
  const { window } = dom;
  window.console.log = window.console.info = () => {};
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.webkit = { messageHandlers: { tiptap: { postMessage(message) { events.push(JSON.parse(JSON.stringify(message))); } } } };
  window.crypto.randomUUID = randomUUID;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.scrollBy = () => {};
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  for (const file of ["vendor/formula-parser.min.js", "table-formulas.js", "vellix-tables.js", "vendor/table-library.js", "tiptap.bundle.js"]) {
    window.eval(await readFile(new URL("../dist/" + file, import.meta.url), "utf8"));
  }
  await window.tiptapCommand("setContent", { document: { type: "doc", content } });
  const editor = window.document.querySelector(".tiptap-editor").editor;
  const enter = () => editor.view.dom.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "Enter", code: "Enter", bubbles: true, cancelable: true
  }));
  const selectEnd = id => {
    let end;
    editor.state.doc.descendants((node, pos) => { if (node.attrs.id === id) end = pos + 1 + node.content.size; });
    assert.notEqual(end, undefined);
    editor.commands.setTextSelection(end);
  };
  return { window, events, command: (name, args = {}) => window.tiptapCommand(name, args),
    editor, enter, selectEnd,
    json: async () => JSON.parse(JSON.stringify(await window.tiptapCommand("getDocument", {}))), close: () => window.close() };
}

test("existing icon callouts keep their type, identity, icon, color, text and formatting", async () => {
  const h = await runtime([callout("callout", "existing", "#FF5EAB", "Existing note")]);
  try {
    const saved = await h.json();
    const block = saved.content[0];
    assert.equal(block.type, "callout");
    assert.equal(block.attrs.id, "existing");
    assert.equal(block.attrs.icon, "heartwavy");
    assert.equal(block.attrs.color, "#FF5EAB");
    assert.deepEqual(block.content[0].content[0].marks, [{ type: "bold" }]);
    assert(h.window.document.querySelector(".vellix-callout-icon-button"));
    await h.command("setContent", { document: saved });
    assert.deepEqual(await h.json(), saved);
  } finally { h.close(); }
});

test("plainCallout is independent and round-trips colored formatted text without an icon or icon column", async () => {
  const h = await runtime([callout("callout", "old", "#FF5EAB", "Icon note"),
    callout("plainCallout", "plain", "#8FE9FF", "Plain note")]);
  try {
    const saved = await h.json();
    const plain = saved.content[1];
    assert.equal(plain.type, "plainCallout");
    assert.equal(plain.attrs.color, "#8FE9FF");
    assert(!("icon" in plain.attrs));
    const host = h.window.document.querySelector(".vellix-plain-callout");
    assert(host);
    assert.equal(host.dataset.calloutColor, "#8FE9FF");
    assert.equal(host.querySelectorAll(".vellix-callout-icon-button, .vellix-callout-icon-image").length, 0);
    assert.equal(host.querySelector(".vellix-plain-callout-text").textContent, "Plain note");
    await h.command("setContent", { document: saved });
    assert.deepEqual(await h.json(), saved);
  } finally { h.close(); }
});

test("the add command creates a distinct editable no-icon callout", async () => {
  const h = await runtime([paragraph("")]);
  try {
    assert.equal(await h.command("insertBlock", { blockType: "plainCallout" }), true);
    const node = (await h.json()).content.find(node => node.type === "plainCallout");
    assert(node?.attrs.id);
    assert.equal(node.attrs.color, "#ffffff");
    assert(!("icon" in node.attrs));
    assert.equal(node.content[0].type, "paragraph");
    h.enter();
    assert(h.editor.isActive("plainCallout"), "The first Return stays inside a new empty callout");
    assert.equal((await h.json()).content.find(node => node.type === "plainCallout").content[0].content[0].type, "hardBreak");
    h.enter();
    const nodes = (await h.json()).content;
    const index = nodes.findIndex(node => node.type === "plainCallout");
    assert.equal(nodes[index + 1].type, "paragraph");
    assert(!h.editor.isActive("plainCallout"));
  } finally { h.close(); }
});

test("no-icon callouts keep multiline formatting and two Returns exit without retaining an empty line", async () => {
  const h = await runtime([callout("plainCallout", "plain", "#8FE9FF", "First line")]);
  try {
    const original = (await h.json()).content[0];
    h.selectEnd("plain-text"); h.enter();
    assert(h.editor.isActive("plainCallout"));
    h.editor.commands.insertContent("Second line");
    const multiline = (await h.json()).content[0];
    assert.deepEqual(multiline.attrs, original.attrs);
    assert.deepEqual(multiline.content[0].content.map(node => node.type), ["text", "hardBreak", "text"]);
    assert.equal(multiline.content[0].content[2].text, "Second line");
    assert.deepEqual(multiline.content[0].content[2].marks, [{ type: "bold" }]);
    h.enter(); assert(h.editor.isActive("plainCallout"));
    h.enter(); assert(!h.editor.isActive("plainCallout"));
    const escaped = await h.json();
    assert.deepEqual(escaped.content[0], multiline);
    h.editor.commands.undo(); h.editor.commands.redo();
    assert.deepEqual(await h.json(), escaped);
    h.editor.commands.insertContent("Outside the callout");
    const saved = await h.json();
    assert.deepEqual(saved.content[0], multiline);
    assert.equal(saved.content[1].content[0].text, "Outside the callout");
    await h.command("setContent", { document: saved });
    assert.deepEqual(await h.json(), saved);
  } finally { h.close(); }
});

test("icon callouts still exit on the first Return", async () => {
  const h = await runtime([callout("callout", "icon", "#FF5EAB", "Unchanged icon callout")]);
  try {
    const original = (await h.json()).content[0];
    h.selectEnd("icon-text"); h.enter();
    const saved = await h.json();
    assert.deepEqual(saved.content[0], original);
    assert.equal(saved.content[1].type, "paragraph");
    assert(!h.editor.isActive("callout"));
  } finally { h.close(); }
});

test("no-icon indentation moves the box, not its paragraphs, and respects indent limits", async () => {
  const h = await runtime([callout("plainCallout", "plain", "#C69AFE", "Indent the whole box")]);
  try {
    const original = (await h.json()).content[0];
    h.selectEnd("plain-text");
    assert.equal(await h.command("formatCurrentSelection", { action: "indent" }), true);
    let saved = await h.json();
    assert.equal(saved.content[0].attrs.indent, 1);
    assert.deepEqual(saved.content[0].content, original.content);
    assert.equal(h.window.document.querySelector(".vellix-plain-callout").dataset.vellixIndent, "1");
    for (let count = 0; count < 8; count++) await h.command("formatCurrentSelection", { action: "indent" });
    assert.equal((await h.json()).content[0].attrs.indent, 6);
    for (let count = 0; count < 8; count++) await h.command("formatCurrentSelection", { action: "outdent" });
    saved = await h.json();
    assert.deepEqual(saved.content[0], original);
    await h.command("setContent", { document: saved });
    assert.deepEqual(await h.json(), saved);
  } finally { h.close(); }
});

test("indenting beneath a toggle moves the complete callout inside and outdenting restores it", async () => {
  const toggle = { type: "toggleItem", attrs: { id: "toggle", open: false }, content: [paragraph("Toggle heading", "summary")] };
  const h = await runtime([toggle, callout("plainCallout", "plain", "#7EEAC8", "Keep the complete callout"), paragraph("Following text", "following")]);
  try {
    const before = await h.json();
    h.selectEnd("plain-text");
    assert.equal(await h.command("formatCurrentSelection", { action: "indent" }), true);
    const nested = await h.json();
    assert.equal(nested.content.length, 2);
    assert.equal(nested.content[0].attrs.open, true);
    assert.deepEqual(nested.content[0].content[0], before.content[0].content[0]);
    assert.deepEqual(nested.content[0].content[1], before.content[1]);
    assert.deepEqual(nested.content[1], before.content[2]);
    assert(h.editor.isActive("plainCallout") && h.editor.isActive("toggleItem"));
    await h.command("formatCurrentSelection", { action: "outdent" });
    const restored = await h.json();
    assert.deepEqual(restored.content[1], before.content[1]);
    assert.deepEqual(restored.content[2], before.content[2]);
    await h.command("formatCurrentSelection", { action: "indent" });
    assert.deepEqual(await h.json(), nested);
    await h.command("setContent", { document: nested });
    assert.deepEqual(await h.json(), nested);
    h.selectEnd("plain-text"); h.enter(); h.enter();
    assert(!h.editor.isActive("plainCallout") && h.editor.isActive("toggleItem"), "Exit only the callout, not its toggle");
    assert.equal((await h.json()).content[0].content[2].type, "paragraph");
  } finally { h.close(); }
});

test("multiline template guidance stays metadata and keeps its exact case and formatting", async () => {
  const note = callout("plainCallout", "guided", "#FF5EAB", "");
  note.content[0].attrs.placeholderEnabled = true;
  note.content[0].attrs.placeholderGuidance = [{ type: "text", text: "FIRST prompt", marks: [{ type: "italic" }] }];
  const h = await runtime([note]);
  try {
    await h.command("setTemplateEditing", { enabled: true });
    await h.command("setPlaceholderMode", { active: true });
    h.selectEnd("guided-text"); h.enter();
    h.editor.commands.insertContent("SECOND prompt");
    h.enter(); h.enter();
    const guided = (await h.json()).content[0];
    assert.deepEqual(guided.content[0].content, []);
    assert.deepEqual(guided.content[0].attrs.placeholderGuidance.map(node => node.type), ["text", "hardBreak", "text"]);
    assert.equal(guided.content[0].attrs.placeholderGuidance[2].text, "SECOND prompt");
    assert.deepEqual(guided.content[0].attrs.placeholderGuidance[2].marks, [{ type: "italic" }]);
    await h.command("setPlaceholderMode", { active: false });
    assert.equal(h.window.document.querySelector(".vellix-plain-callout-text p").dataset.vellixGuidance, "FIRST prompt\nSECOND prompt");
    h.editor.commands.insertContent("Permanent instructions");
    const saved = await h.json();
    await h.command("setContent", { document: saved });
    assert.deepEqual(await h.json(), saved);
  } finally { h.close(); }
});

test("read-only and block-selection modes cannot insert callout lines or change indentation", async () => {
  const h = await runtime([callout("plainCallout", "plain", "#7EEAC8", "Protected text")]);
  try {
    h.selectEnd("plain-text");
    const saved = await h.json();
    await h.command("setEditable", { editable: false });
    h.enter();
    assert.equal(await h.command("formatCurrentSelection", { action: "indent" }), false);
    assert.deepEqual(await h.json(), saved);
    await h.command("setEditable", { editable: true });
    await h.command("setSelectionMode", { mode: "multi" });
    h.enter();
    assert.deepEqual(await h.json(), saved);
  } finally { h.close(); }
});

test("the no-icon creation command applies a chosen custom color immediately", async () => {
  const h = await runtime([paragraph("")]);
  try {
    assert.equal(await h.command("insertBlock", { blockType: "plainCallout", color: "#C69AFE" }), true);
    const saved = await h.json();
    const node = saved.content.find(node => node.type === "plainCallout");
    assert.equal(node.attrs.color, "#C69AFE");
    assert(!("icon" in node.attrs));
    await h.command("setContent", { document: saved });
    assert.deepEqual(await h.json(), saved);
  } finally { h.close(); }
});

test("no-icon callouts open the existing native color controls without an icon picker", async () => {
  const h = await runtime([callout("plainCallout", "plain", "#FF5EAB", "Note")]);
  try {
    const button = h.window.document.querySelector(".vellix-plain-callout-color-button");
    const click = () => button.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    click();
    assert.deepEqual(h.events.filter(event => event.kind === "calloutColorPickerRequest").at(-1)?.payload,
      { blockId: "plain", currentColor: "#FF5EAB" });
    assert.equal(h.events.filter(event => event.kind === "iconPickerRequest").length, 0);
    const count = h.events.filter(event => event.kind === "calloutColorPickerRequest").length;
    await h.command("setEditable", { editable: false });
    click();
    assert.equal(h.events.filter(event => event.kind === "calloutColorPickerRequest").length, count);
  } finally { h.close(); }
});

test("changing a plain callout color preserves both callout types and rich content", async () => {
  const h = await runtime([callout("callout", "old", "#FF5EAB", "Original"),
    callout("plainCallout", "plain", "#8FE9FF", "Colored text")]);
  try {
    const before = await h.json();
    await h.command("updateCalloutColor", { blockId: "plain", color: "#FFD36A" });
    const after = await h.json();
    assert.deepEqual(after.content[0], before.content[0]);
    assert.equal(after.content[1].type, "plainCallout");
    assert.equal(after.content[1].attrs.color, "#FFD36A");
    assert(!("icon" in after.content[1].attrs));
    assert.deepEqual(after.content[1].content, before.content[1].content);
    await h.command("setContent", { document: after });
    assert.deepEqual(await h.json(), after);
    await h.command("updateCalloutIcon", { blockId: "plain", icon: "sparkle" });
    assert(!("icon" in (await h.json()).content[1].attrs));
  } finally { h.close(); }
});

test("icon callouts still use the original icon picker and never the plain color-only request", async () => {
  const h = await runtime([callout("callout", "old", "#FF5EAB", "Original")]);
  try {
    h.window.document.querySelector(".vellix-callout-icon-button").dispatchEvent(
      new h.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.deepEqual(h.events.filter(event => event.kind === "iconPickerRequest").at(-1)?.payload,
      { blockId: "old", currentIcon: "heartwavy", currentColor: "#FF5EAB" });
    assert.equal(h.events.filter(event => event.kind === "calloutColorPickerRequest").length, 0);
  } finally { h.close(); }
});

test("plain callout guidance survives repeated template mode changes and reloads without becoming document text", async () => {
  const note = callout("plainCallout", "guided", "#7EEAC8", "");
  note.content[0].attrs.placeholderEnabled = true;
  note.content[0].attrs.placeholderGuidance = [
    { type: "text", text: "Write the name of the zodiac the moon is in.", marks: [{ type: "italic" }] },
  ];
  const h = await runtime([note, paragraph("Permanent instructions")]);
  try {
    const saved = await h.json();
    const prompt = () => h.window.document.querySelector(".vellix-plain-callout-text p");
    assert.equal(prompt().dataset.vellixGuidance, note.content[0].attrs.placeholderGuidance[0].text);
    for (let cycle = 0; cycle < 6; cycle++) {
      await h.command("setTemplateEditing", { enabled: true });
      await h.command("setPlaceholderMode", { active: true });
      assert.equal(prompt().textContent, note.content[0].attrs.placeholderGuidance[0].text);
      assert(prompt().classList.contains("vellix-guidance-region"));
      await h.command("setPlaceholderMode", { active: false });
      assert.equal(prompt().textContent, "");
      assert(prompt().classList.contains("vellix-guided-empty"));
      assert.deepEqual(await h.json(), saved);
    }
    await h.command("setTemplateEditing", { enabled: false });
    await h.command("setContent", { document: saved });
    assert.equal(prompt().dataset.vellixGuidance, note.content[0].attrs.placeholderGuidance[0].text);
    assert.deepEqual(await h.json(), saved);
  } finally { h.close(); }
});

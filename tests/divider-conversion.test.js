import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";

const divider = (id, style) => ({ type: "divider", attrs: { id, style, indent: 1, textAlign: "center" } });
const paragraph = () => ({ type: "paragraph", attrs: { id: "text" }, content: [
  { type: "text", text: "Keep this text", marks: [{ type: "bold" }] },
] });
async function nativeScript(file) {
  const source = await readFile(new URL(`../../Vellix/Vellix/Editor/${file}.swift`, import.meta.url), "utf8");
  const match = source.match(/static let script = #"""\n([\s\S]*?)\n"""#/);
  assert(match, file);
  return match[1];
}
async function runtime(content, mobile) {
  const events = [];
  const dom = new JSDOM("<!doctype html><html><body><main class='vellix-editor-page'><div id='editor'></div></main></body></html>",
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://penned.test" });
  const w = dom.window;
  w.console.log = w.console.info = () => {};
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.webkit = { messageHandlers: { tiptap: { postMessage: message => events.push(message) } } };
  w.crypto.randomUUID = randomUUID;
  w.scrollBy = () => {};
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  if (mobile) w.eval(await nativeScript("MobileBlockSelection"));
  for (const file of ["vendor/formula-parser.min.js", "table-formulas.js", "vellix-tables.js", "vendor/table-library.js", "tiptap.bundle.js"]) {
    w.eval(await readFile(new URL("../dist/" + file, import.meta.url), "utf8"));
  }
  w.eval(await nativeScript("TextBlockConversion"));
  const command = (name, args = {}) => w.tiptapCommand(name, args);
  await command("setContent", { document: { type: "doc", content } });
  const editor = w.document.querySelector(".tiptap-editor").editor;
  return { w, editor, command,
    async availability() {
      await new Promise(resolve => w.requestAnimationFrame(resolve));
      await new Promise(resolve => w.requestAnimationFrame(resolve));
      return events.filter(event => event.kind === "textConversionState").at(-1)?.payload.targets || [];
    },
    json: async () => JSON.parse(JSON.stringify(await command("getDocument"))),
    close: () => w.close(),
  };
}

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"}: all four divider conversions preserve text, identity, and undo/redo`, async () => {
    const h = await runtime([paragraph(), divider("one", "thinLine"), divider("two", "thickLine")], mobile);
    try {
      await h.command("setSelectionMode", { mode: "multi" });
      await h.command("selectAllBlocks");
      assert.deepEqual(new Set(await h.availability()), new Set([
        "divider:dottedCircles", "divider:fourCircles", "divider:thinLine", "divider:thickLine",
      ]));
      for (const style of ["dottedCircles", "fourCircles", "thinLine", "thickLine"]) {
        const before = await h.json();
        assert.equal(await h.command("setSelectedBlockType", { blockType: `divider:${style}` }), true);
        const saved = await h.json();
        assert.deepEqual(saved.content[0], before.content[0]);
        for (let index = 1; index <= 2; index++) {
          assert.equal(saved.content[index].type, "divider");
          assert.deepEqual(saved.content[index].attrs, { ...before.content[index].attrs, style });
        }
        await h.command("undo");
        assert.deepEqual(await h.json(), before);
        await h.command("redo");
        assert.deepEqual(await h.json(), saved);
        const doc = h.editor.state.doc;
        assert.equal(await h.command("setSelectedBlockType", { blockType: `divider:${style}` }), true);
        assert.equal(h.editor.state.doc, doc, "Choosing the current style must not rewrite the document");
      }
      const saved = await h.json();
      await h.command("setContent", { document: saved });
      assert.deepEqual(await h.json(), saved);
    } finally { h.close(); }
  });

  test(`${mobile ? "mobile" : "desktop"}: text-only selection and invalid divider styles cannot discard text`, async () => {
    const h = await runtime([paragraph()], mobile);
    try {
      await h.command("setSelectionMode", { mode: "multi" });
      await h.command("selectAllBlocks");
      assert(!(await h.availability()).some(target => target.startsWith("divider:")));
      const before = await h.json();
      assert.equal(await h.command("setSelectedBlockType", { blockType: "divider:fourCircles" }), false);
      assert.equal(await h.command("setSelectedBlockType", { blockType: "divider:unknown" }), false);
      assert.deepEqual(await h.json(), before);
    } finally { h.close(); }
  });
}

test("a selected divider inside a callout changes without converting its callout or sibling text", async () => {
  const h = await runtime([{ type: "plainCallout", attrs: { id: "box", widthPercent: 50, color: "#8FE9FF" },
    content: [paragraph(), divider("nested", "thinLine")] }], true);
  try {
    await h.command("setSelectionMode", { mode: "multi" });
    const record = h.w.PennedBlockSelection.records(h.editor.state.doc).find(block => block.node.attrs.id === "nested");
    h.w.PennedBlockSelection.selectionFacade().add(record.key);
    const before = await h.json();
    assert((await h.availability()).includes("divider:fourCircles"));
    assert.equal(await h.command("setSelectedBlockType", { blockType: "divider:fourCircles" }), true);
    const saved = await h.json();
    assert.deepEqual(saved.content[0].attrs, before.content[0].attrs);
    assert.deepEqual(saved.content[0].content[0], before.content[0].content[0]);
    assert.deepEqual(saved.content[0].content[1].attrs, { ...before.content[0].content[1].attrs, style: "fourCircles" });
    assert.equal(h.w.PennedBlockSelection.selectedRecords()[0].node.attrs.id, "nested");
    await h.command("undo");
    assert.deepEqual(await h.json(), before);
    await h.command("redo");
    assert.deepEqual(await h.json(), saved);
    await h.command("setEditable", { editable: false });
    assert.equal(await h.command("setSelectedBlockType", { blockType: "divider:thinLine" }), false);
    assert.deepEqual(await h.json(), saved);
  } finally { h.close(); }
});

for (const template of [false, true]) {
  test(`${template ? "template" : "document"}: leaving divider conversion cannot restore selection over the preceding callout`, async () => {
    const h = await runtime([
      { type: "plainCallout", attrs: { id: "preceding-callout", color: "#8FE9FF", widthPercent: 50 }, content: [
        { type: "paragraph", attrs: { id: "callout-placeholder", placeholderEnabled: true,
          placeholderGuidance: [{ type: "text", text: "Keep this guidance" }] } },
      ] },
      divider("chosen-divider", "thinLine"),
      { type: "heading", attrs: { id: "following-heading", level: 3 }, content: [{ type: "text", text: "Evening" }] },
    ], true);
    try {
      if (template) await h.command("setTemplateEditing", {
        enabled: true, templateID: "template", documentID: "document", placeholderMode: false,
      });
      let placeholderPosition;
      h.editor.state.doc.descendants((node, pos) => {
        if (node.attrs.id === "callout-placeholder") placeholderPosition = pos;
      });
      assert.notEqual(placeholderPosition, undefined);
      h.editor.commands.setNodeSelection(placeholderPosition);
      await h.command("setSelectionMode", { mode: "multi" });
      const record = h.w.PennedBlockSelection.records(h.editor.state.doc)
        .find(block => block.node.attrs.id === "chosen-divider");
      h.w.PennedBlockSelection.selectionFacade().add(record.key);
      const before = await h.json();
      const selectCalloutInDOM = () => {
        const range = h.w.document.createRange();
        range.selectNode(h.editor.view.nodeDOM(placeholderPosition));
        const selection = h.w.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
        assert.equal(selection.rangeCount, 1);
      };
      selectCalloutInDOM();
      assert.equal(await h.command("setSelectedBlockType", { blockType: "divider:fourCircles" }), true);
      assert.equal(h.editor.state.selection.empty, true);
      assert.equal(h.editor.state.selection.$from.parent.attrs.id, "following-heading");
      assert.equal(h.editor.view.hasFocus(), false);
      assert.equal(h.w.getSelection().rangeCount, 0);
      const saved = await h.json();
      assert.deepEqual(saved.content[0], before.content[0]);
      assert.deepEqual(saved.content[2], before.content[2]);
      assert.equal(saved.content[1].attrs.style, "fourCircles");
      assert.equal(h.w.PennedBlockSelection.selectedRecords()[0].node.attrs.id, "chosen-divider");

      // Model the stale range WebKit can retain while the native menu closes.
      selectCalloutInDOM();
      await h.command("setSelectionMode", { mode: "off" });
      assert.equal(h.w.getSelection().rangeCount, 0);
      assert.equal(h.editor.state.selection.empty, true);
      assert.equal(h.editor.state.selection.$from.parent.attrs.id, "following-heading");
      assert.equal(h.w.PennedBlockSelection.selectedRecords().length, 0);
      assert.equal(h.w.document.querySelector('[data-vellix-block-id="callout-placeholder"].ProseMirror-selectednode'), null);
      assert.deepEqual(await h.json(), saved);

      await h.command("undo");
      assert.deepEqual(await h.json(), before);
      assert.equal(h.editor.state.selection.empty, true, "Undo must not restore the old callout node selection");
      await h.command("redo");
      assert.deepEqual(await h.json(), saved);
      assert.equal(h.editor.state.selection.empty, true);
    } finally { h.close(); }
  });
}

test("with only locked placeholder text, conversion falls back to the divider rather than selecting the callout", async () => {
  const h = await runtime([
    { type: "plainCallout", attrs: { id: "locked-box" }, content: [{ type: "paragraph",
      attrs: { id: "locked-text", placeholderEnabled: true, placeholderGuidance: [{ type: "text", text: "Keep" }] } }] },
    divider("last-divider", "thinLine"),
  ], true);
  try {
    await h.command("setTemplateEditing", { enabled: true, templateID: "template", documentID: "document", placeholderMode: false });
    await h.command("setSelectionMode", { mode: "multi" });
    const record = h.w.PennedBlockSelection.records(h.editor.state.doc).find(block => block.node.attrs.id === "last-divider");
    h.w.PennedBlockSelection.selectionFacade().add(record.key);
    const before = await h.json();
    assert.equal(await h.command("setSelectedBlockType", { blockType: "divider:fourCircles" }), true);
    assert.equal(h.editor.state.selection.node?.attrs.id, "last-divider");
    assert.deepEqual((await h.json()).content[0], before.content[0]);
    await h.command("setSelectionMode", { mode: "off" });
    assert.equal(h.w.getSelection().rangeCount, 0);
    assert.notEqual(h.editor.state.selection.node?.attrs.id, "locked-text");
  } finally { h.close(); }
});

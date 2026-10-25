import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("../src/tiptap.html", import.meta.url), "utf8");
const breakAttributes = ["data-vellix-page-break", 'data-type="pageBreak"', "data-page-break"];

function page(content) {
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  const root = dom.window.document.getElementById("editor");
  root.className = "tiptap-editor ProseMirror";
  root.innerHTML = content;
  return { dom, style: element => dom.window.getComputedStyle(element), root, close: () => dom.window.close() };
}

for (const name of ["vellix-callout", "vellix-plain-callout"]) {
  test(`${name} keeps page-edge spacing outside its box for every supported page-break marker`, () => {
    for (const attributes of breakAttributes) {
      const h = page(`<div ${attributes}></div><div class="${name}"><p>Callout content</p></div><div ${attributes}></div>`);
      try {
        const style = h.style(h.root.children[1]);
        assert.equal(style.paddingTop, "8px");
        assert.equal(style.paddingBottom, "8px");
        assert.equal(style.marginTop, "20px");
        assert.equal(style.marginBottom, "20px");
        assert.equal(style.borderRadius, "12px");
        assert.equal(h.style(h.root.firstElementChild).marginBottom, "0px");
        assert.equal(h.style(h.root.lastElementChild).marginTop, "0px");
      } finally { h.close(); }
    }
  });

  test(`${name} without an adjacent page break retains its normal internal and external spacing`, () => {
    const h = page(`<p>Before</p><div class="${name}"><p><br></p></div><p>After</p>`);
    try {
      const style = h.style(h.root.children[1]);
      assert.equal(style.paddingTop, "8px");
      assert.equal(style.paddingBottom, "8px");
      assert.equal(style.marginTop, "10px");
      assert.equal(style.marginBottom, "10px");
    } finally { h.close(); }
  });
}

test("paragraphs retain their existing page-edge padding", () => {
  for (const attributes of breakAttributes) {
    const h = page(`<div ${attributes}></div><p>Ordinary text</p><div ${attributes}></div>`);
    try {
      const style = h.style(h.root.children[1]);
      assert.equal(style.paddingTop, "20px");
      assert.equal(style.paddingBottom, "20px");
      assert.equal(style.marginTop, "0px");
      assert.equal(style.marginBottom, "0px");
    } finally { h.close(); }
  }
});

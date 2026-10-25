import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("../src/tiptap.html", import.meta.url), "utf8");

for (const level of [1, 2, 3, 4, 5]) {
  test(`H${level} gains space after a paragraph without changing divider or following-paragraph spacing`, () => {
    const dom = new JSDOM(html);
    try {
      const { document } = dom.window;
      document.querySelector("#editor").innerHTML = `<div class="tiptap-editor">
        <h${level} id="first">First heading</h${level}>
        <p>Preceding paragraph</p><h${level} id="after-paragraph">Heading</h${level}>
        <p id="below-heading">Following paragraph</p>
        <div data-vellix-divider="true" data-divider-style="thinLine"><span class="vellix-divider-line"></span></div>
        <h${level} id="after-divider">Heading after divider</h${level}>
        <blockquote><p>Nested paragraph</p><h${level} id="nested">Nested heading</h${level}></blockquote>
      </div>`;
      const margin = id => dom.window.getComputedStyle(document.getElementById(id)).marginTop;
      assert.equal(margin("after-paragraph"), "11px");
      assert.equal(margin("nested"), "11px");
      assert.equal(margin("first"), "0px");
      assert.equal(margin("after-divider"), "0px");
      assert.equal(margin("below-heading"), "0px");
      const divider = dom.window.getComputedStyle(document.querySelector("[data-vellix-divider]"));
      assert.equal(divider.marginBottom, "4px");
      assert.equal(divider.minHeight, "30px");
    } finally { dom.window.close(); }
  });
}

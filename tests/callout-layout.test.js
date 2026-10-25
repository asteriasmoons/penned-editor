import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("../src/tiptap.html", import.meta.url), "utf8");
const template = new JSDOM(html);
const layoutScript = template.window.document.querySelector("script:not([src])").textContent;
template.window.close();

function layout({ empty = false, center = 13.5, lines = 1, heading = false } = {}) {
  const tag = heading ? "h1" : "p";
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="editor"><div class="vellix-callout"
    data-vellix-block-id="note" data-callout-icon="sparkle"><button class="vellix-callout-icon-button" contenteditable="false"></button>
    <div class="vellix-callout-text"><${tag}>${empty ? '<br class="ProseMirror-trailingBreak">' : "Formatted text"}</${tag}></div></div></div></body></html>`,
    { runScripts: "outside-only" });
  const { window } = dom;
  const document = window.document;
  const text = document.querySelector(".vellix-callout-text"), first = text.firstElementChild;
  const pending = [];
  const observed = new Set();
  window.requestAnimationFrame = callback => { pending.push(callback); return pending.length; };
  window.ResizeObserver = class { observe(node) { observed.add(node); } unobserve(node) { observed.delete(node); } };
  window.CSS = { escape: value => value };
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve(), addEventListener() {} } });
  const properties = () => [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
    .find(rule => rule.selectorText?.includes('data-vellix-block-id="note"'))?.style;
  const offset = () => parseFloat(properties()?.getPropertyValue("--vellix-callout-text-offset") || "8");
  const rect = (top, height, width = 80) => ({ top, bottom: top + height, left: 0, right: width, width, height });
  text.getBoundingClientRect = () => rect(100, offset() * 2 + lines * 26);
  first.getClientRects = () => [rect(100 + offset(), lines * 26)];
  first.getBoundingClientRect = () => first.getClientRects()[0];
  const computedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = element => element === text ? { paddingTop: offset() + "px" }
    : element === first ? { borderTopWidth: "0px", paddingTop: "2px", lineHeight: "26px", fontSize: "16px" }
      : computedStyle(element);
  const firstLineRect = () => rect(100 + offset() + center - 9, 18, empty ? 0 : 80);
  const updateEmptyBreak = () => { if (empty) first.firstElementChild.getBoundingClientRect = firstLineRect; };
  updateEmptyBreak();
  window.Range.prototype.getClientRects = () => Array.from({ length: lines }, (_, index) => {
    const first = firstLineRect();
    return rect(first.top + index * 26, first.height);
  });
  const savedDOM = document.getElementById("editor").innerHTML;
  window.eval(layoutScript);
  const flush = () => { for (const callback of pending.splice(0)) callback(); };
  flush();
  return { window, text, observed, savedDOM, properties, flush, close: () => window.close(),
    changeFirstLine(next) { center = next; window.dispatchEvent(new window.Event("resize")); flush(); },
    setEmpty(value) {
      empty = value;
      first.innerHTML = empty ? '<br class="ProseMirror-trailingBreak">' : "Formatted text";
      updateEmptyBreak();
      window.dispatchEvent(new window.Event("resize")); flush();
    },
    offsets: () => [offset(), parseFloat(properties().getPropertyValue("--vellix-callout-icon-offset"))] };
}

test("empty callouts center the caret line beside the 42-point icon without changing document DOM", () => {
  const h = layout({ empty: true });
  try {
    assert.deepEqual(h.offsets(), [7.5, 0]);
    assert.equal(h.window.document.getElementById("editor").innerHTML, h.savedDOM);
    assert(h.observed.has(h.text));
  } finally { h.close(); }
});

test("populated text aligns with the top of the whole icon box, independent of multiline height", () => {
  const single = layout(), multiline = layout({ lines: 12 });
  try {
    assert.deepEqual(single.offsets(), multiline.offsets());
    assert.deepEqual(multiline.offsets(), [0, 4.5]);
    assert.equal(multiline.window.document.getElementById("editor").innerHTML, multiline.savedDOM);
  } finally { single.close(); multiline.close(); }
});

test("large first-line typography retains top-of-box alignment without negative text padding", () => {
  const h = layout({ heading: true, center: 27 });
  try {
    assert.deepEqual(h.offsets(), [0, 18]);
    h.changeFirstLine(13.5);
    assert.deepEqual(h.offsets(), [0, 4.5]);
  } finally { h.close(); }
});

test("repeated measurements and typography changes do not accumulate offsets or alter the saved block", () => {
  const h = layout();
  try {
    for (let count = 0; count < 20; count++) h.changeFirstLine(13.5);
    assert.deepEqual(h.offsets(), [0, 4.5]);
    h.changeFirstLine(16);
    assert.deepEqual(h.offsets(), [0, 7]);
    assert.equal(h.window.document.getElementById("editor").innerHTML, h.savedDOM);
    assert(h.properties().getPropertyValue("--vellix-callout-icon-mask").includes("sparkle"));
  } finally { h.close(); }
});

test("typing then clearing text restores exactly the unchanged empty-state alignment", () => {
  const h = layout({ empty: true });
  try {
    const emptyOffsets = h.offsets();
    h.setEmpty(false);
    assert.deepEqual(h.offsets(), [0, 4.5]);
    h.setEmpty(true);
    assert.deepEqual(h.offsets(), emptyOffsets);
    assert.equal(h.window.document.getElementById("editor").innerHTML, h.savedDOM);
  } finally { h.close(); }
});

test("plain callout guidance contains its real floated height and overrides stale estimates without a separate caret line", () => {
  const dom = new JSDOM(html);
  try {
    const rules = [...dom.window.document.styleSheets].flatMap(sheet => [...sheet.cssRules]);
    const region = rules.find(rule => rule.selectorText === ".vellix-plain-callout-text .vellix-guided-empty").style;
    const guidance = rules.find(rule => rule.selectorText === ".vellix-plain-callout-text .vellix-guided-empty::before").style;
    assert.equal(region.display, "flow-root");
    assert.equal(region.getPropertyValue("min-height"), "0px");
    assert.equal(region.getPropertyPriority("min-height"), "important");
    assert.equal(guidance.width, "100%");
    assert.equal(guidance.height, "auto");
    assert.equal(guidance.marginRight, "-100%");
    assert(!guidance.getPropertyValue("position"), "Guidance contributes to layout instead of becoming an overlay");
    assert(!guidance.getPropertyValue("display"), "Preserve the original floated placeholder and editable BR");
  } finally { dom.window.close(); }
});

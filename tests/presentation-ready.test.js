import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { prepareDocumentPresentation } from "../src/presentation-ready.js";

test("readiness waits for fonts and visible images before native paint confirmation", async () => {
  const dom = new JSDOM("<main><img id='visible'><img id='below'></main>", { pretendToBeVisual: true });
  try {
    const document = dom.window.document, root = document.querySelector("main");
    let resolveFonts, resolveImage, belowDecoded = false, finished = false;
    Object.defineProperty(document, "fonts", { value: { ready: new Promise(resolve => { resolveFonts = resolve; }) } });
    root.getBoundingClientRect = () => ({ top: 0 });
    document.querySelector("#visible").getBoundingClientRect = () => ({ top: 20, bottom: 100 });
    document.querySelector("#visible").decode = () => new Promise(resolve => { resolveImage = resolve; });
    document.querySelector("#below").getBoundingClientRect = () => ({ top: 2000, bottom: 2100 });
    document.querySelector("#below").decode = async () => { belowDecoded = true; };
    const result = prepareDocumentPresentation(root, document).then(() => { finished = true; });
    await Promise.resolve(); assert.equal(finished, false);
    resolveFonts(); await Promise.resolve(); await Promise.resolve();
    assert.equal(finished, false); assert.equal(belowDecoded, false);
    resolveImage(); await result;
    assert.equal(finished, true); assert.equal(belowDecoded, false);
  } finally { dom.window.close(); }
});

test("a hidden cached editor prepares without waiting for a suspended animation frame", async () => {
  const dom = new JSDOM("<main><div data-native-collection-block='block' data-native-collection-view='view'></div></main>");
  try {
    const document = dom.window.document, root = document.querySelector("main");
    let requestedFrames = 0;
    dom.window.requestAnimationFrame = () => { requestedFrames += 1; };
    root.getBoundingClientRect = () => ({ top: 0 });
    assert.equal(document.visibilityState, "prerender");
    assert.deepEqual(await prepareDocumentPresentation(root, document), {
      nativeViews: [{ blockID: "block", viewID: "view" }],
    });
    assert.equal(requestedFrames, 0);
  } finally { dom.window.close(); }
});

test("failed image decoding uses the existing image fallback instead of blocking presentation forever", async () => {
  const dom = new JSDOM("<main><img></main>", { pretendToBeVisual: true });
  try {
    const root = dom.window.document.querySelector("main"), image = root.querySelector("img");
    root.getBoundingClientRect = () => ({ top: 0 });
    image.getBoundingClientRect = () => ({ top: 10, bottom: 50 });
    image.decode = async () => { throw new Error("Missing local image"); };
    assert.deepEqual(await prepareDocumentPresentation(root, dom.window.document), { nativeViews: [] });
  } finally { dom.window.close(); }
});

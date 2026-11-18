import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderPublicContent } from "../src/public-document.js";
import { LABEL_DEFAULTS } from "../src/heading-label.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ||
  resolve(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const bundle = resolve(process.env.PENNED_EDITOR_BUNDLE || "dist");
const css = (await readFile(resolve(bundle, "tiptap.html"), "utf8")).match(/<style>([\s\S]*?)<\/style>/)[1];
const scallopedModule = "data:text/javascript;base64," +
  (await readFile(new URL("../src/scalloped-label.js", import.meta.url))).toString("base64");
const shapes = ["ribbon", "pill", "framed", "rectangular", "scalloped"], styles = ["filled", "glass", "textured", "outline"];
const heading = (level, id, text, label) => ({ type: "heading", attrs: { level, id, ...(label ? { label } : {}) },
  content: [{ type: "text", text, marks: [{ type: "italic" }] }] });
const label = { ...LABEL_DEFAULTS, presentation: "label", iconEnabled: true, icon: "sparkle", font: "mono" };
const fixtures = shapes.flatMap((shape, i) => styles.map((style, j) =>
  heading(i % 4 + 1, shape + style, j === 1 ? "A long heading that must wrap inside the available document width" : style,
    { ...label, shape, style, alignment: ["left", "center", "right"][j % 3],
      ...(shape === "framed" ? { borderThickness: [6, 2, 0, 4][j] } : {}) })));
const content = { type: "doc", content: [...fixtures, heading(3, "ordinary", "Ordinary heading"), heading(5, "legacy", "Unsupported level", label)] };
const publicResult = renderPublicContent({ content, media: [] }, { mediaURL: () => "", iconURL: name => "/icons/" + name + ".png" });
assert.equal(publicResult.toc.length, fixtures.length + 2);
assert.equal((publicResult.segments.join("").match(/class="penned-heading-label"/g) ?? []).length, fixtures.length);

try {
  for (const width of [320, 834]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.messages = [];
      window.webkit = { messageHandlers: { tiptap: { postMessage(message) { window.messages.push(message); } } } };
    });
    await page.goto(pathToFileURL(resolve(bundle, "tiptap.html")).href);
    const command = (name, args = {}) => page.evaluate(([name, args]) => window.tiptapCommand(name, args), [name, args]);
    await command("setContent", { document: content });
    await command("setEditable", { editable: true });
    const checkLayout = () => page.evaluate(() => {
      const root = document.querySelector(".tiptap-editor");
      return [...root.querySelectorAll(".penned-heading-label")].map(node => {
        const tile = node.querySelector(".penned-label-tile"), text = node.querySelector(".penned-label-text");
        const frame = tile.querySelector(".penned-label-frame > polygon");
        const glass = tile.querySelector(".penned-label-glass-material");
        const grain = tile.querySelector(".penned-label-grain");
        const grainStyle = grain && getComputedStyle(grain);
        const isFramed = node.dataset.labelShape === "framed";
        const surface = getComputedStyle(tile, isFramed ? "::before" : null);
        const bounds = tile.getBoundingClientRect(), available = node.getBoundingClientRect();
        return { tag: node.tagName, shape: node.dataset.labelShape, style: node.dataset.labelStyle,
          font: getComputedStyle(text).fontFamily,
          blur: glass ? getComputedStyle(glass).backdropFilter : surface.backdropFilter,
          glassBlend: glass ? getComputedStyle(glass, "::before").backgroundBlendMode : null,
          glassHighlight: glass ? getComputedStyle(glass, "::after").backgroundImage : null,
          grain: grainStyle && { tint: grainStyle.backgroundColor, mask: grainStyle.maskImage, size: grainStyle.maskSize },
          tail: getComputedStyle(tile, "::before").clipPath,
          tileClip: getComputedStyle(tile).clipPath,
          frame: frame && { stroke: getComputedStyle(frame).strokeWidth, points: frame.getAttribute("points"),
            namespace: frame.namespaceURI, overflow: getComputedStyle(frame.parentElement).overflow },
          icon: !!node.querySelector(".penned-label-icon"),
          fits: bounds.x >= available.x - 1 && bounds.right <= available.right + 1 && text.scrollWidth <= text.clientWidth + 1 };
      });
    });
    const editorLayout = await checkLayout();
    assert.equal(editorLayout.length, fixtures.length);
    assert(editorLayout.every(row => row.fits && row.icon && row.font.includes("monospace")));
    assert(editorLayout.filter(row => row.shape === "ribbon").every(row => row.tail.startsWith("polygon(")));
    assert(editorLayout.filter(row => row.style === "glass").every(row => row.blur.includes("blur") &&
      row.glassBlend === "multiply, screen, screen" && row.glassHighlight.includes("linear-gradient")));
    assert(editorLayout.filter(row => row.style !== "glass").every(row => row.glassBlend === null));
    assert(editorLayout.filter(row => row.style === "textured").every(({ grain }) => grain &&
      grain.mask.startsWith("url(") && grain.size === "192px 192px" &&
      grain.tint !== "rgb(0, 0, 0)" && grain.tint !== "rgb(255, 255, 255)"));
    const frames = editorLayout.filter(row => row.shape === "framed");
    assert(frames.every(row => row.tail.startsWith("polygon(") && row.tileClip === "none"));
    assert.deepEqual(frames.map(row => row.frame?.stroke), ["6px", "2px", undefined, "4px"]);
    assert(frames.filter(row => row.frame).every(({ frame }) => frame.namespace === "http://www.w3.org/2000/svg" &&
      frame.overflow === "visible" && frame.points.startsWith("7,0 93,0 95,12 98,12")));
    await page.waitForFunction(() => {
      const paths = [...document.querySelectorAll(".penned-label-scalloped-stroke")];
      return paths.length === 4 && paths.every(path => path.hasAttribute("d"));
    });
    const scallops = page.locator('[data-label-shape="scalloped"] .penned-label-tile');
    const paths = await scallops.evaluateAll(tiles => tiles.map(tile => {
      const path = tile.querySelector(".penned-label-scalloped-stroke").getAttribute("d");
      return { path, clip: tile.querySelector(".penned-label-scalloped-surface").getAttribute("style") };
    }));
    for (const { path, clip } of paths) {
      assert.equal(clip, `clip-path:path('${path}')`, "fill and stroke must use identical path data");
      const arcs = [...path.matchAll(/ A ([\d.]+) ([\d.]+) 0 [01] 1 /g)];
      assert(arcs.length >= 4 && arcs.every(arc => arc[1] === arc[2] && arc[1] === arcs[0][1]));
    }
    const first = page.locator(".penned-label-tile").first();
    assert.equal(await page.locator('[data-vellix-block-id="ordinary"]').evaluate(el => {
      const event = new Event("selectstart", { bubbles: true, cancelable: true });
      return el.dispatchEvent(event);
    }), true);
    await first.click();
    assert.equal(await page.evaluate(() => messages.filter(event => event.kind === "headingLabelSettings").length), 0);
    const box = await first.boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 35, box.y + 10);
    await page.waitForTimeout(700);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => messages.filter(event => event.kind === "headingLabelSettings").length), 0);
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.waitForTimeout(530);
    assert.equal(await page.evaluate(() => messages.filter(event => event.kind === "headingLabelSettings").length), 0);
    await page.waitForFunction(() => messages.some(event => event.kind === "headingLabelSettings"), null, { timeout: 1200 });
    await page.mouse.up();
    const request = await page.evaluate(() => messages.find(event => event.kind === "headingLabelSettings").payload);
    assert.equal(request.blockID, "ribbonfilled");
    assert.equal(request.level, 1);
    assert.equal(await page.evaluate(() => messages.some(event => event.kind === "blockActionsRequest")), false);
    const updated = await command("headingLabelUpdate", { ...request, original: request.settings, originalText: request.text,
      settings: { ...request.settings, presentation: "text", style: "glass" } });
    const [firstHeading] = updated.document.content;
    assert.equal(firstHeading.attrs.id, request.blockID);
    assert.equal(firstHeading.attrs.level, request.level);
    assert.equal(firstHeading.attrs.label.style, "glass");
    assert.equal(firstHeading.attrs.label.shape, "ribbon");
    assert.equal(firstHeading.content[0].marks[0].type, "italic");
    await command("setContent", { document: updated.document });
    assert.equal(await page.locator('[data-vellix-block-id="ribbonfilled"]').getAttribute("data-label-shape"), null);
    await command("headingLabelUpdate", { ...request, original: firstHeading.attrs.label, originalText: request.text,
      text: "Renamed", settings: { ...firstHeading.attrs.label, presentation: "label", iconEnabled: false } });
    assert.equal(await page.locator('[data-vellix-block-id="ribbonfilled"] .penned-label-text').textContent(), "Renamed");
    assert.equal(await page.locator('[data-vellix-block-id="ribbonfilled"] .penned-label-icon').count(), 0);
    const renamed = await command("getDocument");
    assert.equal((renamed.document ?? renamed).content[0].attrs.label.icon, "sparkle");
    await command("setSelectionMode", { mode: "off" });
    for (let level = 1; level <= 4; level++) {
      assert.equal(await command("insertBlock", { blockType: "labelHeading" + level }), true);
      await page.waitForFunction(level => {
        const editor = document.querySelector(".tiptap-editor").editor;
        return editor.isFocused && editor.state.selection.$from.parent.attrs.level === level;
      }, level, { timeout: 2000 });
      await page.keyboard.insertText("Inserted label " + level);
      const live = await command("getDocument");
      assert((live.document ?? live).content.some(node => node.type === "heading" && node.attrs.level === level &&
        node.attrs.label?.presentation === "label" && node.content?.[0].text?.includes("Inserted label " + level) &&
        !fixtures.some(fixture => fixture.attrs.id === node.attrs.id)),
        JSON.stringify((live.document ?? live).content.filter(node => !content.content.some(fixture => fixture.attrs.id === node.attrs?.id))));
    }
    assert.deepEqual(errors, []);
    await page.setContent(`<style>${css}</style><article class="tiptap-editor">${publicResult.segments.join("")}</article>`);
    await page.evaluate(async url => {
      const { observeScallopedLabels } = await import(url);
      observeScallopedLabels(document.querySelector("article"));
    }, scallopedModule);
    const publicLayout = await checkLayout();
    assert.deepEqual(publicLayout, editorLayout);
    const longLabel = page.locator('[data-label-shape="scalloped"][data-label-style="glass"]');
    const beforeResize = await longLabel.locator("path").getAttribute("d");
    assert(beforeResize);
    await longLabel.evaluate(node => { node.style.width = "150px"; });
    await page.waitForFunction(previous => {
      const path = document.querySelector('[data-label-shape="scalloped"][data-label-style="glass"] path').getAttribute("d");
      return path && path !== previous;
    }, beforeResize);
    if (process.env.HEADING_LABEL_SCREENSHOT && width === 320) {
      await page.screenshot({ path: process.env.HEADING_LABEL_SCREENSHOT, fullPage: true });
    }
    await page.close();
  }
  console.log("Heading labels: 20 editor and reader combinations, four levels, long press, and saved presentation passed.");
} finally {
  await browser.close();
}

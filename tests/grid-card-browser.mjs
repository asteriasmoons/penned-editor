import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ||
  resolve(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const root = resolve(process.env.PENNED_EDITOR_BUNDLE || "dist");
const pageURL = pathToFileURL(resolve(root, "tiptap.html")).href;
const selectionSource = await readFile(new URL("../../Vellix/Vellix/Editor/MobileBlockSelection.swift", import.meta.url), "utf8");
const selectionScript = selectionSource.match(/static let script = #"""\n([\s\S]*?)\n"""#/)[1].replaceAll("\\#(selectionGutter)", "6");
const paragraph = (id, text) => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
const card = (id, width, title, height, backgroundColor, description) => ({ type: "gridCard",
  attrs: { id, width, title, height, backgroundColor, icon: "sparkle", iconColor: "#451432", alignment: "left" },
  content: [paragraph(`${id}-text`, description)] });
const icon = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="white" d="M12 1L15 9L23 12L15 15L12 23L9 15L1 12L9 9Z"/></svg>').toString("base64")}`;
const first = card("a", "half", "Self-Care", 140, "#f3bfda", "Rest, hydrate, and check in with myself.");
const second = card("b", "half", "Reading", 181, "#b6e2d8", "Finish the next chapter this evening.");
const full = card("c", "full", "Growth", 120, "#b6d2ef", "Small, consistent steps toward my bigger goals.");
const content = [first, second, full, card("d", "half", "One", 118, "#f2dfb4", "A shorter card."),
  card("e", "half", "Two", 128, "#d4c7ea", "A taller card."), card("f", "half", "Three", 120, "#c6e0d6", "An unpaired card."),
  { type: "pageReference", attrs: { id: "p1", documentID: "one" } },
  { type: "pageReference", attrs: { id: "p2", documentID: "two" } },
  paragraph("after", "An ordinary paragraph after the cards."),
  { type: "plainCallout", attrs: { id: "plain", color: "#bf8fff" }, content: [paragraph("plain-body", "An unchanged Callout.")] }];
const bounds = (page, id) => page.locator(`[data-vellix-block-id="${id}"]`).boundingBox();
const close = (a, b) => assert(Math.abs(a - b) <= 1, `${a} should equal ${b}`);

try {
  for (const width of [390, 920]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(selectionScript);
    await page.goto(pageURL);
    await page.evaluate(async ({ content, icon }) => {
      await tiptapCommand("setContent", { document: { type: "doc", content } });
      await tiptapCommand("registerIconAssets", { assets: { sparkle: icon } });
      await tiptapCommand("setPageReferences", { pages: ["one", "two"].map(documentID => ({ documentID, title: documentID, cardImage: icon, cardFullWidth: false })) });
    }, { content, icon });
    await page.waitForFunction(() => document.querySelector('[data-vellix-block-id="p1"]').classList.contains("vellix-page-card-row-start"));
    const [a, b, c, d, e, f, p1, p2, after, plain] = await Promise.all(content.map(node => bounds(page, node.attrs.id)));
    close(a.y, b.y); close(a.width, b.width); close(b.x - a.x - a.width, 12);
    assert(b.height > a.height && c.y >= b.y + b.height);
    close(c.x, a.x); close(c.width, a.width + b.width + 12);
    close(d.y, e.y); close(f.x, a.x); assert(f.y >= Math.max(d.y + d.height, e.y + e.height));
    close(p1.x, a.x); close(p1.y, p2.y); assert(p1.y >= f.y + f.height);
    close(after.width, c.width); close(plain.width, c.width);
    const style = await page.locator('[data-vellix-block-id="a"]').evaluate(element => {
      const icon = element.querySelector(".vellix-callout-icon-image");
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, radius: style.borderRadius,
        bodyColor: getComputedStyle(element.querySelector(".vellix-callout-text p")).color,
        iconTint: getComputedStyle(icon).backgroundColor, iconMask: getComputedStyle(icon).maskImage,
        iconBackground: getComputedStyle(icon.parentElement).backgroundColor,
        iconBottom: icon.getBoundingClientRect().bottom, titleTop: element.querySelector(".penned-grid-card-title").getBoundingClientRect().top };
    });
    assert.equal(style.background, "rgb(243, 191, 218)");
    assert.equal(style.bodyColor, "rgb(0, 0, 0)");
    assert.equal(style.iconTint, "rgb(69, 20, 50)");
    assert.equal(style.iconBackground, "rgba(0, 0, 0, 0)");
    assert(style.iconMask.includes("data:image/svg+xml") && style.titleTop > style.iconBottom);
    assert.equal(style.radius, await page.locator(".vellix-plain-callout").evaluate(element => getComputedStyle(element).borderRadius));
    const units = await page.evaluate(() => PennedBlockSelection.records(document.querySelector(".tiptap-editor").editor.state.doc).map(record => record.node.attrs.id));
    assert(units.includes("a") && !units.includes("a-text"));
    assert.deepEqual(errors, []);
    if (process.env.GRID_CARD_SCREENSHOT && width === 390) await page.screenshot({ path: process.env.GRID_CARD_SCREENSHOT });
    await page.evaluate(async () => {
      const editor = document.querySelector(".tiptap-editor").editor;
      const record = PennedBlockSelection.records(editor.state.doc).find(item => item.node.attrs.id === "a");
      await tiptapCommand("setSelectionMode", { mode: "multi" });
      PennedBlockSelection.selectionFacade().add(record.key);
      await tiptapCommand("deleteSelectedBlocks");
    });
    assert.equal(await page.locator('[data-vellix-block-id="a"]').count(), 0);
    close((await bounds(page, "b")).x, a.x);
    await page.evaluate(() => tiptapCommand("undo"));
    close((await bounds(page, "a")).x, a.x);
    close((await bounds(page, "b")).x, b.x);
    await page.close();
  }

  const preview = await browser.newPage({ viewport: { width: 344, height: 300 } });
  await preview.goto(pageURL);
  const render = (settings, node) => preview.evaluate(({ node, settings, icon }) => pennedGridCardPreview({ node, settings,
    appearance: {}, assets: { sparkle: icon }, width: 344 }), { node, settings, icon });
  assert.equal(await render(first.attrs, first), 140);
  const half = await bounds(preview, "a");
  close(half.width, 166);
  assert.equal(await render({ ...first.attrs, width: "full", height: 205, title: "Live Preview", alignment: "right", iconColor: "#445566" }), 205);
  close((await bounds(preview, "a")).width, 344);
  assert.equal(await preview.locator(".penned-grid-card-title").textContent(), "Live Preview");
  assert.equal(await preview.locator(".vellix-callout-text").textContent(), "Rest, hydrate, and check in with myself.");
  assert.equal(await preview.locator(".tiptap-editor").getAttribute("contenteditable"), "false");
  console.log("Grid Card layout, independent selection units, legacy Callout styling, and live preview passed.");
} finally {
  await browser.close();
}

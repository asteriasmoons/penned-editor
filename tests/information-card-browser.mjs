import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ||
  resolve(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const url = pathToFileURL(resolve(process.env.PENNED_EDITOR_BUNDLE || "dist", "tiptap.html")).href;
const exportSource = await readFile(new URL("../../Vellix/Vellix/Export/DocumentExportScript.swift", import.meta.url), "utf8");
const prepareExport = exportSource.match(/static let prepare = #"""\n([\s\S]*?)\n    """#/)[1];
const text = (type, value) => ({ type, content: [{ type: "text", text: value }] });
const title = "Morning Routine With a Title Long Enough to Wrap on a Phone";
const description = "Start the day with a little structure and time for yourself.";
const bodyText = "Take Medicine";
const document = { type: "doc", content: [
  text("paragraph", "Before the card"),
  { type: "informationCard", attrs: { id: "routine", titleColor: "#39D8C2" }, content: [
    text("informationCardTitle", title),
    text("informationCardDescription", description),
    { type: "informationCardBody", content: [
      { type: "taskList", content: [{ type: "taskItem", content: [text("paragraph", bodyText)] }] },
      { type: "divider", attrs: { id: "routine-divider" } },
    ] },
  ] },
] };
const mask = path => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="white" d="${path}"/></svg>`).toString("base64")}`;
const assets = { chevup: mask("M0 16L12 4L24 16Z"), chevdown: mask("M0 8L12 20L24 8Z") };

try {
  for (const width of [390, 920]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 390 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.messages = [];
      window.webkit = { messageHandlers: { tiptap: { postMessage(message) { window.messages.push(message); } } } };
    });
    await page.goto(url);
    const command = (name, args) => page.evaluate(([name, args]) => window.tiptapCommand(name, args), [name, args]);
    const set = (key, value) => command("informationCardSetAttr", { blockId: "routine", key, value });
    await command("setContent", { document });
    await command("registerIconAssets", { assets });
    const card = page.locator('[data-vellix-block-id="routine"]');
    const button = card.locator(".penned-information-card-disclosure");
    const body = card.locator(".penned-information-card-body");
    const activate = () => width === 390 ? button.tap() : button.click();
    assert.equal(await button.isVisible(), false);
    assert.equal(await body.isVisible(), true);

    assert.equal(await set("collapsible", true), true);
    assert.equal(await button.getAttribute("aria-expanded"), "true");
    const chevron = () => button.evaluate(el => {
      const style = getComputedStyle(el, "::before");
      return { mask: style.maskImage, color: style.backgroundColor };
    });
    assert((await chevron()).mask.includes(assets.chevup));
    assert.equal((await chevron()).color, "rgb(57, 216, 194)");
    const cardBox = await card.boundingBox();
    const buttonBox = await button.boundingBox();
    assert(buttonBox.x > cardBox.x + cardBox.width / 2 && buttonBox.y - cardBox.y < 16);
    assert.equal(await set("titleColor", "#EE7744"), true);
    assert.equal((await chevron()).color, "rgb(238, 119, 68)");

    await body.locator("p").click();
    await activate();
    assert.equal(await button.getAttribute("aria-expanded"), "false");
    assert((await chevron()).mask.includes(assets.chevdown));
    assert.equal(await body.isVisible(), false);
    assert.equal(await card.locator(".penned-information-card-title").textContent(), title);
    assert.equal(await card.locator(".penned-information-card-description").textContent(), description);
    assert((await card.boundingBox()).height < cardBox.height);
    const saved = await page.evaluate(() => window.messages.filter(message => message.kind === "snapshot").at(-1).payload.document);
    assert.equal(saved.content[1].attrs.collapsed, true);
    assert(JSON.stringify(saved.content[1].content).includes(bodyText));
    assert.equal(await page.evaluate(() => window.messages.some(message => message.kind === "informationCardSettings")), false);

    await command("setContent", { document: saved });
    assert.equal(await body.isVisible(), false);
    await activate();
    assert.equal(await body.isVisible(), true);
    assert((await body.textContent()).includes(bodyText));
    await activate();
    // ProseMirror navigation into the body must not strand the caret in hidden content.
    await page.evaluate(() => {
      const editor = window.document.querySelector(".tiptap-editor").editor;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && node.textContent === "Take Medicine") {
          editor.commands.setTextSelection(pos + 1);
          return false;
        }
      });
    });
    assert.equal(await body.isVisible(), true);
    await activate();
    await set("collapsible", false);
    assert.equal(await button.isVisible(), false);
    assert.equal(await body.isVisible(), true);
    await set("collapsible", true);
    assert.equal(await button.getAttribute("aria-expanded"), "true");
    await activate();
    assert.equal(await body.isVisible(), false);
    await page.evaluate(async ({ script, width }) => {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      await new AsyncFunction("options", script)({ width, height: 900, fontScale: 1, textColor: "#fff", fontFamily: "system-ui" });
    }, { script: prepareExport, width });
    const exportBody = page.locator("#export-flow .penned-information-card-body");
    assert.equal(await exportBody.isVisible(), true);
    assert((await exportBody.textContent()).includes(bodyText));
    assert.equal(await page.locator("#export-flow .penned-information-card-disclosure").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("InfoCard disclosure, title tint, saved state, and caret safety passed at phone and tablet widths.");
} finally {
  await browser.close();
}

import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import assert from "node:assert/strict";

const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(process.env.PLAYWRIGHT_MODULE)
  : await import("playwright").catch(() => import(resolve(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")));
const root = fileURLToPath(new URL("../../Vellix/Vellix/VellixEditor.bundle/", import.meta.url)).replace(/\/$/, "");
const output = process.env.PENNED_ATTACHMENT_SCREENSHOTS || "/tmp/penned-attachment-browser";
await mkdir(output, { recursive: true });
const assets = new Map();
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/attachment") {
      const asset = assets.get(url.searchParams.get("path"));
      if (!asset) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "Content-Type": asset.type, "Content-Length": asset.data.length,
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" }); response.end(asset.data); return;
    }
    if (url.pathname.includes("..")) { response.writeHead(403).end(); return; }
    const path = resolve(root, "." + url.pathname);
    if (!path.startsWith(root + "/")) { response.writeHead(403).end(); return; }
    const data = await readFile(path);
    response.writeHead(200, { "Content-Type": ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css" })[extname(path)] || "application/octet-stream" }); response.end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const width of [320, 390, 834]) {
    const page = await browser.newPage({ viewport: { width, height: 1180 }, deviceScaleFactor: 1 });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.events = [];
      window.webkit = { messageHandlers: { tiptap: { postMessage: event => window.events.push(event) } } };
      // Chromium has no WKURLSchemeHandler. Substitute only the native byte transport,
      // leaving the shipping node views, styles, document JSON and interactions intact.
      for (const prototype of [HTMLImageElement.prototype, HTMLMediaElement.prototype]) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "src");
        Object.defineProperty(prototype, "src", { ...descriptor, set(value) {
          descriptor.set.call(this, String(value).startsWith("penned-file:") ? location.origin + "/attachment" + new URL(value).search : value);
        } });
      }
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/tiptap.html`);
    await page.waitForFunction(() => typeof window.tiptapCommand === "function");
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 60;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#ff65aa"; ctx.fillRect(10, 10, 130, 40);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    assets.set("divider.png", { type: "image/png", data: Buffer.from(png, "base64") });
    assets.set("divider.svg", { type: "image/svg+xml", data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="60"><style>.ink{fill:#ff65aa}</style><rect class="ink" x="10" y="10" width="130" height="40"/></svg>') });
    const wav = Buffer.alloc(44 + 16000);
    wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write("data", 36); wav.writeUInt32LE(16000, 40);
    assets.set("audio.wav", { type: "audio/wav", data: wav });
    await page.addStyleTag({ content: "html { background: #2fb0c0 !important; } .tiptap-editor { padding: 18px !important; }" });
    await page.evaluate(async () => {
      const paragraph = text => ({ type: "paragraph", attrs: { id: crypto.randomUUID() }, content: [{ type: "text", text }] });
      const file = { attachmentID: "transparent", relativePath: "divider.png", name: "Divider.png", kind: "image", mimeType: "image/png", width: 600, height: 60, size: 1000 };
      const audio = { attachmentID: "audio", relativePath: "audio.wav", name: "Audio.wav", kind: "audio", mimeType: "audio/wav", size: 16044 };
      const svg = { ...file, attachmentID: "vector", relativePath: "divider.svg", name: "Divider.svg", mimeType: "image/svg+xml" };
      await tiptapCommand("setAttachments", { files: [file, audio, svg] });
      await tiptapCommand("setContent", { document: { type: "doc", content: [paragraph("Transparent divider, directly between two paragraphs."),
        { type: "attachment", attrs: { id: "divider", file } }, paragraph("The existing document background remains visible through the image."),
        { type: "attachment", attrs: { id: "svg", file: svg } },
        { type: "attachment", attrs: { id: "audio", file: audio } }, paragraph("Continue typing here.")] } });
      await tiptapCommand("setAppearance", { textColor: "#111111" });
      await Promise.all([...document.images].map(image => image.decode()));
      await tiptapCommand("setEditable", { editable: false });
    });
    const bounds = await page.locator('[data-vellix-block-id="divider"] img').boundingBox();
    assert(bounds.width > 100 && bounds.width <= width);
    assert(Math.abs(bounds.width / bounds.height - 10) < 0.05);
    const screenshot = await page.screenshot({ path: resolve(output, `transparent-${width}.png`) });
    const pixel = await page.evaluate(async ({ image, x, y }) => {
      const bitmap = await createImageBitmap(await (await fetch("data:image/png;base64," + image)).blob());
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d"); ctx.drawImage(bitmap, 0, 0);
      return [...ctx.getImageData(x, y, 1, 1).data];
    }, { image: screenshot.toString("base64"), x: Math.floor(bounds.x + bounds.width * 0.9), y: Math.floor(bounds.y + bounds.height * 0.5) });
    assert.deepEqual(pixel, [47, 176, 192, 255], "Transparent PNG pixels must expose the actual document background");
    const result = await page.evaluate(async () => {
      const editor = document.querySelector(".tiptap-editor").editor;
      await tiptapCommand("setEditable", { editable: true });
      await tiptapCommand("attachmentUpdate", { blockID: "divider", mode: "inline", width: 50, alignment: "right" });
      const host = document.querySelector('[data-vellix-block-id="divider"]'), container = editor.view.dom.getBoundingClientRect();
      const box = host.getBoundingClientRect(), halfWidth = Math.abs(box.width - (container.width - 36) * 0.5) < 2;
      const saved = await tiptapCommand("getDocument");
      await tiptapCommand("setContent", { document: saved });
      const reopened = await tiptapCommand("getDocument");
      await tiptapCommand("attachmentUpdate", { blockID: "divider", mode: "card", width: null, alignment: "left" });
      const card = !!document.querySelector('[data-vellix-block-id="divider"] .penned-file-card');
      await tiptapCommand("attachmentUpdate", { blockID: "divider", mode: "fullWidth", alignment: "center" });
      await Promise.all([...document.images].map(image => image.decode()));
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      const token = await tiptapCommand("attachmentCaptureInsertion");
      const inserted = await tiptapCommand("attachmentInsert", { token, file: saved.content.find(node => node.type === "attachment").attrs.file });
      const audio = document.querySelector("audio"); await audio.play();
      const playing = !audio.paused;
      await tiptapCommand("attachmentPauseAll");
      return { halfWidth, rightAligned: Math.abs(box.right - (container.right - 18)) < 2, saved, reopened, card, inserted,
        collapsed: getSelection().isCollapsed, selected: document.querySelectorAll(".penned-attachment.ProseMirror-selectednode").length,
        overflow: document.documentElement.scrollWidth > innerWidth, playing, stopped: audio.paused,
        svg: document.querySelector('[data-vellix-block-id="svg"] img').naturalWidth === 600 };
    });
    assert(result.halfWidth && result.rightAligned && result.card && result.inserted && result.collapsed && result.selected === 0 && !result.overflow && result.playing && result.stopped && result.svg);
    assert.deepEqual(result.reopened, result.saved); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ width, alphaBackgroundPixel: pixel, svg: "rendered", modes: "inline/card/fullWidth", sizing: "50% right-aligned", audioPlaybackAndPause: "passed", reopen: "passed", insertion: "collapsed text caret", overflow: false }));
    await page.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { homedir } from "node:os";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ||
  resolve(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"));
const root = resolve(process.env.PENNED_EDITOR_BUNDLE || "../Vellix/Vellix/VellixEditor.bundle");
const native = async name => {
  const source = await readFile(name === "MobileBlockSelection" && process.env.PENNED_NATIVE_SELECTION ||
    new URL(`../../Vellix/Vellix/Editor/${name}.swift`, import.meta.url), "utf8");
  const match = source.match(/static let script = #"""\n([\s\S]*?)\n"""#/);
  assert(match, name);
  return match[1].replaceAll("\\#(selectionGutter)", "6");
};
const server = createServer(async (request, response) => {
  try {
    const path = resolve(root, "." + new URL(request.url, "http://localhost").pathname);
    if (!path.startsWith(root + "/")) return response.writeHead(403).end();
    const data = await readFile(process.env.PENNED_PROFILE_BUNDLE && path.endsWith("/tiptap.bundle.js") ? process.env.PENNED_PROFILE_BUNDLE : path);
    response.writeHead(200, { "Content-Type": ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css" })[extname(path)] || "application/octet-stream" });
    response.end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const tables of [false, true]) for (const paragraphs of [80, 1200]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.events = [];
      window.webkit = { messageHandlers: { tiptap: { postMessage: event => window.events.push(event) } } };
    });
    await page.addInitScript(await native("MobileBlockSelection"));
    await page.goto(`http://127.0.0.1:${server.address().port}/tiptap.html`);
    await page.waitForFunction(() => !!document.querySelector(".tiptap-editor")?.editor);
    for (const name of ["MobileEditorInteractions", "TextBlockConversion"]) await page.evaluate(await native(name));
    await page.evaluate(async ({ count, tables }) => {
      const p = (id, text) => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
      const content = [];
      for (let i = 0; i < count; i++) {
        content.push(p(`p-${i}`, "A long document keeps its formatting, editable text and stable caret as more content is added."));
        if (tables && i % 100 === 0) content.push({ type: "table", attrs: { id: `table-${i}`, name: `Table${i}` },
          content: Array.from({ length: 6 }, (_, r) => ({ type: "tableRow", attrs: { id: `row-${i}-${r}` },
            content: Array.from({ length: 4 }, (_, c) => ({ type: "tableCell", attrs: { id: `cell-${i}-${r}-${c}`, colwidth: [80] },
              content: [p(`cell-p-${i}-${r}-${c}`, `${r + c}`)] })) })) });
      }
      await tiptapCommand("setContent", { document: { type: "doc", content } });
      const editor = document.querySelector(".tiptap-editor").editor;
      let at;
      editor.state.doc.descendants((node, pos) => { if (node.attrs.id === `p-${Math.floor(count / 2)}`) at = pos + 5; });
      editor.commands.setTextSelection(at); editor.view.focus();
      editor.view.nodeDOM(at - 5).scrollIntoView({ block: "center" });
    }, { count: paragraphs, tables });
    await page.waitForTimeout(800);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    if (process.env.PENNED_PROFILE_BUNDLE) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
    const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
    const before = await metrics();
    const result = await page.evaluate(async () => {
      const editor = document.querySelector(".tiptap-editor").editor, root = editor.view.dom;
      let rootMutations = 0, handleMutations = 0, idleArmingWrites = 0;
      const rootAttributes = {};
      const remove = DOMTokenList.prototype.remove;
      DOMTokenList.prototype.remove = function (...tokens) {
        if (this === root.classList && tokens.includes("penned-block-selection-arming")) idleArmingWrites++;
        return remove.apply(this, tokens);
      };
      const observer = new MutationObserver(records => {
        rootMutations += records.filter(m => m.target === root && ["class", "style"].includes(m.attributeName)).length;
        for (const m of records) if (m.target === root && m.type === "attributes") rootAttributes[m.attributeName] = (rootAttributes[m.attributeName] || 0) + 1;
        handleMutations += records.filter(m => m.type === "childList" && m.target.classList?.contains("vellix-table-resizers")).length;
      });
      observer.observe(root, { attributes: true, childList: true, subtree: true });
      const frames = () => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      const times = [], inputWork = [];
      for (let i = 0; i < 12; i++) {
        const start = performance.now();
        if (!document.execCommand("insertText", false, "x")) throw new Error("Native DOM input failed");
        // Measure the same DOM-observer flush synchronously, excluding RAF idle time.
        editor.view.domObserver.flush();
        inputWork.push(performance.now() - start);
        await frames(); times.push(performance.now() - start);
      }
      if (!editor.state.selection.$from.parent.textContent.includes("xxxxxxxxxxxx")) throw new Error("DOM input was not persisted");
      const saved = await tiptapCommand("getDocument");
      // Keep block insertion in a separate group from the preceding keystrokes.
      await new Promise(done => setTimeout(done, 600));
      const beforeInsert = performance.now();
      await tiptapCommand("insertBlock", { key: "plainCallout" });
      await frames();
      const insertionMS = performance.now() - beforeInsert;
      await tiptapCommand("undo");
      await frames();
      const restored = await tiptapCommand("getDocument");
      if (JSON.stringify(saved) !== JSON.stringify(restored)) throw new Error("Block insertion undo changed the document");
      observer.disconnect();
      DOMTokenList.prototype.remove = remove;
      const plugin = editor.state.plugins.find(p => p.key.startsWith("pennedBlockSelection$"));
      const idleDecorations = plugin.props.decorations(editor.state).find().length;
      return { height: root.getBoundingClientRect().height, idleDecorations, idleArmingWrites, rootMutations, rootAttributes, handleMutations, insertionMS,
        medianInputWorkMS: inputWork.sort((a, b) => a - b)[Math.floor(inputWork.length / 2)], maxInputWorkMS: Math.max(...inputWork),
        medianInputMS: times.sort((a, b) => a - b)[Math.floor(times.length / 2)], maxInputMS: Math.max(...times) };
    });
    const after = await metrics();
    if (process.env.PENNED_PROFILE_BUNDLE) {
      const { profile } = await cdp.send("Profiler.stop"), weights = new Map();
      profile.samples.forEach((id, i) => weights.set(id, (weights.get(id) || 0) + profile.timeDeltas[i]));
      console.log(JSON.stringify({ profile: profile.nodes.map(n => ({ name: n.callFrame.functionName, line: n.callFrame.lineNumber + 1, ms: (weights.get(n.id) || 0) / 1000 }))
        .filter(n => n.ms > 0).sort((a, b) => b.ms - a.ms).slice(0, 25) }));
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ paragraphs, tables, ...result, layoutCount: after.LayoutCount - before.LayoutCount,
      layoutMS: (after.LayoutDuration - before.LayoutDuration) * 1000,
      styleCount: after.RecalcStyleCount - before.RecalcStyleCount,
      styleMS: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000 }));
    if (process.env.PENNED_ASSERT_IDLE_WRITES === "1") {
      assert.equal(result.idleArmingWrites, 0, "Idle editing must not rewrite the selection arming class");
      assert.equal(result.idleDecorations, 0, "Idle editing must not decorate every block");
    }
    await page.close();
  }
} finally { await browser.close(); await new Promise(done => server.close(done)); }

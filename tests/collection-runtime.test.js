import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";

async function runtime(content = [{ type: "paragraph" }]) {
  const events = [];
  const dom = new JSDOM("<!doctype html><html><body><main class='vellix-editor-page'><div id='editor'></div></main></body></html>",
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://penned.test" });
  const { window } = dom;
  window.console.log = window.console.info = () => {};
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.webkit = { messageHandlers: { tiptap: { postMessage(message) { events.push(message); } } } };
  window.crypto.randomUUID = randomUUID;
  window.scrollBy = () => {};
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 24, right: 100 });
  for (const file of ["vendor/formula-parser.min.js", "table-formulas.js", "vellix-tables.js", "vendor/table-library.js", "tiptap.bundle.js"])
    window.eval(await readFile(new URL("../dist/" + file, import.meta.url), "utf8"));
  const command = (name, args = {}) => window.tiptapCommand(name, args);
  await command("setContent", { document: { type: "doc", content } });
  return { window, events, command, json: async () => JSON.parse(JSON.stringify(await command("getDocument"))),
    query: selector => window.document.querySelector(selector), close: () => window.close() };
}

const block = { type: "collection", attrs: { id: "collection-block", collectionID: "collection", documentID: "container" } };
const payload = (kind = "gallery", count = 4) => ({
  id: "collection", documentID: "container", name: "Small Favors", viewID: "main", viewName: "Main", kind,
  totalCount: count, galleryColumns: 2, showsCover: true,
  fields: [{ id: "priority", name: "Priority", kind: "select", icon: "listcircle" }],
  views: [{ id: "main", name: "Main", kind }],
  entries: Array.from({ length: count }, (_, i) => ({ id: `entry-${i}`, title: ["Water Prep", "Hygiene Check", "Daily Note", "Dog Care"][i % 4],
    cover: `penned-cover://image?path=cover-${i}.jpg`, values: { priority: { text: "High", empty: false, chips: [{ name: "High", color: "#714fab" }] } } }))
});

test("Kanban reserves a native host at the collection position without an HTML board or document changes", async () => {
  const h = await runtime([{ type: "paragraph", content: [{ type: "text", text: "Before" }] }, block,
    { type: "paragraph", content: [{ type: "text", text: "After" }] }]);
  try {
    const before = await h.json();
    await h.command("setCollections", { collections: [{ ...payload("kanban"), nativeHeight: 560 }] });
    const host = h.query("[data-native-collection]");
    assert.equal(host.dataset.nativeCollection, "collection");
    assert.equal(host.dataset.nativeCollectionBlock, "collection-block");
    assert.equal(host.style.height, "560px");
    assert.equal(host.children.length, 0, "only SwiftUI renders and handles board cards");
    assert.equal(await h.command("setNativeCollectionHeight", { blockID: "collection-block", viewID: "main", height: 180 }), true);
    assert.equal(host.style.height, "180px", "short native boards shrink to their measured content");
    assert.equal(await h.command("setNativeCollectionHeight", { blockID: "collection-block", viewID: "stale", height: 180 }), false);
    assert.equal(await h.command("setNativeCollectionHeight", { blockID: "collection-block", viewID: "main", height: 900 }), false);
    await h.command("setCollections", { collections: [{ ...payload("kanban"), viewName: "Renamed" }] });
    assert.equal(host.style.height, "180px", "metadata changes keep the measured native height");
    assert.deepEqual((await h.json()).content, before.content);
    await h.command("setCollections", { collections: [payload("table")] });
    assert.equal(h.query("[data-native-collection]"), null);
    assert.equal(h.query(".penned-collection").style.height, "");
    assert.equal(h.window.document.querySelectorAll(".penned-collection-row").length, 5);
    await h.command("setCollections", { collections: [payload("gallery")] });
    assert.equal(h.window.document.querySelectorAll(".penned-collection-card").length, 4);
  } finally { h.close(); }
});

test("multiple native Kanban hosts report separate bounds and clear when removed", async () => {
  const second = { type: "collection", attrs: { id: "second-block", collectionID: "second", documentID: "container" } };
  const h = await runtime([block, { type: "paragraph" }, second]);
  try {
    await h.command("setCollections", { collections: [payload("kanban"), { ...payload("kanban"), id: "second" }] });
    const hosts = [...h.window.document.querySelectorAll("[data-native-collection]")];
    const root = h.query(".vellix-editor-page");
    root.getBoundingClientRect = () => ({ top: 0, left: 0 });
    for (let i = 0; i < hosts.length; i++) {
      hosts[i].getClientRects = () => [{}];
      hosts[i].getBoundingClientRect = () => ({ top: 20 + i * 600, left: 0, width: 360, height: 560 });
    }
    // An unchanged payload still requests the layout report.
    await h.command("setCollections", { collections: [payload("kanban"), { ...payload("kanban"), id: "second" }] });
    await new Promise(resolve => h.window.requestAnimationFrame(() => h.window.requestAnimationFrame(resolve)));
    const regions = JSON.parse(JSON.stringify(h.events.findLast(event => event.kind === "nativeCollections").payload.regions));
    assert.deepEqual(regions.map(r => [r.blockID, r.collectionID, r.y, r.height]), [["collection-block", "collection", 20, 560], ["second-block", "second", 620, 560]]);
    await h.command("setContent", { document: { type: "doc", content: [{ type: "paragraph" }] } });
    await new Promise(resolve => h.window.requestAnimationFrame(() => h.window.requestAnimationFrame(resolve)));
    assert.equal(h.events.findLast(event => event.kind === "nativeCollections").payload.regions.length, 0);
  } finally { h.close(); }
});

test("collection insertion creates a resolvable block at the real editor position and cancellation removes it", async () => {
  const h = await runtime();
  try {
    assert(await h.command("insertBlock", { blockType: "collection" }));
    const request = h.events.findLast(event => event.kind === "collectionRequest").payload;
    assert.equal(request.action, "create");
    assert(await h.command("resolveCollection", { blockID: request.blockID, collectionID: "collection", documentID: "container" }));
    const saved = await h.json();
    assert.equal(saved.content.filter(node => node.type === "collection").length, 1);
    assert.equal(saved.content.find(node => node.type === "collection").attrs.collectionID, "collection");
    assert.equal(await h.command("resolveCollection", { blockID: request.blockID, collectionID: "" }), false, "a canceled request must not delete an already-created collection");
    await h.command("setContent", { document: saved });
    assert.deepEqual((await h.json()).content, saved.content);
    await h.command("insertBlock", { blockType: "collection" });
    const canceled = h.events.findLast(event => event.kind === "collectionRequest").payload;
    assert(await h.command("resolveCollection", { blockID: canceled.blockID, collectionID: "" }));
    assert.equal((await h.json()).content.filter(node => node.type === "collection").length, 1);
  } finally { h.close(); }
});

test("view presentation changes never alter surrounding rich text or duplicate document content", async () => {
  const h = await runtime([{ type: "paragraph", content: [{ type: "text", text: "Before", marks: [{ type: "bold" }] }] }, block,
    { type: "heading", attrs: { level: 5 }, content: [{ type: "text", text: "After" }] }]);
  try {
    const before = await h.json();
    await h.command("setCollections", { collections: [payload()] });
    assert.equal(h.query(".penned-collection-name").textContent, "Small Favors", "collection titles never include entry counts");
    assert.equal(h.window.document.querySelectorAll(".penned-collection-card").length, 4);
    assert.equal(h.query(".penned-collection-cover img").getAttribute("src"), "penned-cover://image?path=cover-0.jpg");
    await h.command("setCollections", { collections: [payload("table")] });
    assert.equal(h.query(".penned-collection-name").textContent, "Small Favors");
    assert.equal(h.window.document.querySelectorAll(".penned-collection-row").length, 5);
    assert.equal(h.query(".penned-collection table"), null, "collections must not use the resizable rich-text table engine");
    assert.deepEqual((await h.json()).content, before.content);
  } finally { h.close(); }
});

test("presentation preparation supplies collection data before the first visible frame without changing document content", async () => {
  const h = await runtime([block]);
  try {
    const before = await h.json();
    const ready = await h.command("preparePresentation", { collections: [payload("gallery")], pages: [] });
    assert.equal(h.query(".penned-collection-name").textContent, "Small Favors");
    assert(!h.query(".penned-collection").textContent.includes("unavailable"));
    assert.equal(ready.nativeViews.length, 0);
    const board = await h.command("preparePresentation", { collections: [payload("kanban")], pages: [] });
    assert.deepEqual(JSON.parse(JSON.stringify(board.nativeViews)), [{ blockID: "collection-block", viewID: "main" }]);
    assert.deepEqual((await h.json()).content, before.content);
  } finally { h.close(); }
});

test("entry titles, cells, schema headers, view menu and new-entry controls send the correct native request", async () => {
  const h = await runtime([block]);
  try {
    await h.command("setCollections", { collections: [payload("table")] });
    for (const [selector, action, key, value] of [
      [".penned-collection-table-title", "openEntry", "documentID", "entry-0"],
      [".penned-collection-value", "value", "fieldID", "priority"],
      [".penned-collection-heading button", "field", "fieldID", "priority"],
      [".penned-collection-selector", "menu", "viewID", "main"],
      [".penned-collection-footer button", "addEntry", "collectionID", "collection"],
      [".penned-collection-name", "configure", "collectionID", "collection"],
    ]) {
      h.query(selector).click();
      const event = h.events.findLast(event => event.kind === "collectionRequest").payload;
      assert.equal(event.action, action); assert.equal(event[key], value); assert.equal(event.blockID, "collection-block");
    }
    await h.command("setEditable", { editable: false });
    const count = h.events.filter(event => event.kind === "collectionRequest").length;
    h.query(".penned-collection-value").click();
    assert.equal(h.events.filter(event => event.kind === "collectionRequest").length, count);
  } finally { h.close(); }
});

test("chosen SF Symbols use registered icon assets without invalid CSS variable names", async () => {
  const h = await runtime([block]);
  try {
    const data = payload("table"); data.fields[0].icon = "sf:flag.fill";
    const src = "data:image/png;base64,dGVzdA==";
    await h.command("registerIconAssets", { assets: { "sf:flag.fill": src } });
    await h.command("setCollections", { collections: [data] });
    assert.equal(h.window.document.documentElement.style.getPropertyValue("--vellix-asset-sf_3a_flag_2e_fill"), `url("${src}")`);
    assert.match(h.query(".penned-collection-heading .penned-collection-icon").style.maskImage, /--vellix-asset-sf_3a_flag_2e_fill/);
  } finally { h.close(); }
});

test("gallery cards and add entry stay inside an unframed scroll region and retain its position after edits", async () => {
  const h = await runtime([block]);
  try {
    const data = payload("gallery", 30);
    await h.command("setCollections", { collections: [data] });
    const region = h.query(".penned-collection-gallery-scroll");
    assert.equal(region.getAttribute("role"), "region");
    assert.equal(region.querySelectorAll(".penned-collection-card").length, 30);
    assert(region.querySelector(".penned-collection-footer"));
    assert(!region.querySelector(".penned-collection-header"));
    region.scrollTop = 120;
    data.entries[0].title = "Edited";
    await h.command("setCollections", { collections: [data] });
    assert.equal(h.query(".penned-collection-gallery-scroll").scrollTop, 120);
    h.query(".penned-collection-footer button").click();
    assert.equal(h.events.findLast(e => e.kind === "collectionRequest").payload.action, "addEntry");
  } finally { h.close(); }
});

test("shared property updates, filtering, cover replacement and empty states update live without modifying the block", async () => {
  const h = await runtime([block]);
  try {
    const before = await h.json(), data = payload();
    await h.command("setCollections", { collections: [data] });
    data.entries[0].title = "Updated Page";
    data.entries[0].cover = "penned-cover://image?path=replaced.jpg";
    data.entries[0].values.priority.chips[0] = { name: "Medium", color: "#ff499e" };
    await h.command("setCollections", { collections: [data] });
    assert.equal(h.query(".penned-collection-card-title").textContent, "Updated Page");
    assert.equal(h.query(".penned-collection-cover img").getAttribute("src"), data.entries[0].cover);
    assert.equal(h.query(".penned-collection-chip").textContent, "Medium");
    data.entries = [];
    await h.command("setCollections", { collections: [data] });
    assert.equal(h.query(".penned-collection-empty").textContent, "No matching entries");
    data.totalCount = 0;
    await h.command("setCollections", { collections: [data] });
    assert.equal(h.query(".penned-collection-empty").textContent, "No entries yet");
    assert.deepEqual((await h.json()).content, before.content);
  } finally { h.close(); }
});

test("large views grow in working batches and multiple collections retain separate identities", async () => {
  const second = { ...block, attrs: { id: "second-block", collectionID: "second", documentID: "second-container" } };
  const h = await runtime([block, second]);
  try {
    const data = payload("table", 240), other = { ...payload(), id: "second", documentID: "second-container", name: "Other" };
    await h.command("setCollections", { collections: [data, other] });
    assert.equal(h.window.document.querySelectorAll(".penned-collection-table-title").length, 100);
    h.window.document.querySelectorAll(".penned-collection-footer button")[1].click();
    assert.equal(h.window.document.querySelectorAll(".penned-collection-table-title").length, 200);
    assert.equal(h.window.document.querySelectorAll(".penned-collection-card").length, 4);
    h.window.document.querySelectorAll(".penned-collection-footer button")[1].click();
    assert.equal(h.window.document.querySelectorAll(".penned-collection-table-title").length, 240);
    assert.equal((await h.json()).content.filter(node => node.type === "collection").length, 2);
  } finally { h.close(); }
});

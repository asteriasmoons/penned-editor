import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";

const paragraph = (text, id = randomUUID()) => ({ type: "paragraph", attrs: { id },
  content: text ? [{ type: "text", text, marks: [{ type: "bold" }] }] : [] });
const table = () => ({ type: "table", attrs: { tableId: "table" }, content: [{ type: "tableRow", content: [
  { type: "tableCell", content: [paragraph("Do not remove this table", "cell")] },
] }] });
const collection = () => ({ type: "collection", attrs: { id: "collection", collectionID: "tasks", documentID: "owner" } });

async function runtime(content, assets = []) {
  const events = [];
  const dom = new JSDOM("<!doctype html><html><body><div id='editor'></div></body></html>",
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://penned.test" });
  const { window } = dom;
  window.console.log = window.console.info = () => {};
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLMediaElement.prototype.pause = window.HTMLMediaElement.prototype.load = () => {};
  window.webkit = { messageHandlers: { tiptap: { postMessage(message) { events.push(JSON.parse(JSON.stringify(message))); } } } };
  window.crypto.randomUUID = randomUUID;
  window.scrollBy = () => {};
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  // Advance only long-press timers deterministically; editor save/layout timers
  // keep their normal behavior.
  const holds = new Map();
  const setTimeout = window.setTimeout.bind(window), clearTimeout = window.clearTimeout.bind(window);
  let nextTimer = -1;
  window.setTimeout = (callback, delay, ...args) => {
    if (delay !== 400 && delay !== 500 && delay !== 550) return setTimeout(callback, delay, ...args);
    const id = nextTimer--;
    holds.set(id, callback);
    return id;
  };
  window.clearTimeout = id => { holds.delete(id); clearTimeout(id); };
  for (const file of ["vendor/formula-parser.min.js", "table-formulas.js", "vellix-tables.js", "vendor/table-library.js", "tiptap.bundle.js"]) {
    window.eval(await readFile(new URL("../dist/" + file, import.meta.url), "utf8"));
  }
  const command = (name, args = {}) => window.tiptapCommand(name, args);
  await command("setAttachments", { files: assets });
  await command("setContent", { document: { type: "doc", content } });
  const element = selector => {
    const result = window.document.querySelector(selector);
    assert(result, `Missing block: ${selector}`);
    return result;
  };
  const pointer = (selector, type, values = {}) => {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20, ...values });
    for (const [key, value] of Object.entries({ pointerId: 1, isPrimary: true, pointerType: "touch", ...values })) {
      Object.defineProperty(event, key, { value });
    }
    element(selector).dispatchEvent(event);
  };
  const fire = () => { for (const [id, callback] of [...holds]) { holds.delete(id); callback(); } };
  return { window, events, command, element, pointer, fire,
    hold(selector) { pointer(selector, "pointerdown"); fire(); pointer(selector, "pointerup"); },
    requests: () => events.filter(event => event.kind === "blockActionsRequest"),
    json: async () => JSON.parse(JSON.stringify(await command("getDocument"))), close: () => window.close() };
}

test("files keep their file-specific context menu without arming generic block removal", async () => {
  const file = { attachmentID: "asset", relativePath: "divider.png", name: "Divider.png", kind: "image", mimeType: "image/png", size: 32 };
  const h = await runtime([{ type: "attachment", attrs: { id: "file", file } }, paragraph("Keep", "keep")]);
  try {
    await h.command("setAttachments", { files: [file] });
    h.hold(".penned-attachment");
    assert.equal(h.requests().length, 0);
    assert.equal(h.events.filter(event => event.kind === "attachmentActions").length, 1);
    h.element(".penned-attachment").dispatchEvent(new h.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    assert(h.events.some(event => event.kind === "attachmentActions"));
    assert.equal(h.requests().length, 0);
    assert.equal(h.events.filter(event => event.kind === "attachmentActions").length, 1, "Native contextmenu must not duplicate the hold menu");
  } finally { h.close(); }
});

for (const [kind, name, mimeType, target, mode] of [
  ["image", "photo.png", "image/png", "img"],
  ["image", "photo.jpg", "image/jpeg", "img"],
  ["image", "photo.jpeg", "image/jpeg", "img"],
  ["image", "divider.svg", "image/svg+xml", "img"],
  ["image", "photo.webp", "image/webp", "img"],
  ["image", "photo.heic", "image/heic", "img"],
  ["image", "animated.gif", "image/gif", "img"],
  ["pdf", "document.pdf", "application/pdf", "img"],
  ["pdf", "document.pdf", "application/pdf", ".penned-file-card"],
  ["video", "movie.mp4", "video/mp4", "video"],
  ["video", "movie.mov", "video/quicktime", ".penned-video-play"],
  ["video", "movie.webm", "video/webm", ".penned-video-poster"],
  ["audio", "song.mp3", "audio/mpeg", ".penned-audio-play"],
  ["audio", "song.m4a", "audio/mp4", ".penned-audio-volume"],
  ["audio", "song.wav", "audio/wav", ".penned-audio-more"],
  ["file", "archive.zip", "application/zip", ".penned-file-card strong"],
  ["file", "notes.txt", "text/plain", ".penned-file-card"],
  ["file", "document.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".penned-file-card"],
  ["image", "photo.png", "image/png", ".penned-file-card", "card"],
  ["video", "movie.mp4", "video/mp4", ".penned-file-card", "card"],
  ["audio", "song.mp3", "audio/mpeg", ".penned-file-card", "card"],
]) test(`holding ${name} ${target} ${mode || "default"} opens Delete without a contextmenu event and removes only that file block`, async () => {
  const file = { attachmentID: "asset", relativePath: name, name, kind, mimeType, size: 32, previewPath: "poster.png" };
  const h = await runtime([
    { type: "attachment", attrs: { id: "held", file, ...(mode ? { displayMode: mode } : {}) } },
    { type: "attachment", attrs: { id: "keep", file, displayMode: "card" } }, paragraph("Keep this text", "text")
  ], [file]);
  try {
    let played = 0;
    h.window.document.querySelectorAll("video,audio").forEach(player => { player.play = async () => { played++; }; });
    const before = await h.json(), selector = `[data-vellix-block-id="held"] ${target}`;
    h.hold(selector);
    const actions = h.events.filter(event => event.kind === "attachmentActions");
    assert.equal(actions.length, 1); assert.equal(actions[0].payload.blockID, "held");
    assert.equal(actions[0].payload.relativePath, name); assert.equal(h.requests().length, 0);
    h.element(selector).dispatchEvent(new h.window.Event("touchend", { bubbles: true, cancelable: true }));
    h.element(selector).click();
    assert.equal(played, 0, "Release after a hold must not start playback");
    assert(!h.events.some(event => event.kind === "attachmentMenu"));
    assert.deepEqual(await h.json(), before, "Opening the menu must not delete immediately");
    assert.equal(await h.command("attachmentDelete", { blockID: actions[0].payload.blockID }), true);
    const after = await h.json();
    assert.deepEqual(after.content.filter(node => node.type === "attachment").map(node => node.attrs.id), ["keep"]);
    assert(h.events.some(event => event.kind === "snapshot"));
    await h.command("undo"); assert.deepEqual(await h.json(), before);
    await h.command("redo"); assert.deepEqual(await h.json(), after);
  } finally { h.close(); }
});

test("file holds cancel during movement, scrolling, multitouch, cancellation, edits and page changes", async () => {
  const file = { attachmentID: "asset", relativePath: "movie.mp4", name: "movie.mp4", kind: "video", mimeType: "video/mp4", size: 32 };
  const content = [{ type: "attachment", attrs: { id: "video", file } }, paragraph("Text", "text")];
  const h = await runtime(content, [file]);
  try {
    const target = ".penned-video-play";
    for (const cancel of [
      () => h.pointer(target, "pointermove", { clientX: 40 }),
      () => h.window.document.dispatchEvent(new h.window.Event("scroll")),
      () => h.pointer(target, "pointercancel"),
      () => h.pointer(target, "pointerdown", { pointerId: 2, isPrimary: false }),
      () => h.window.dispatchEvent(new h.window.Event("blur")),
    ]) {
      h.pointer(target, "pointerdown"); cancel(); h.fire();
      h.pointer(target, "pointerup"); h.pointer(target, "pointerup", { pointerId: 2 });
    }
    assert(!h.events.some(event => event.kind === "attachmentActions"));
    h.pointer(target, "pointerdown");
    await h.command("setContent", { document: { type: "doc", content: [paragraph("Another page")] } });
    h.fire(); assert(!h.events.some(event => event.kind === "attachmentActions"));
    await h.command("setContent", { document: { type: "doc", content } });
    h.pointer(target, "pointerdown"); await h.command("setSelectionMode", { mode: "multi" }); h.fire();
    assert(!h.events.some(event => event.kind === "attachmentActions"));
  } finally { h.close(); }
});

test("touch-only file holds work without PointerEvent support and do not operate audio controls on release", async () => {
  const file = { attachmentID: "asset", relativePath: "song.mp3", name: "song.mp3", kind: "audio", mimeType: "audio/mpeg", size: 32 };
  const h = await runtime([{ type: "attachment", attrs: { id: "audio", file } }], [file]);
  try {
    let played = 0; h.window.document.querySelector("audio").play = async () => { played++; };
    const target = h.element(".penned-audio-play");
    const touch = (type, touches) => {
      const event = new h.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: touches }); target.dispatchEvent(event);
    };
    touch("touchstart", [{ clientX: 20, clientY: 20 }]); h.fire(); touch("touchend", []); target.click();
    assert.equal(h.events.filter(event => event.kind === "attachmentActions").length, 1); assert.equal(played, 0);
    assert.equal(await h.command("attachmentDelete", { blockID: "audio" }), true);
  } finally { h.close(); }
});

test("file holds preserve subsequent block gestures and do not arm while scrubbing audio", async () => {
  const file = { attachmentID: "asset", relativePath: "song.mp3", name: "song.mp3", kind: "audio", mimeType: "audio/mpeg", size: 32 };
  const h = await runtime([{ type: "attachment", attrs: { id: "audio", file } }, paragraph("Text", "text")], [file]);
  try {
    h.hold(".penned-audio-pill input");
    assert(!h.events.some(event => event.kind === "attachmentActions"));
    h.hold(".penned-audio-play");
    assert.equal(h.events.filter(event => event.kind === "attachmentActions").length, 1);
    h.pointer('[data-vellix-block-id="text"]', "pointerdown", { pointerId: 2 }); h.fire();
    h.pointer('[data-vellix-block-id="text"]', "pointerup", { pointerId: 2 });
    assert.equal(h.requests().length, 1, "Releasing a file hold must not strand other gesture recognizers");
  } finally { h.close(); }
});

test("holding a block offers removal without deleting until confirmed, saves immediately and supports undo/redo", async () => {
  const h = await runtime([paragraph("Keep my formatting", "keep"), { type: "heading", attrs: { id: "heading", level: 2 },
    content: [{ type: "text", text: "Remove this heading" }] }]);
  try {
    const before = await h.json();
    h.hold('[data-vellix-block-id="heading"]');
    const token = h.requests().at(-1)?.payload.token;
    assert(token);
    assert.deepEqual(await h.json(), before);
    assert.equal(await h.command("deleteBlock", { token: "wrong" }), false);
    assert.equal(await h.command("deleteBlock", { token }), true);
    const after = await h.json();
    assert.equal(after.content.length, 1);
    assert.deepEqual(after.content[0], before.content[0]);
    assert.deepEqual(h.events.filter(event => event.kind === "snapshot").at(-1).payload.document.content, after.content);
    await h.command("undo");
    assert.deepEqual(await h.json(), before);
    await h.command("redo");
    assert.deepEqual(await h.json(), after);
    assert.equal(await h.command("deleteBlock", { token }), false);
    await h.command("setContent", { document: after });
    assert.deepEqual(await h.json(), after);
  } finally { h.close(); }
});

for (const type of ["callout", "plainCallout", "blockquote", "toggleItem"]) {
  test(`holding ${type} removes the entire container, not just its text`, async () => {
    const h = await runtime([{ type, attrs: { id: "container", icon: "sparkle", color: "#FF5EAB", open: true },
      content: [paragraph("Inside the block", "inside")] }, paragraph("Keep", "keep")]);
    try {
      h.hold('[data-vellix-block-id="inside"]');
      assert.equal(h.requests().length, 1);
      await h.command("deleteBlock", h.requests()[0].payload);
      assert.deepEqual((await h.json()).content.map(node => node.attrs.id), ["keep"]);
    } finally { h.close(); }
  });
}

test("inline property, divider and page-break blocks can be removed", async () => {
  const h = await runtime([{ type: "inlineProperty", attrs: { id: "property", property: { kind: "text", name: "Status", value: "Ready" } } },
    { type: "divider", attrs: { id: "divider" } }, { type: "pageBreak", attrs: { id: "break" } }, paragraph("Keep", "keep")]);
  try {
    for (const id of ["property", "divider", "break"]) {
      h.hold(`[data-vellix-block-id="${id}"]`);
      assert.equal(await h.command("deleteBlock", h.requests().at(-1).payload), true);
      assert(!(await h.json()).content.some(node => node.attrs.id === id));
    }
  } finally { h.close(); }
});

test("list deletion removes only the held row and removes the container when the last row is deleted", async () => {
  for (const [listType, rowType] of [["bulletList", "listItem"], ["orderedList", "listItem"], ["taskList", "taskItem"]]) {
    const h = await runtime([{ type: listType, attrs: { id: "list" }, content: ["first", "second"].map(id => ({ type: rowType,
      attrs: { id }, content: [paragraph(id, id + "-text")] })) }, paragraph("Keep", "keep")]);
    try {
      for (const id of ["first", "second"]) {
        h.hold(`[data-vellix-block-id="${id}-text"]`);
        assert.equal(await h.command("deleteBlock", h.requests().at(-1).payload), true);
        assert(!JSON.stringify(await h.json()).includes(`"id":"${id}"`));
      }
      assert.deepEqual((await h.json()).content.map(node => node.attrs.id), ["keep"]);
    } finally { h.close(); }
  }
});

test("short taps, scrolling, movement, pointer cancellation and multiple fingers never open block removal", async () => {
  const h = await runtime([paragraph("A block", "block")]);
  const selector = '[data-vellix-block-id="block"]';
  try {
    for (const cancel of [
      () => h.pointer(selector, "pointerup"),
      () => h.pointer(selector, "pointermove", { clientX: 40 }),
      () => h.element(selector).dispatchEvent(new h.window.Event("scroll")),
      () => h.pointer(selector, "pointercancel"),
      () => h.pointer(selector, "pointerdown", { pointerId: 2, isPrimary: false }),
    ]) {
      h.pointer(selector, "pointerdown");
      cancel(); h.fire();
      h.pointer(selector, "pointerup");
      h.pointer(selector, "pointerup", { pointerId: 2 });
    }
    assert.equal(h.requests().length, 0);
  } finally { h.close(); }
});

test("cancelling preserves the block and holding again creates a new request", async () => {
  const h = await runtime([paragraph("Keep", "block")]);
  try {
    const before = await h.json();
    h.hold('[data-vellix-block-id="block"]');
    const token = h.requests().at(-1).payload.token;
    assert.equal(await h.command("dismissBlockActions", { token }), true);
    assert.equal(await h.command("deleteBlock", { token }), false);
    h.hold('[data-vellix-block-id="block"]');
    assert.notEqual(h.requests().at(-1).payload.token, token);
    assert.deepEqual(await h.json(), before);
  } finally { h.close(); }
});

test("locked and block-selection modes do not expose removal or accept an earlier request", async () => {
  const h = await runtime([paragraph("Keep", "block")]);
  try {
    for (const [name, args, restore] of [["setEditable", { editable: false }, { editable: true }],
      ["setSelectionMode", { mode: "multi" }, { mode: "off" }]]) {
      h.hold('[data-vellix-block-id="block"]');
      const token = h.requests().at(-1).payload.token;
      await h.command(name, args);
      const count = h.requests().length;
      h.hold('[data-vellix-block-id="block"]');
      assert.equal(h.requests().length, count);
      assert.equal(await h.command("deleteBlock", { token }), false);
      await h.command(name, restore);
    }
  } finally { h.close(); }
});

test("reloading a page or editing its contents invalidates old removal requests", async () => {
  const h = await runtime([paragraph("Original", "block"), { type: "plainCallout", attrs: { id: "callout" }, content: [paragraph("Note")] }]);
  try {
    h.hold('[data-vellix-block-id="block"]');
    let token = h.requests().at(-1).payload.token;
    await h.command("setContent", { document: { type: "doc", content: [paragraph("Different page", "block")] } });
    assert.equal(await h.command("deleteBlock", { token }), false);
    await h.command("insertBlock", { blockType: "plainCallout" });
    h.hold('.vellix-plain-callout');
    token = h.requests().at(-1).payload.token;
    const note = (await h.json()).content.find(node => node.type === "plainCallout");
    await h.command("updateCalloutColor", { blockId: note.attrs.id, color: "#FF5EAB" });
    assert.equal(await h.command("deleteBlock", { token }), false);
  } finally { h.close(); }
});

test("holding a callout control does not activate its picker on release", async () => {
  const h = await runtime([{ type: "callout", attrs: { id: "callout", icon: "sparkle" }, content: [paragraph("Note")] }]);
  try {
    h.hold('.vellix-callout-icon-button');
    h.element('.vellix-callout-icon-button').dispatchEvent(new h.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.equal(h.requests().length, 1);
    assert.equal(h.events.filter(event => event.kind === "iconPickerRequest").length, 0);
  } finally { h.close(); }
});

test("tables, collections, their controls, and enclosing blocks never receive this removal action", async () => {
  const h = await runtime([table(), collection(), { type: "callout", attrs: { id: "container" },
    content: [paragraph("Container with a table", "inside"), table()] }]);
  try {
    const before = await h.json();
    for (const selector of ["table", "td p", ".penned-collection", ".penned-collection button", '[data-vellix-block-id="inside"]']) {
      h.hold(selector);
      h.element(selector).dispatchEvent(new h.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    }
    assert.equal(h.requests().length, 0);
    assert.deepEqual(await h.json(), before);
  } finally { h.close(); }
});

test("page references retain their existing long-press page actions", async () => {
  const h = await runtime([{ type: "pageReference", attrs: { id: "page", documentID: "child" } }]);
  try {
    await h.command("setPageReferences", { pages: [{ documentID: "child", title: "Child" }] });
    h.hold('.vellix-page-reference-button');
    assert.equal(h.requests().length, 0);
    assert.equal(h.events.filter(event => event.kind === "pageActionsRequest").length, 1);
  } finally { h.close(); }
});

test("deleting the last block leaves an editable paragraph and undo restores its content", async () => {
  const h = await runtime([paragraph("Last block", "last")]);
  try {
    const before = await h.json();
    h.hold('[data-vellix-block-id="last"]');
    assert.equal(await h.command("deleteBlock", h.requests().at(-1).payload), true);
    const after = await h.json();
    assert.equal(after.content.length, 1);
    assert.equal(after.content[0].type, "paragraph");
    assert.equal(after.content[0].content?.length ?? 0, 0);
    await h.command("undo");
    assert.deepEqual(await h.json(), before);
  } finally { h.close(); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import { attachmentLayout, attachmentURL } from "../src/attachments.js";
import { audioTime } from "../src/audio-player.js";

const file = (kind = "image", path = "divider.png") => ({ attachmentID: "asset-" + path, relativePath: path, name: path, kind,
  mimeType: ({ image: "image/png", video: "video/mp4", audio: "audio/mpeg", pdf: "application/pdf" })[kind] || "application/zip", size: 4096, width: 400, height: 40 });
const paragraph = text => ({ type: "paragraph", attrs: { id: randomUUID() }, content: text ? [{ type: "text", text }] : [] });
const attachment = (asset = file(), attrs = {}) => ({ type: "attachment", attrs: { id: "block-" + asset.relativePath, file: asset, ...attrs } });
async function runtime(content = [paragraph("Before"), attachment(), paragraph("After")], assets = [file()]) {
  const html = await readFile(new URL("../dist/tiptap.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://penned.test" });
  const { window } = dom, events = [];
  window.console.log = window.console.info = () => {};
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.crypto.randomUUID = randomUUID;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.HTMLMediaElement.prototype.pause = window.HTMLMediaElement.prototype.load = () => {};
  window.scrollBy = () => {};
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  window.webkit = { messageHandlers: { tiptap: { postMessage(event) { events.push(JSON.parse(JSON.stringify(event))); } } } };
  for (const script of ["vendor/formula-parser.min.js", "table-formulas.js", "vellix-tables.js", "vendor/table-library.js", "tiptap.bundle.js"]) {
    window.eval(await readFile(new URL("../dist/" + script, import.meta.url), "utf8"));
  }
  const command = (name, args = {}) => window.tiptapCommand(name, args);
  await command("setAttachments", { files: assets });
  await command("setContent", { document: { type: "doc", content } });
  return { window, events, command, editor: window.document.querySelector(".tiptap-editor").editor,
    json: async () => JSON.parse(JSON.stringify(await command("getDocument"))), close: () => window.close() };
}

test("file type and node layout are separate, bounded and path-safe", () => {
  assert.equal(attachmentLayout(file(), {}).mode, "inline");
  assert.equal(attachmentLayout(file("pdf"), {}).mode, "preview");
  assert.equal(attachmentLayout(file("audio"), {}).mode, "player");
  assert.equal(attachmentLayout(file("file"), { displayMode: "inline" }).mode, "card");
  assert.deepEqual(attachmentLayout(file(), { displayMode: "fullWidth", widthPercent: 500, textAlign: "right" }), { mode: "fullWidth", width: 100, alignment: "right" });
  assert.equal(attachmentLayout(file(), { widthPercent: Infinity }).width, null);
  for (const path of ["", ".", "..", "../secret", "folder/file", "folder\\file", "bad\0file"]) assert.equal(attachmentURL(file("image", path)), "");
  assert.equal(attachmentURL(file("image", "a b#.png")), "penned-file://file/?path=a%20b%23.png");
});

test("images render bare, transparent, correctly proportioned and independently configurable", async () => {
  const asset = file(), h = await runtime([attachment(asset), attachment(asset, { id: "second", displayMode: "card" })]);
  try {
    const host = h.window.document.querySelector(".penned-attachment"), image = host.querySelector("img");
    assert(image); assert.equal(host.querySelector("button"), null);
    assert.equal(image.width, 400); assert.equal(image.height, 40);
    const style = h.window.getComputedStyle(host);
    assert.equal(style.paddingTop, "0px"); assert.equal(style.borderTopWidth, "0px"); assert.equal(style.boxShadow, "none");
    assert.equal(h.window.getComputedStyle(image).backgroundColor, "rgba(0, 0, 0, 0)");
    assert.equal(h.window.document.querySelectorAll(".penned-file-card").length, 1);
    assert.equal(await h.command("attachmentUpdate", { blockID: "block-divider.png", mode: "fullWidth", width: 55, alignment: "right" }), true);
    const saved = await h.json();
    assert.equal(saved.content[0].attrs.widthPercent, 55); assert.equal(saved.content[0].attrs.textAlign, "right");
    assert.equal(saved.content[1].attrs.displayMode, "card");
    assert.equal(saved.content[0].attrs.file.attachmentID, saved.content[1].attrs.file.attachmentID);
    await h.command("setContent", { document: saved }); assert.deepEqual(await h.json(), saved);
    assert.equal(h.window.document.querySelector(".penned-attachment").style.width, "100%");
  } finally { h.close(); }
});

test("GIFs keep original animated resources and HEIC uses a PNG display derivative", async () => {
  const gif = { ...file("image", "animated.gif"), mimeType: "image/gif" };
  const heic = { ...file("image", "photo.heic"), mimeType: "image/heic" };
  const h = await runtime([attachment(gif), attachment(heic)], [gif, heic]);
  try {
    const images = h.window.document.querySelectorAll(".penned-attachment img");
    assert.equal(images[0].getAttribute("src"), attachmentURL(gif));
    assert.equal(images[1].getAttribute("src"), attachmentURL(heic, "image"));
  } finally { h.close(); }
});

test("PDF preview is bounded; media uses native controls; unknown and unavailable files stay compact", async () => {
  const files = [file("pdf", "doc.pdf"), file("video", "movie.mp4"), file("audio", "song.mp3"), file("file", "archive.zip")];
  const h = await runtime([...files.map(asset => attachment(asset)), attachment(file("image", "unowned.png"))], files);
  try {
    const doc = h.window.document;
    assert.equal(doc.querySelector(".is-pdf img").getAttribute("src"), attachmentURL(files[0], "pdf"));
    assert.equal(h.window.getComputedStyle(doc.querySelector(".is-pdf img")).maxHeight, "220px");
    assert(doc.querySelector(".penned-video-cover") && !doc.querySelector("video").controls);
    assert(!doc.querySelector("audio").controls && doc.querySelector(".penned-audio-pill audio").hidden);
    assert(doc.querySelector("video").hasAttribute("playsinline"));
    assert.equal(doc.querySelectorAll(".penned-file-card").length, 3);
    assert(!doc.querySelector('[src*="unowned"]'));
    doc.querySelector("video").dispatchEvent(new h.window.Event("error"));
    assert(doc.body.textContent.includes("Playback unavailable. Open original file."));
  } finally { h.close(); }
});

test("audio time handles unknown durations and long recordings", () => {
  assert.equal(audioTime(NaN), "--:--"); assert.equal(audioTime(Infinity), "--:--");
  assert.equal(audioTime(-1), "--:--"); assert.equal(audioTime(0), "0:00");
  assert.equal(audioTime(19.9), "0:19"); assert.equal(audioTime(902), "15:02");
  assert.equal(audioTime(3827), "1:03:47");
});

test("video uses a full-frame document poster and the actual video dimensions without changing saved content", async () => {
  const asset = { ...file("video", "movie.mp4"), previewPath: "poster.png", width: undefined, height: undefined };
  const h = await runtime([attachment(asset), paragraph("After")], [asset]);
  try {
    const doc = h.window.document, frame = doc.querySelector(".penned-video-frame"), video = frame.querySelector("video");
    const poster = frame.querySelector(".penned-video-poster"), cover = frame.querySelector(".penned-video-cover");
    const before = await h.json();
    assert.equal(video.getAttribute("poster"), null);
    assert.equal(poster.getAttribute("src"), attachmentURL(asset, "thumbnail"));
    const style = h.window.getComputedStyle(video);
    assert.equal(style.position, "absolute"); assert.equal(style.width, "100%"); assert.equal(style.height, "100%");
    assert.equal(style.objectFit, "contain");
    Object.defineProperties(poster, { naturalWidth: { get: () => 640 }, naturalHeight: { get: () => 360 } });
    poster.dispatchEvent(new h.window.Event("load")); assert.equal(frame.style.aspectRatio, "640 / 360");
    Object.defineProperties(video, { videoWidth: { get: () => 360 }, videoHeight: { get: () => 640 } });
    video.dispatchEvent(new h.window.Event("loadedmetadata"));
    assert.equal(frame.style.aspectRatio, "360 / 640"); assert.equal(cover.hidden, false);
    let presented, paused = true, cancelled;
    Object.defineProperty(video, "paused", { get: () => paused });
    video.requestVideoFrameCallback = callback => { presented = callback; return 1; };
    video.cancelVideoFrameCallback = id => { cancelled = id; };
    video.dispatchEvent(new h.window.Event("loadeddata")); assert.equal(cover.hidden, false);
    assert.equal(presented, undefined, "Idle thumbnails stay available to document snapshots");
    paused = false; video.dispatchEvent(new h.window.Event("playing")); assert.equal(cover.hidden, false);
    presented(); assert.equal(cover.hidden, true); assert.equal(video.controls, true);
    video.dispatchEvent(new h.window.Event("loadeddata")); video.dispatchEvent(new h.window.Event("emptied"));
    assert.equal(cancelled, 1); assert.equal(cover.hidden, false); assert.equal(video.controls, false);
    assert.deepEqual(await h.json(), before);
    await h.command("attachmentUpdate", { blockID: "block-movie.mp4", mode: "player", width: 70, alignment: "right" });
    assert.equal(doc.querySelector("video"), video);
    const saved = await h.json(); await h.command("setContent", { document: saved });
    assert.deepEqual(await h.json(), saved); assert(doc.querySelector(".penned-video-poster"));
  } finally { h.close(); }
});

test("video poster waits for a decoded frame; playback, selection guards and missing previews remain safe", async () => {
  const asset = { ...file("video", "movie.mp4"), previewPath: "poster.png" }, h = await runtime([attachment(asset)], [asset]);
  try {
    const doc = h.window.document, frame = doc.querySelector(".penned-video-frame"), video = frame.querySelector("video");
    const cover = frame.querySelector(".penned-video-cover"), play = frame.querySelector("button");
    let attempts = 0;
    video.play = async () => { attempts++; video.dispatchEvent(new h.window.Event("play")); };
    const down = new h.window.Event("pointerdown", { bubbles: true, cancelable: true });
    play.dispatchEvent(down); assert.equal(down.defaultPrevented, true);
    play.click(); await Promise.resolve(); assert.equal(attempts, 1); assert.equal(cover.hidden, false);
    assert(!h.events.some(event => event.kind === "attachmentMenu"));
    Object.defineProperty(video, "paused", { get: () => false });
    video.dispatchEvent(new h.window.Event("playing")); assert.equal(cover.hidden, true);
    video.dispatchEvent(new h.window.Event("emptied")); assert.equal(cover.hidden, false);
    frame.querySelector("img").dispatchEvent(new h.window.Event("error"));
    assert.equal(frame.querySelector("img"), null); assert(frame.querySelector("button"));
    await h.command("setEditable", { editable: false }); play.click(); await Promise.resolve(); assert.equal(attempts, 2);
    await h.command("setSelectionMode", { mode: "multi" }); play.click(); await Promise.resolve(); assert.equal(attempts, 2);
    await h.command("setSelectionMode", { mode: "off" });
    video.play = async () => { throw new Error("Playback blocked"); };
    play.click(); await new Promise(resolve => setImmediate(resolve));
    assert(h.events.some(event => event.kind === "error" && event.payload.message.includes("video could not be played")));
  } finally { h.close(); }
});

test("pill audio controls play, seek, mute and open file actions without editing or selecting the block", async () => {
  const asset = file("audio", "Evening Meditation.mp3"), h = await runtime([attachment(asset), paragraph("After")], [asset]);
  try {
    const doc = h.window.document, audio = doc.querySelector("audio"), pill = doc.querySelector(".penned-audio-pill");
    const play = pill.querySelector(".penned-audio-play"), seek = pill.querySelector("input"), volume = pill.querySelector(".penned-audio-volume");
    const before = await h.json(); let paused = true, ended = false;
    Object.defineProperties(audio, { duration: { get: () => 902 }, paused: { get: () => paused }, ended: { get: () => ended } });
    audio.play = async () => { paused = false; ended = false; audio.dispatchEvent(new h.window.Event("play")); };
    audio.pause = () => { paused = true; audio.dispatchEvent(new h.window.Event("pause")); };
    assert.equal(pill.querySelector("strong").textContent, "Evening Meditation");
    assert.equal(seek.disabled, true);
    audio.dispatchEvent(new h.window.Event("loadedmetadata"));
    assert.equal(seek.disabled, false); assert.equal(seek.max, "902");
    assert.equal(pill.querySelector(".penned-audio-time").textContent, "0:00 / 15:02");
    h.events.length = 0;
    play.click(); await Promise.resolve(); assert.equal(paused, false);
    assert.equal(play.getAttribute("aria-label"), "Pause audio");
    audio.currentTime = 19; audio.dispatchEvent(new h.window.Event("timeupdate"));
    assert.equal(pill.querySelector(".penned-audio-time").textContent, "0:19 / 15:02");
    seek.value = "451"; seek.dispatchEvent(new h.window.Event("input", { bubbles: true }));
    assert.equal(audio.currentTime, 451); assert.equal(seek.style.getPropertyValue("--penned-audio-progress"), "50%");
    volume.click(); assert.equal(audio.muted, true); assert.equal(volume.getAttribute("aria-label"), "Unmute audio");
    volume.click(); assert.equal(audio.muted, false);
    play.click(); assert.equal(paused, true); assert.equal(play.getAttribute("aria-label"), "Play audio");
    assert(!h.events.some(event => ["attachmentMenu", "attachmentActions", "snapshot"].includes(event.kind)));
    assert.deepEqual(await h.json(), before);
    assert.equal(doc.querySelectorAll(".penned-attachment.ProseMirror-selectednode").length, 0);
    pill.querySelector(".penned-audio-more").click();
    assert(h.events.some(event => event.kind === "attachmentActions" && event.payload.blockID === "block-Evening Meditation.mp3"));
    await h.command("attachmentUpdate", { blockID: "block-Evening Meditation.mp3", width: 65, alignment: "right", mode: "player" });
    assert.equal(doc.querySelector("audio"), audio, "Changing size/alignment must not restart playback");
    const saved = await h.json();
    await h.command("setEditable", { editable: false });
    play.click(); await Promise.resolve(); assert.equal(paused, false, "Read-only audio remains playable");
    await h.command("attachmentPauseAll"); assert.equal(paused, true);
    await h.command("setContent", { document: saved });
    assert.deepEqual(await h.json(), saved); assert(doc.querySelector(".penned-audio-pill"));
  } finally { h.close(); }
});

test("audio playback failures are reported and block selection never operates the player", async () => {
  const asset = file("audio", "song.mp3"), h = await runtime([attachment(asset)], [asset]);
  try {
    const audio = h.window.document.querySelector("audio"), play = h.window.document.querySelector(".penned-audio-play");
    let attempted = 0;
    audio.play = async () => { attempted++; throw new Error("Decoder unavailable"); };
    play.click(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(attempted, 1);
    assert(h.events.some(event => event.kind === "error" && event.payload.message.includes("could not be played")));
    await h.command("setSelectionMode", { mode: "multi" });
    play.click(); await Promise.resolve(); assert.equal(attempted, 1);
    const count = h.events.filter(event => event.kind === "attachmentActions").length;
    h.window.document.querySelector(".penned-audio-more").click();
    assert.equal(h.events.filter(event => event.kind === "attachmentActions").length, count);
    assert.equal(await h.command("attachmentDelete", { blockID: "block-song.mp3" }), false);
  } finally { h.close(); }
});

test("insertion continues in text without selecting the image, and undo/redo preserve identity", async () => {
  const h = await runtime([paragraph("Text")]);
  try {
    await h.command("focusDocumentEnd");
    const before = await h.json();
    const token = await h.command("attachmentCaptureInsertion");
    assert.equal(await h.command("attachmentInsert", { token: "stale", file: file() }), false);
    assert.equal(await h.command("attachmentInsert", { token, file: file() }), true);
    assert.equal(h.window.document.querySelectorAll(".penned-attachment.ProseMirror-selectednode").length, 0);
    assert(h.window.getSelection().isCollapsed);
    const saved = await h.json(), inserted = saved.content.find(node => node.type === "attachment");
    assert(saved.content.at(-1).type === "paragraph");
    await h.command("undo"); assert.deepEqual(await h.json(), before);
    await h.command("redo"); assert.deepEqual((await h.json()).content.find(node => node.type === "attachment"), inserted);
    assert(h.events.some(event => event.kind === "snapshot"));
  } finally { h.close(); }
});

test("file long press offers actions separately from tap settings; Delete saves and supports undo without removing shared files", async () => {
  const h = await runtime([paragraph("Before"), attachment(), attachment(file(), { id: "shared-copy" }), paragraph("After")]);
  try {
    const host = h.window.document.querySelector(".penned-attachment"), before = await h.json();
    host.querySelector("img").click();
    assert.equal(h.events.at(-1).kind, "attachmentMenu");
    host.dispatchEvent(new h.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const request = h.events.at(-1);
    assert.equal(request.kind, "attachmentActions");
    assert.equal(request.payload.blockID, "block-divider.png");
    assert.deepEqual(await h.json(), before);
    assert.equal(await h.command("attachmentDelete", { blockID: "missing-block" }), false);
    assert.equal(await h.command("attachmentDelete", { blockID: request.payload.blockID }), true);
    const saved = await h.json();
    assert.equal(saved.content.filter(node => node.type === "attachment").length, 1);
    assert.equal(saved.content.find(node => node.type === "attachment").attrs.id, "shared-copy");
    assert(h.window.document.querySelector(".penned-attachment img"));
    assert(h.events.some(event => event.kind === "snapshot"));
    await h.command("undo"); assert.deepEqual(await h.json(), before);
    await h.command("redo"); assert.deepEqual(await h.json(), saved);
    await h.command("setContent", { document: saved }); assert.deepEqual(await h.json(), saved);
  } finally { h.close(); }
});

test("read-only files open their existing context without modifying content", async () => {
  const h = await runtime();
  try {
    await h.command("setEditable", { editable: false }); const before = await h.json();
    h.window.document.querySelector(".penned-attachment img").click();
    assert(h.events.some(event => event.kind === "attachmentMenu" && event.payload.relativePath === "divider.png"));
    assert.equal(await h.command("attachmentUpdate", { blockID: "block-divider.png", mode: "card" }), false);
    assert.equal(await h.command("attachmentDelete", { blockID: "block-divider.png" }), false);
    assert.deepEqual(await h.json(), before);
  } finally { h.close(); }
});

test("template and Daily Note contexts retain attachment configuration without changing the source file", async () => {
  const h = await runtime([attachment(file(), { displayMode: "inline", widthPercent: 60, textAlign: "center" })]);
  try {
    await h.command("setTemplateEditing", { enabled: true });
    const saved = await h.json();
    await h.command("setTemplateEditing", { enabled: false });
    await h.command("setContent", { document: saved });
    assert.deepEqual(await h.json(), saved);
    assert.equal(h.window.document.querySelector(".penned-attachment").style.width, "60%");
  } finally { h.close(); }
});

test("HTML clipboard serialization retains media identity and layout while pasted blocks receive independent block IDs", async () => {
  const h = await runtime([attachment(file(), { widthPercent: 45, displayMode: "inline", textAlign: "right", indent: 1 })]);
  try {
    const html = h.editor.getHTML(), original = (await h.json()).content[0];
    h.editor.commands.setContent(html);
    let saved = (await h.json()).content[0];
    assert.deepEqual(saved.attrs.file, original.attrs.file);
    assert.equal(saved.attrs.displayMode, "inline"); assert.equal(saved.attrs.widthPercent, 45);
    assert.equal(saved.attrs.textAlign, "right"); assert.equal(saved.attrs.indent, 1);
    h.editor.commands.insertContentAt(h.editor.state.doc.content.size, html);
    const attachments = (await h.json()).content.filter(node => node.type === "attachment");
    assert.equal(attachments.length, 2);
    assert.notEqual(attachments[0].attrs.id, attachments[1].attrs.id);
    assert.equal(attachments[0].attrs.file.attachmentID, attachments[1].attrs.file.attachmentID);
  } finally { h.close(); }
});

test("pasted file bytes use the native attachment import bridge and leave text unchanged until import completes", async () => {
  const h = await runtime([paragraph("Keep this text")]);
  try {
    const event = new h.window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => "", types: ["Files"], files: [new h.window.File(["file bytes"], "note.txt", { type: "text/plain" })] } });
    const before = await h.json(); h.editor.view.dom.dispatchEvent(event);
    await new Promise(resolve => h.window.setTimeout(resolve, 30));
    const request = h.events.find(event => event.kind === "attachmentImport");
    assert(request?.payload.token);
    assert.equal(request.payload.files[0].name, "note.txt");
    assert.equal(Buffer.from(request.payload.files[0].base64, "base64").toString(), "file bytes");
    assert.deepEqual(await h.json(), before);
  } finally { h.close(); }
});

test("block Copy and Cut use native HTML clipboard data; failed copies never remove the source file block", async () => {
  const h = await runtime([attachment(file(), { displayMode: "inline", widthPercent: 45, textAlign: "center" })]);
  try {
    const rect = { left: 0, top: 0, right: 300, bottom: 40, width: 300, height: 40 };
    h.window.HTMLElement.prototype.getClientRects = () => [rect];
    h.window.HTMLElement.prototype.getBoundingClientRect = () => rect;
    await h.command("setSelectionMode", { mode: "multi" }); await h.command("selectAllBlocks");
    const before = await h.json(), copying = h.command("copySelectedBlocks");
    await Promise.resolve();
    let request = h.events.filter(event => event.kind === "attachmentClipboard").at(-1);
    assert(request?.payload.html.includes("data-penned-file"));
    assert(request.payload.html.includes("widthPercent") && request.payload.html.includes("asset-divider.png"));
    await h.command("attachmentClipboardResult", { token: request.payload.token, success: true });
    assert.equal(await copying, true); assert.deepEqual(await h.json(), before);
    const failedCut = h.command("cutSelectedBlocks"); await Promise.resolve();
    request = h.events.filter(event => event.kind === "attachmentClipboard").at(-1);
    await h.command("attachmentClipboardResult", { token: request.payload.token, success: false });
    assert.equal(await failedCut, false); assert.deepEqual(await h.json(), before);
    const cut = h.command("cutSelectedBlocks"); await Promise.resolve();
    request = h.events.filter(event => event.kind === "attachmentClipboard").at(-1);
    await h.command("attachmentClipboardResult", { token: request.payload.token, success: true });
    assert.equal(await cut, true); assert(!(await h.json()).content.some(node => node.type === "attachment"));
    await h.command("undo"); assert((await h.json()).content.some(node => node.type === "attachment"));
  } finally { h.close(); }
});

test("duplicating selected file blocks retains one underlying file with independent layout and undo", async () => {
  const h = await runtime([attachment(file(), { widthPercent: 45, textAlign: "center" })]);
  try {
    const rect = { left: 0, top: 0, right: 300, bottom: 40, width: 300, height: 40 };
    h.window.HTMLElement.prototype.getClientRects = () => [rect]; h.window.HTMLElement.prototype.getBoundingClientRect = () => rect;
    await h.command("selectAllBlocks"); await h.command("duplicateSelectedBlocks");
    const copies = (await h.json()).content.filter(node => node.type === "attachment");
    assert.equal(copies.length, 2); assert.notEqual(copies[0].attrs.id, copies[1].attrs.id);
    assert.equal(copies[0].attrs.file.attachmentID, copies[1].attrs.file.attachmentID);
    await h.command("clearBlockSelection");
    await h.command("attachmentUpdate", { blockID: copies[1].attrs.id, mode: "inline", width: 20, alignment: "right" });
    const changed = (await h.json()).content.filter(node => node.type === "attachment");
    assert.equal(changed[0].attrs.widthPercent, 45); assert.equal(changed[1].attrs.widthPercent, 20);
    await h.command("undo"); await h.command("undo");
    assert.equal((await h.json()).content.filter(node => node.type === "attachment").length, 1);
    await h.command("redo"); assert.equal((await h.json()).content.filter(node => node.type === "attachment").length, 2);
  } finally { h.close(); }
});

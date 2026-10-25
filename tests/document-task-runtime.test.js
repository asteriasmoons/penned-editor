import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";

async function mountedRuntime() {
  const events = [];
  const dom = new JSDOM("<!doctype html><html><body><main class='vellix-editor-page'><div id='editor'></div></main></body></html>",
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://vellix.test" });
  const window = dom.window;
  window.console.log = () => {};
  window.console.info = () => {};
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.webkit = { messageHandlers: { tiptap: { postMessage(message) { events.push(message); } } } };
  window.crypto.randomUUID = randomUUID;
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 24, right: 100 });
  for (const file of ["vendor/formula-parser.min.js", "table-formulas.js", "vellix-tables.js", "vendor/table-library.js", "tiptap.bundle.js"])
    window.eval(await readFile(new URL("../dist/" + file, import.meta.url), "utf8"));
  assert(events.some(event => event.kind === "ready"));
  return { window, events };
}

test("the synchronized editor bundle converts, configures, completes, reloads and untracks real checklist blocks", async () => {
  const { window, events } = await mountedRuntime();
  try {
    const content = { type: "doc", content: [{ type: "taskList", attrs: { id: randomUUID() }, content: [{ type: "taskItem",
      attrs: { id: "source-checklist", checked: false }, content: [{ type: "paragraph", attrs: { id: randomUUID() },
        content: [{ type: "text", text: "A real document task", marks: [{ type: "italic" }] }] }] }] }] };
    await window.tiptapCommand("setContent", { document: content });
    const task = { id: randomUUID(), occurrenceID: randomUUID(), reminderEnabled: false, history: [] };
    assert(await window.tiptapCommand("taskConvert", { blockId: "source-checklist", enabled: true, task }));
    assert(await window.tiptapCommand("taskConfigure", { blockId: "source-checklist", taskID: task.id, configuration: {
      reminderEnabled: true, scheduledAt: Date.now() / 1000 + 3600,
      recurrence: { frequency: "daily", interval: 1, weekdays: [], hour: 9, minute: 0, timeZoneID: "UTC", anchor: Date.now() / 1000 }
    } }));
    const first = events.findLast(event => event.kind === "taskSnapshot").payload.document;
    const configured = first.content[0].content[0].attrs.trackedTask;
    assert.equal(configured.id, task.id);
    assert.equal(window.document.querySelectorAll(".vellix-task-metadata > span").length, 2);
    assert.equal(window.document.querySelector(".vellix-task-menu"), null);
    const icons = window.document.querySelectorAll(".vellix-task-metadata i");
    assert.match(icons[0].style.maskImage, /\/repeatfill\?/);
    assert.match(icons[1].style.maskImage, /\/clockwavy\?/);
    window.document.querySelector(".vellix-task-metadata").click();
    assert.equal(events.findLast(event => event.kind === "taskMenuRequest").payload.task.id, task.id);
    window.document.querySelector("label").click();
    await new Promise(resolve => setTimeout(resolve, 340));
    const completion = events.findLast(event => event.kind === "taskCompletionRequest");
    assert.equal(completion.payload.task.id, task.id);
    assert.equal(completion.payload.completed, true);
    const next = { ...configured, occurrenceID: randomUUID(), scheduledAt: configured.scheduledAt + 86400,
      history: [{ id: task.occurrenceID, scheduledAt: configured.scheduledAt, completedAt: Date.now() / 1000 }] };
    assert(await window.tiptapCommand("taskComplete", { blockId: "source-checklist", taskID: task.id,
      expectedOccurrenceID: task.occurrenceID, task: next, checked: false }));
    const saved = events.findLast(event => event.kind === "taskSnapshot").payload.document;
    await window.tiptapCommand("setContent", { document: saved });
    assert.equal(window.document.querySelector("label input").checked, false);
    assert.match(window.document.querySelector(".vellix-task-metadata").textContent, /Daily/);
    assert.match(window.document.querySelector("[data-vellix-task-content]").innerHTML, /<em>A real document task<\/em>/);
    assert(await window.tiptapCommand("taskConvert", { blockId: "source-checklist", enabled: false }));
    const ordinary = events.findLast(event => event.kind === "taskSnapshot").payload.document.content[0].content[0];
    assert.equal(ordinary.attrs.trackedTask, null);
    assert.equal(ordinary.content[0].content[0].text, "A real document task");
    assert.equal(ordinary.content[0].content[0].marks[0].type, "italic");
  } finally { window.close(); }
});

test("formatting-created checklists immediately expose a persistent task toolbar context", async () => {
  const { window, events } = await mountedRuntime();
  try {
    await window.tiptapCommand("setContent", { document: { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "Test Reminder Tasks system" }] }
    ] } });
    await window.tiptapCommand("focus", {});
    assert(await window.tiptapCommand("formatCurrentSelection", { action: "checkList" }));
    const context = events.findLast(event => event.kind === "taskState").payload;
    assert.equal(typeof context.blockId, "string", "native task context requires a live checklist block ID");
    assert(context.blockId.length > 0);
    assert.equal(context.task, null, "showing task actions must not automatically convert the checklist");
    const item = window.document.querySelector('[data-type="taskItem"]');
    assert(item);
    assert.equal(item.dataset.vellixBlockId, context.blockId);
    assert.equal(item.querySelector(".vellix-task-menu"), null);
    assert.equal(item.querySelector(".vellix-task-metadata").hidden, true);
    const task = { id: randomUUID(), occurrenceID: randomUUID(), reminderEnabled: false, history: [] };
    assert(await window.tiptapCommand("taskConvert", { blockId: context.blockId, enabled: true, task }));
    const saved = await window.tiptapCommand("getDocument", {});
    assert.equal(saved.content[0].content[0].attrs.id, context.blockId);
    await window.tiptapCommand("setContent", { document: saved });
    await window.tiptapCommand("focus", {});
    assert.equal(events.findLast(event => event.kind === "taskState").payload.task.id, task.id);
  } finally { window.close(); }
});

for (const nested of [false, true]) {
  test(`Enter exposes task actions for the new ordinary checklist${nested ? " inside a nested container" : ""}`, async () => {
    const { window, events } = await mountedRuntime();
    try {
      const paragraph = { type: "paragraph", content: [{ type: "text", text: "First checklist" }] };
      await window.tiptapCommand("setContent", { document: { type: "doc", content: [
        nested ? { type: "blockquote", content: [paragraph] } : paragraph
      ] } });
      await window.tiptapCommand("focus", {});
      assert(await window.tiptapCommand("formatCurrentSelection", { action: "checkList" }));
      const firstID = events.findLast(event => event.kind === "taskState").payload.blockId;
      window.document.querySelector(".tiptap-editor").dispatchEvent(new window.KeyboardEvent("keydown", {
        key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true
      }));
      assert.equal(window.document.querySelectorAll('[data-type="taskItem"]').length, 2);
      const context = events.findLast(event => event.kind === "taskState").payload;
      assert.equal(typeof context.blockId, "string");
      assert.notEqual(context.blockId, firstID);
      assert.equal(context.task, null);
      const active = window.document.querySelectorAll('[data-type="taskItem"]')[1];
      assert.equal(active.dataset.vellixBlockId, context.blockId);
      assert.equal(active.querySelector(".vellix-task-menu"), null);
      await window.tiptapCommand("undo", {});
      assert.equal(window.document.querySelectorAll('[data-type="taskItem"]').length, 1);
      assert.equal(events.findLast(event => event.kind === "taskState").payload.blockId, firstID);
      await window.tiptapCommand("redo", {});
      assert.equal(window.document.querySelectorAll('[data-type="taskItem"]')[1].dataset.vellixBlockId, context.blockId);
    } finally { window.close(); }
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Slice, Fragment } from "@tiptap/pm/model";
import { createChecklistItem, createTaskIntegration, taskCommand, repeatLabel, reminderLabel } from "../src/document-tasks.js";

const tracked = () => ({ id: crypto.randomUUID(), occurrenceID: crypto.randomUUID(), reminderEnabled: false, history: [] });

function mount(task = null) {
  const dom = new JSDOM("<!doctype html><html><body><div id='editor'></div></body></html>", { pretendToBeVisual: true });
  for (const key of ["window", "document", "HTMLElement", "Element", "MutationObserver"])
    globalThis[key] = dom.window[key];
  for (const key of ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) globalThis[key] = dom.window[key].bind(dom.window);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  dom.window.Range.prototype.getClientRects = () => [];
  dom.window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 24, right: 100 });
  const events = [], post = (kind, payload) => events.push({ kind, payload });
  const blockIDs = Extension.create({ name: "testBlockIDs", addGlobalAttributes() { return [{ types: ["taskItem", "paragraph"], attributes: { id: { default: null, keepOnSplit: false } } }]; } });
  let transactions = 0;
  const editor = new Editor({ element: document.querySelector("#editor"), extensions: [StarterKit, TaskList, blockIDs,
    createChecklistItem(TaskItem, { post, selectionActive: () => false, reportHeight() {}, nodeID: node => node.attrs.id, iconSource: name => `https://vellix.test/${name}.png` }),
    createTaskIntegration({ Extension, Plugin, PluginKey, post, selectionActive: () => false, canonicalize: value => value })],
    content: { type: "doc", content: [{ type: "taskList", content: [{ type: "taskItem", attrs: { id: "checklist", checked: false, trackedTask: task },
      content: [{ type: "paragraph", attrs: { id: "text" }, content: [{ type: "text", text: "Keep my formatting", marks: [{ type: "bold" }] }] }] }] }] },
    onTransaction() { transactions++; }
  });
  const item = () => editor.getJSON().content[0].content[0];
  const command = (name, args = {}) => taskCommand(editor, name, { blockId: "checklist", ...args }, post, value => value);
  return { dom, editor, events, item, command, transactions: () => transactions,
    close() { editor.destroy(); dom.window.close(); } };
}

test("ordinary checklist interactions do not convert items into tasks", () => {
  const h = mount();
  try {
    document.querySelector("label").click();
    assert.equal(h.item().attrs.checked, true);
    assert.equal(h.item().attrs.trackedTask, null);
    assert.equal(document.querySelector(".vellix-task-menu"), null);
    document.querySelector("label").click();
    assert.equal(h.item().attrs.crossed, true, "ordinary double-tap rejection remains intact");
    assert(!h.events.some(event => event.kind === "taskCompletionRequest"));
  } finally { h.close(); }
});

test("conversion preserves content, marks, identity and checked state; undo and conversion back work", () => {
  const h = mount();
  try {
    const before = h.item(), task = tracked();
    assert(h.command("taskConvert", { enabled: true, task }));
    assert.deepEqual(h.item().content, before.content);
    assert.equal(h.item().attrs.id, before.attrs.id);
    assert.equal(h.item().attrs.checked, before.attrs.checked);
    assert.equal(h.item().attrs.trackedTask.id, task.id);
    assert(h.events.some(event => event.kind === "taskSnapshot"));
    h.editor.commands.undo();
    assert.equal(h.item().attrs.trackedTask, null);
    h.editor.commands.redo();
    assert.equal(h.item().attrs.trackedTask.id, task.id);
    assert(h.command("taskConvert", { enabled: false }));
    assert.deepEqual(h.item().content, before.content);
    assert.equal(h.item().attrs.trackedTask, null);
  } finally { h.close(); }
});

test("task completion is explicitly bridged, accepts only the expected occurrence, and preserves the next occurrence", () => {
  const task = tracked(), h = mount(task);
  try {
    document.querySelector("label").click(); document.querySelector("label").click();
    assert.equal(h.events.filter(event => event.kind === "taskCompletionRequest").length, 1);
    assert.equal(h.events.findLast(event => event.kind === "taskCompletionRequest").payload.skipped, true);
    assert.equal(h.item().attrs.checked, false);
    const next = { ...task, occurrenceID: crypto.randomUUID(), scheduledAt: 1791986400,
      recurrence: { frequency: "daily", interval: 1 }, history: [{ id: task.occurrenceID, completedAt: 1791900000 }] };
    assert(h.command("taskComplete", { taskID: task.id, expectedOccurrenceID: task.occurrenceID, task: next, checked: false }));
    assert.equal(h.item().attrs.trackedTask.history.length, 1);
    assert.equal(h.item().attrs.checked, false);
    assert.equal(h.command("taskComplete", { taskID: task.id, expectedOccurrenceID: task.occurrenceID, task: next, checked: false }), false);
    assert.match(document.querySelector(".vellix-task-metadata").textContent, /Daily/);
  } finally { h.close(); }
});

test("tracked single taps are delayed only for double-tap recognition and retain the task text", async () => {
  const h = mount(tracked());
  try {
    document.querySelector("label").click();
    assert.equal(h.events.filter(event => event.kind === "taskCompletionRequest").length, 0);
    await new Promise(resolve => setTimeout(resolve, 340));
    const event = h.events.findLast(event => event.kind === "taskCompletionRequest");
    assert.equal(event.payload.skipped, false);
    assert.equal(event.payload.text, "Keep my formatting");
  } finally { h.close(); }
});

test("source extension exposes the history link and reuses the existing nested-page navigation bridge", () => {
  const metadata = tracked(), h = mount(metadata);
  try {
    document.querySelector(".vellix-task-history").click();
    assert.equal(h.events.findLast(event => event.kind === "pageOpenRequest").payload.documentId, "vellix-task-page:" + metadata.id);
    assert.deepEqual(h.item().attrs.trackedTask, metadata);
    assert.equal(reminderLabel({ ...metadata, reminderEnabled: true, scheduledAt: Date.parse("2026-10-20T21:20:00Z") / 1000,
      recurrence: { timeZoneID: "UTC" } }).includes("9:20 PM"), true);
  } finally { h.close(); }
});

test("reminder and repeat labels are separate and survive JSON reload; metadata is not editable text", async () => {
  const task = { ...tracked(), reminderEnabled: true, scheduledAt: Date.now() / 1000,
    recurrence: { frequency: "daily", interval: 3 } }, h = mount(task);
  try {
    assert.equal(document.querySelectorAll(".vellix-task-metadata > span").length, 2);
    assert.match(document.querySelector(".vellix-task-metadata").textContent, /Every 3 Days/);
    const saved = h.editor.getJSON(); h.editor.commands.setContent(saved);
    assert.deepEqual(h.item().attrs.trackedTask, task);
    h.editor.commands.setTextSelection(3);
    assert.equal(h.events.findLast(event => event.kind === "taskState").payload.blockId, "checklist");
    assert.equal(document.querySelector(".vellix-task-menu"), null);
    assert.equal(document.querySelector(".vellix-task-metadata").contentEditable, "false");
    const icons = Array.from(document.querySelectorAll(".vellix-task-metadata i"));
    assert.match(icons[0].style.maskImage, /repeatfill/);
    assert.match(icons[1].style.maskImage, /clockwavy/);
    document.querySelector(".vellix-task-metadata").click();
    assert.equal(h.events.findLast(event => event.kind === "taskMenuRequest").payload.task.id, task.id);
    assert.equal(h.editor.getText().trim(), "Keep my formatting");
    const count = h.transactions();
    await new Promise(resolve => setTimeout(resolve, 80));
    assert(h.transactions() - count < 3, "task chrome must not cause a mutation transaction loop");
  } finally { h.close(); }
});

test("pasted and duplicate checklist tasks receive independent task and occurrence IDs", () => {
  const task = { ...tracked(), history: [{ id: crypto.randomUUID(), completedAt: 5 }] }, h = mount(task);
  try {
    const node = h.editor.state.doc.firstChild.firstChild;
    let slice = new Slice(Fragment.from(node), 0, 0);
    h.editor.view.someProp("transformPasted", transform => { slice = transform(slice, h.editor.view, false); });
    const pasted = slice.content.firstChild.attrs.trackedTask;
    assert.notEqual(pasted.id, task.id); assert.notEqual(pasted.occurrenceID, task.occurrenceID);
    assert.deepEqual(pasted.history, []);
    h.editor.view.dispatch(h.editor.state.tr.insert(h.editor.state.doc.firstChild.nodeSize - 1, node));
    const items = h.editor.getJSON().content[0].content;
    assert.equal(items.length, 2); assert.notEqual(items[0].attrs.trackedTask.id, items[1].attrs.trackedTask.id);
  } finally { h.close(); }
});

test("Daily is never mislabeled Today, and reminders have an independent date/time label", () => {
  assert.equal(repeatLabel({ frequency: "daily", interval: 1 }), "Daily");
  assert.equal(repeatLabel({ frequency: "weekdays", interval: 1 }), "Every Weekday");
  assert.equal(repeatLabel({ frequency: "weekly", interval: 2 }), "Every 2 Weeks");
  const now = new Date("2026-10-13T14:00:00Z");
  assert.match(reminderLabel({ reminderEnabled: true, scheduledAt: now.getTime() / 1000 }, now), /^Today, /);
});

test("splitting a tracked checklist produces an ordinary checklist, not a second task", () => {
  const task = tracked(), h = mount(task);
  try {
    h.editor.commands.setTextSelection(3 + "Keep my formatting".length);
    assert(h.editor.commands.splitListItem("taskItem"));
    const items = h.editor.getJSON().content[0].content;
    assert.equal(items.length, 2);
    assert.equal(items[0].attrs.trackedTask.id, task.id);
    assert.equal(items[1].attrs.trackedTask, null);
    assert(items[1].attrs.id);
    assert.notEqual(items[1].attrs.id, items[0].attrs.id);
    assert.equal(h.events.findLast(event => event.kind === "taskState").payload.blockId, items[1].attrs.id);
    assert.equal(document.querySelectorAll('[data-type="taskItem"]')[1].dataset.vellixBlockId, items[1].attrs.id);
  } finally { h.close(); }
});

test("ordinary copied checklists have unique stable IDs without becoming tracked tasks", () => {
  const h = mount();
  try {
    const node = h.editor.state.doc.firstChild.firstChild;
    h.editor.view.dispatch(h.editor.state.tr.insert(h.editor.state.doc.firstChild.nodeSize - 1, node));
    const items = h.editor.getJSON().content[0].content;
    assert.notEqual(items[0].attrs.id, items[1].attrs.id);
    assert(items.every(item => item.attrs.trackedTask === null));
    h.editor.commands.setTextSelection(items[0].content[0].content[0].text.length + 7);
    const context = h.events.findLast(event => event.kind === "taskState").payload;
    assert.equal(context.blockId, items[1].attrs.id);
    assert(h.command("taskConvert", { blockId: context.blockId, enabled: true, task: tracked() }));
    assert.equal(h.item().attrs.trackedTask, null);
    assert(h.editor.getJSON().content[0].content[1].attrs.trackedTask);
    const saved = h.editor.getJSON();
    h.editor.commands.setContent(saved);
    assert.deepEqual(h.editor.getJSON(), saved);
  } finally { h.close(); }
});

test("external completion updates a read-only document, and leaving checklists clears scheduling context", () => {
  const task = tracked(), h = mount(task);
  try {
    h.editor.setEditable(false);
    const completed = { ...task, history: [{ id: task.occurrenceID, completedAt: 1791900000 }] };
    assert(h.command("taskComplete", { taskID: task.id, task: completed, external: true, checked: true }));
    assert.equal(h.item().attrs.checked, true);
    assert.equal(document.querySelector("label input").checked, true);
    h.editor.setEditable(true);
    h.editor.commands.insertContentAt(h.editor.state.doc.content.size, { type: "paragraph", content: [{ type: "text", text: "Ordinary text" }] });
    h.editor.commands.setTextSelection(h.editor.state.doc.content.size - 2);
    assert.deepEqual(h.events.findLast(event => event.kind === "taskState").payload, {});
    assert.equal(document.querySelector(".vellix-task-menu"), null);
  } finally { h.close(); }
});

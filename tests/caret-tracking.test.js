import test from "node:test";
import assert from "node:assert/strict";
import { createCaretTracking } from "../src/caret-tracking.js";

function harness() {
  const handlers = new Map(), frames = new Map(), messages = [];
  let nextFrame = 0, focused = true, selecting = false;
  const previous = { window: globalThis.window, requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame };
  globalThis.window = { scrollX: 5, scrollY: 20 };
  globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  globalThis.cancelAnimationFrame = frame => frames.delete(frame);
  const coordinates = { left: 100, right: 100, top: 300, bottom: 324 };
  const editor = { isDestroyed: false, isEditable: true,
    state: { selection: { empty: true, head: 12, $head: { parent: { isTextblock: true } } } },
    view: { hasFocus: () => focused, coordsAtPos: position => { assert.equal(position, editor.state.selection.head); return coordinates; } },
    on(name, callback) { handlers.set(name, callback); } };
  const tracking = createCaretTracking({ editor, post: (kind, payload) => messages.push({ kind, payload }),
    reportHeight: () => messages.push({ kind: "height" }), selectionActive: () => selecting });
  return { editor, coordinates, messages, tracking,
    emit: (name, payload) => handlers.get(name)?.(payload),
    focus: value => { focused = value; }, select: value => { selecting = value; },
    flush() { for (const [frame, callback] of [...frames]) { frames.delete(frame); callback(); } },
    close() { Object.assign(globalThis, previous); } };
}

test("typing and selection changes coalesce after layout and report height before the active caret", () => {
  const h = harness();
  try {
    for (let index = 0; index < 20; index++) h.emit("transaction", { transaction: { docChanged: true } });
    h.flush();
    assert.deepEqual(h.messages, [{ kind: "height" }, { kind: "caret", payload: {
      x: 105, y: 320, width: 1, height: 24, revision: 1
    } }]);
    h.editor.state.selection.head = 13;
    h.emit("transaction", { transaction: { selectionSet: true } }); h.flush();
    assert.equal(h.messages.at(-1).payload.revision, 2, "typing resumes tracking even on the same visual line");
  } finally { h.close(); }
});

test("passive transactions do not pull a manually scrolled document back to the caret", () => {
  const h = harness();
  try {
    h.emit("transaction", { transaction: { docChanged: false, selectionSet: false } }); h.flush();
    assert.equal(h.messages.length, 0);
    h.emit("focus"); h.flush();
    assert.equal(h.messages.at(-1).kind, "caret");
  } finally { h.close(); }
});

test("blurred, read-only, non-text and block-selection contexts never request caret scrolling", () => {
  const h = harness();
  try {
    const check = () => { h.tracking.schedule(); h.flush(); assert.equal(h.messages.length, 0); };
    h.focus(false); check(); h.focus(true);
    h.editor.isEditable = false; check(); h.editor.isEditable = true;
    h.select(true); check(); h.select(false);
    h.editor.state.selection.empty = false; check(); h.editor.state.selection.empty = true;
    h.editor.state.selection.$head.parent.isTextblock = false; check();
  } finally { h.close(); }
});

test("wrapped lines update their actual vertical bounds and invalid coordinates cannot reach native layout", () => {
  const h = harness();
  try {
    h.coordinates.top = 900; h.coordinates.bottom = 928;
    h.tracking.schedule(); h.flush();
    assert.equal(h.messages.at(-1).payload.y, 920);
    assert.equal(h.messages.at(-1).payload.height, 28);
    h.coordinates.top = NaN;
    h.tracking.schedule(); h.flush();
    assert.equal(h.messages.filter(message => message.kind === "caret").length, 1);
  } finally { h.close(); }
});

test("destroying the editor cancels a queued report", () => {
  const h = harness();
  try {
    h.tracking.schedule(); h.editor.isDestroyed = true; h.emit("destroy"); h.flush();
    assert.equal(h.messages.length, 0);
  } finally { h.close(); }
});

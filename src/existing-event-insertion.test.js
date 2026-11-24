import test from 'node:test';
import assert from 'node:assert/strict';
import { insertionBookmark, insertionRange } from './existing-event-insertion.js';

test('picker remembers insertion location even after the editor loses focus', () => {
  const bookmark = insertionBookmark({ from: 31, to: 31, $from: { depth: 2 } });
  assert.deepEqual(insertionRange(bookmark), { from: 31, to: 31 });
});

test('picker remembers the selected range for conversion', () => {
  const bookmark = insertionBookmark({ from: 12, to: 28 });
  assert.deepEqual(insertionRange(bookmark), { from: 12, to: 28 });
});

test('Add Block event picker captures the original selection instead of a later caret position', () => {
  const atOpen = { from: 45, to: 45 };
  const pending = { ...insertionBookmark(atOpen), kind: 'insert' };
  atOpen.from = 90;
  atOpen.to = 90;
  assert.deepEqual(insertionRange(pending), { from: 45, to: 45 });
  assert.equal(pending.kind, 'insert');
});

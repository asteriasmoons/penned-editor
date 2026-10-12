import test from "node:test";
import assert from "node:assert/strict";
import { unwrapRetiredColumns } from "../src/retired-column-content.js";

test("retired columns unwrap in reading order without losing IDs, marks or custom blocks", () => {
  const left = { type: "paragraph", attrs: { id: "left" }, content: [{ type: "text", text: "Left", marks: [{ type: "bold" }] }] };
  const right = { type: "callout", attrs: { id: "right", icon: "sparkle", color: "#A970FF" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Right" }] }] };
  const input = [{ type: "columns", content: [{ type: "column", content: [left] }, { type: "column", content: [right] }] }];
  const original = structuredClone(input);
  assert.deepEqual(unwrapRetiredColumns(input), [left, right]);
  assert.deepEqual(input, original);
});

test("real page breaks and nested toggle content survive removal", () => {
  const paragraph = { type: "paragraph", content: [{ type: "text", text: "Nested text" }] };
  const pageBreak = { type: "pageBreak", attrs: { id: "break" } };
  const input = [{ type: "toggleItem", attrs: { open: true }, content: [{ type: "columns", content: [{ type: "column", content: [paragraph] }] }] }, pageBreak];
  assert.deepEqual(unwrapRetiredColumns(input), [{ type: "toggleItem", attrs: { open: true }, content: [paragraph] }, pageBreak]);
  assert.deepEqual(unwrapRetiredColumns([{ type: "columns" }]), []);
});

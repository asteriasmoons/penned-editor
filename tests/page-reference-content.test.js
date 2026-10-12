import test from "node:test";
import assert from "node:assert/strict";
import { normalizePageReferenceStarters } from "../src/page-reference-node.js";

const pageBreak = { type: "pageBreak", attrs: { id: "break" } };
const page = { type: "pageReference", attrs: { id: "reference", documentID: "child" } };
const empty = { type: "paragraph", attrs: { id: "starter" } };

test("legacy page-start slots are replaced by their page reference, preserving the real page break", () => {
  const before = { type: "paragraph", content: [{ type: "text", text: "Before" }] };
  const content = [before, pageBreak, empty, page];
  const result = normalizePageReferenceStarters(content);
  assert.deepEqual(result, [before, pageBreak, page]);
  assert.deepEqual(normalizePageReferenceStarters(result), result);
  assert.deepEqual(content, [before, pageBreak, empty, page]);
});

test("other empty lines, formatting, text, and inline content are not removed", () => {
  for (const paragraph of [
    { ...empty, attrs: { id: "indented", indent: 1 } },
    { ...empty, attrs: { id: "aligned", textAlign: "center" } },
    { ...empty, marks: [{ type: "bold" }] },
    { ...empty, content: [{ type: "hardBreak" }] },
    { ...empty, content: [{ type: "text", text: " " }] },
    { ...empty, content: [{ type: "text", text: "Actual content" }] },
  ]) {
    const content = [pageBreak, paragraph, page];
    assert.deepEqual(normalizePageReferenceStarters(content), content);
  }
  for (const content of [[empty, page], [pageBreak, empty, empty, page], [pageBreak, empty, { type: "callout" }]]) {
    assert.deepEqual(normalizePageReferenceStarters(content), content);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { inlineTextEdit } from "../src/incremental-nodes.js";

const schema = new Schema({ nodes: {
  doc: { content: "paragraph+" },
  paragraph: { content: "inline*", attrs: { id: { default: null } } },
  text: { group: "inline" },
  tag: { group: "inline", inline: true, atom: true },
} });
const paragraph = (...children) => schema.node("paragraph", { id: "block" }, children);
const state = (...children) => EditorState.create({ doc: schema.node("doc", null, children) });

test("inline insertions and deletes stay on the typing path", () => {
  const editor = state(paragraph(schema.text("abc")));
  assert.equal(inlineTextEdit(editor.tr.insertText("x", 2)), true);
  assert.equal(inlineTextEdit(editor.tr.delete(1, 2)), true);
  assert.equal(inlineTextEdit(editor.tr.insertText("", 1, 4)), true);
});

test("inline atoms, joins, splits and attribute edits keep the structural path", () => {
  const editor = state(paragraph(schema.text("a"), schema.node("tag"), schema.text("b")), paragraph(schema.text("cd")));
  assert.equal(inlineTextEdit(editor.tr.replaceWith(2, 3, schema.text("text"))), false);
  assert.equal(inlineTextEdit(editor.tr.insert(1, schema.node("tag"))), false);
  assert.equal(inlineTextEdit(editor.tr.join(5)), false);
  assert.equal(inlineTextEdit(editor.tr.split(2)), false);
  assert.equal(inlineTextEdit(editor.tr.setNodeAttribute(0, "id", "new")), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { PROPERTY_KINDS, normalizeProperty, propertyNumberValid, propertyText, propertyURL } from "../src/inline-properties.js";

test("property names are user-defined, not inferred from the property kind", () => {
  for (const { kind } of PROPERTY_KINDS) {
    assert.equal(normalizeProperty({ kind }).name, "");
    const named = normalizeProperty({ kind, name: "  Project status  " });
    assert.equal(named.name, "Project status");
    assert.equal(normalizeProperty({ ...named, kind: "text" }).name, "Project status");
  }
  assert.equal(normalizeProperty({ name: "Text" }).name, "Text");
  assert.equal(propertyText({ value: "Draft" }), "Draft");
});

test("all seven property kinds round-trip their full configuration", () => {
  for (const { kind } of PROPERTY_KINDS) {
    const property = normalizeProperty({
      kind, name: "Project", value: "42", checked: true, includeTime: true,
      options: [{ id: "one", name: "Ready", color: "#7359AD" }], selectedOptionIDs: ["one"],
      placeholder: "Choose", prefix: "$", suffix: " USD", minimum: "0", maximum: "100", step: "0.5", urlLabel: "Open",
    });
    assert.deepEqual(normalizeProperty(JSON.parse(JSON.stringify(property))), property);
  }
});

test("select IDs are unique, removed options cannot remain selected, and single select has one value", () => {
  const raw = {
    kind: "select", options: [{ id: "a", name: "Alpha", color: "#123456" }, { id: "b", name: "Beta" }, { id: "a", name: "Duplicate" }],
    selectedOptionIDs: ["missing", "a", "a", "b"],
  };
  assert.deepEqual(normalizeProperty(raw).selectedOptionIDs, ["a"]);
  assert.equal(normalizeProperty(raw).options.length, 2);
  assert.deepEqual(normalizeProperty({ ...raw, kind: "multiSelect" }).selectedOptionIDs, ["a", "b"]);
});

test("template select properties retain empty selections even when options exist", () => {
  for (const kind of ["select", "multiSelect"]) {
    for (const options of [[], [{ id: "ready", name: "Ready", color: "#52D273" }]]) {
      const property = normalizeProperty({ kind, name: "Status", options, selectedOptionIDs: [] });
      assert.deepEqual(property.selectedOptionIDs, []);
      assert.deepEqual(normalizeProperty(JSON.parse(JSON.stringify(property))), property);
    }
  }
});

test("URL buttons allow web links only, without credentials or control characters", () => {
  assert.equal(propertyURL("example.com/path"), "https://example.com/path");
  assert.equal(propertyURL("https://example.com"), "https://example.com/");
  for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///tmp/a", "https://user:secret@example.com", "", "https://exa\nmple.com"]) {
    assert.equal(propertyURL(url), null, url);
  }
});

test("number limits and fractional steps validate without losing decimal values", () => {
  const property = normalizeProperty({ kind: "number", minimum: "-1", maximum: "2", step: "0.1" });
  for (const value of ["", "-1", "0.3", "2"]) assert.equal(propertyNumberValid(property, value), true, value);
  for (const value of ["-", "NaN", "Infinity", "-1.1", "2.1", "0.35"]) assert.equal(propertyNumberValid(property, value), false, value);
});

test("property values remain searchable, and civil dates retain their literal calendar day", () => {
  assert.equal(propertyText({ kind: "checkbox", name: "Approved", checked: true }), "Approved: Checked");
  assert.equal(propertyText({ kind: "number", name: "Budget", value: "2.5", prefix: "$" }), "Budget: $2.5");
  assert.equal(propertyText({ kind: "multiSelect", name: "Tags", options: [{ id: "a", name: "Work" }], selectedOptionIDs: ["a"] }), "Tags: Work");
  assert.equal(normalizeProperty({ kind: "date", value: "2026-10-11" }).value, "2026-10-11");
});

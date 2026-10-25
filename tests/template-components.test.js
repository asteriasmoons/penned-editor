import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { componentDefinition, componentResponse } from "../src/template-components.js";

const kinds = ["rating", "singleSelect", "multiSelect", "slider"];
const runtimeDirectory = process.env.PENNED_EDITOR_RUNTIME
  ? pathToFileURL(resolve(process.env.PENNED_EDITOR_RUNTIME) + sep) : new URL("../dist/", import.meta.url);
const definition = kind => ({ kind, label: "How was your day?", minimum: kind === "slider" ? 0 : 1,
  maximum: kind === "slider" ? 100 : 5, step: 1, minimumLabel: "None", maximumLabel: "Maximum",
  choices: ["Great", "Good", "Okay", "Difficult"].map((label, index) => ({ id: "option-" + index, label })) });
const component = (kind, response = null) => ({ type: "templateComponent", attrs: { id: kind, definition: definition(kind), response } });
const paragraph = text => ({ type: "paragraph", attrs: { id: randomUUID() }, content: text ? [{ type: "text", text }] : [] });

async function runtime(content = kinds.map(kind => component(kind))) {
  const html = await readFile(new URL("tiptap.html", runtimeDirectory), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://penned.test" });
  const { window } = dom;
  const events = [];
  window.console.log = window.console.info = () => {};
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.crypto.randomUUID = randomUUID;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.scrollBy = () => {};
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  window.webkit = { messageHandlers: { tiptap: { postMessage(event) { events.push(JSON.parse(JSON.stringify(event))); } } } };
  for (const file of ["vendor/formula-parser.min.js", "table-formulas.js", "vellix-tables.js", "vendor/table-library.js", "tiptap.bundle.js"]) {
    window.eval(await readFile(new URL(file, runtimeDirectory), "utf8"));
  }
  const command = (name, args = {}) => window.tiptapCommand(name, args);
  await command("setContent", { document: { type: "doc", content } });
  const host = kind => window.document.querySelector(`.penned-template-component[data-vellix-block-id="${kind}"]`);
  return { window, events, command, host, editor: window.document.querySelector(".tiptap-editor").editor,
    json: async () => JSON.parse(JSON.stringify(await command("getDocument"))),
    click: (kind, index) => host(kind).querySelectorAll(".penned-component-choices button")[index].click(),
    close: () => window.close() };
}

test("component definitions reject invalid ranges and independently identify ordered choices", () => {
  assert.throws(() => componentDefinition({ ...definition("rating"), minimum: 5, maximum: 1 }));
  assert.throws(() => componentDefinition({ ...definition("rating"), maximum: 100000 }));
  assert.throws(() => componentDefinition({ ...definition("slider"), step: 0 }));
  assert.throws(() => componentDefinition({ ...definition("slider"), maximum: Infinity }));
  assert.throws(() => componentDefinition({ ...definition("slider"), minimum: 1e8, maximum: 1e9, step: Number.MIN_VALUE }));
  assert.throws(() => componentDefinition({ ...definition("singleSelect"), choices: [] }));
  assert.throws(() => componentDefinition({ ...definition("singleSelect"), choices: [{ id: "x", label: "One" }, { id: "x", label: "Two" }] }));
  assert.equal(componentResponse(definition("rating"), 99), null);
  assert.equal(componentResponse(definition("singleSelect"), "missing"), null);
  assert.deepEqual(componentResponse(definition("multiSelect"), ["option-3", "missing", "option-3", "option-0"]), ["option-0", "option-3"]);
  assert.equal(componentResponse({ ...definition("slider"), step: 5 }, 73), 75);
  assert.equal(componentResponse({ ...definition("slider"), maximum: 10, step: 3 }, 99), 9);
  assert.equal(componentResponse({ ...definition("slider"), maximum: 1, step: 0.1 }, 0.3), 0.3);
});

test("template-only creation, configuration, reordering and removal round-trip through the real editor bridge", async () => {
  const h = await runtime([paragraph("Permanent text")]);
  try {
    assert.equal(await h.command("templateComponentSave", { definition: definition("rating") }), false);
    await h.command("setTemplateEditing", { enabled: true });
    for (const kind of kinds) assert.equal(await h.command("templateComponentSave", { definition: definition(kind) }), true);
    let saved = await h.json();
    const nodes = saved.content.filter(node => node.type === "templateComponent");
    assert.equal(nodes.length, 4);
    assert.equal(new Set(nodes.map(node => node.attrs.id)).size, 4);
    const target = nodes.find(node => node.attrs.definition.kind === "singleSelect");
    const updated = { ...definition("singleSelect"), label: "Updated question", choices: [...definition("singleSelect").choices].reverse() };
    assert.equal(await h.command("templateComponentSave", { blockID: target.attrs.id, definition: updated }), true);
    await h.command("templateComponentMove", { blockID: target.attrs.id, direction: -1 });
    saved = await h.json();
    assert.deepEqual(saved.content.find(node => node.attrs?.id === target.attrs.id).attrs.definition, updated);
    await h.command("setContent", { document: saved });
    assert.deepEqual(await h.json(), saved);
    assert.equal(await h.command("templateComponentDelete", { blockID: target.attrs.id }), true);
    assert.equal((await h.json()).content.filter(node => node.type === "templateComponent").length, 3);
    assert(h.events.some(event => event.kind === "snapshot"));
    assert.equal(await h.command("templateComponentSave", { definition: { ...definition("slider"), step: 0 } }), false);
  } finally { h.close(); }
});

test("template controls reopen configuration without saving Daily Note answers", async () => {
  const h = await runtime();
  try {
    await h.command("setTemplateEditing", { enabled: true });
    const before = await h.json();
    h.click("rating", 3); h.click("singleSelect", 2); h.click("multiSelect", 1);
    assert.equal(h.events.filter(event => event.kind === "templateComponentConfigure").length, 3);
    assert.deepEqual(await h.json(), before);
    assert(h.host("slider").querySelector("input").disabled);
  } finally { h.close(); }
});

test("single and multi-select chips stay compact and bold while rating keeps its button sizing", async () => {
  const h = await runtime();
  try {
    for (const kind of ["singleSelect", "multiSelect"]) {
      const host = h.host(kind), button = host.querySelector(".penned-component-choices button");
      const style = element => h.window.getComputedStyle(element);
      assert.equal(style(host).marginTop, "6px");
      assert.equal(style(host).paddingTop, "0px");
      assert.equal(style(host.querySelector(".penned-component-choices")).gap, "6px");
      assert.equal(style(button).minHeight, "30px");
      assert.equal(style(button).paddingTop, "4px");
      assert.equal(style(button).paddingLeft, "12px");
      assert.equal(style(button).fontWeight, "700");
      h.click(kind, 0);
      assert.equal(style(button).fontWeight, "700", "Selected labels stay equally bold");
      assert.equal(button.getAttribute("aria-pressed"), "true");
    }
    const rating = h.host("rating");
    assert.equal(h.window.getComputedStyle(rating).marginTop, "6px");
    assert.equal(h.window.getComputedStyle(rating).paddingTop, "0px");
    assert.equal(h.window.getComputedStyle(rating.querySelector("button")).minHeight, "44px");
    const saved = await h.json();
    await h.command("setContent", { document: saved });
    assert.deepEqual(await h.json(), saved);
  } finally { h.close(); }
});

test("unlabeled ratings sit snugly below their paragraph in templates and notes without changing responses", async () => {
  const rating = component("rating"); rating.attrs.definition.label = "";
  const h = await runtime([paragraph("Your words will give meaning to the number."), rating]);
  try {
    for (const enabled of [true, false]) {
      await h.command("setTemplateEditing", { enabled });
      const host = h.host("rating"), style = h.window.getComputedStyle(host);
      assert.equal(style.marginTop, "6px");
      assert.equal(style.paddingTop, "0px");
      assert.equal(host.querySelector(".penned-component-question"), null);
      const buttonStyle = h.window.getComputedStyle(host.querySelector(".penned-component-choices button"));
      assert.equal(buttonStyle.paddingTop, "12px");
      assert.equal(buttonStyle.minHeight, "44px");
      assert.equal(buttonStyle.borderRadius, "10px");
    }
    h.click("rating", 3);
    const saved = await h.json();
    assert.equal(saved.content.find(node => node.attrs?.id === "rating").attrs.response, 4);
    await h.command("setContent", { document: saved });
    assert.deepEqual(await h.json(), saved);
    assert.equal(h.host("rating").querySelector('[aria-pressed="true"]').textContent, "4");
  } finally { h.close(); }
});

test("insertion leaves a collapsed text caret after the component instead of selecting its atom", async () => {
  for (const content of [[paragraph("A paragraph above the slider")], [paragraph("")],
    [{ type: "plainCallout", attrs: { id: "container", color: "#FFFFFF" }, content: [paragraph("Nested paragraph")] }]]) {
    const h = await runtime(content);
    try {
      await h.command("setTemplateEditing", { enabled: true });
      await h.command("focusDocumentEnd");
      assert.equal(await h.command("templateComponentSave", { definition: { ...definition("slider"), label: "" } }), true);
      await new Promise(resolve => h.window.requestAnimationFrame(() => h.window.requestAnimationFrame(resolve)));
      assert.equal(h.window.document.querySelectorAll(".penned-template-component.ProseMirror-selectednode").length, 0);
      assert(h.window.getSelection().isCollapsed, "Native selection must not wrap the new slider");
      const slider = h.window.document.querySelector(".penned-template-component");
      assert.equal(slider.nextElementSibling?.tagName, "P", "Typing continues after the inserted component");
      assert(slider.nextElementSibling.contains(h.window.getSelection().anchorNode));
      const saved = await h.json();
      await h.command("undo");
      assert.equal(h.window.document.querySelectorAll(".penned-template-component").length, 0);
      await h.command("redo");
      assert.deepEqual(await h.json(), saved);
    } finally { h.close(); }
  }
});

test("blank slider labels stay blank and unanswered sliders show no status while remaining configurable", async () => {
  const sliderNode = component("slider"); sliderNode.attrs.definition.label = "";
  const h = await runtime([paragraph("Energy level"), sliderNode]);
  try {
    await h.command("setTemplateEditing", { enabled: true });
    const saved = await h.json(), host = h.host("slider");
    assert.equal(host.querySelector(".penned-component-question"), null);
    assert(!host.textContent.includes("Slider"));
    assert(!host.textContent.includes("Not set"));
    assert(host.querySelector("output").hidden);
    host.querySelector('.penned-component-configure[aria-label="Configure Slider"]').click();
    assert.equal(h.events.filter(event => event.kind === "templateComponentConfigure").length, 1);
    assert.deepEqual(await h.json(), saved);
    await h.command("setEditable", { editable: false });
    assert(host.querySelector(".penned-component-configure").disabled);
    await h.command("setEditable", { editable: true });
    await h.command("setTemplateEditing", { enabled: false });
    assert.equal(host.querySelector(".penned-component-configure"), null);
    assert(host.querySelector("output").hidden);
    const range = host.querySelector("input");
    range.value = "45"; range.dispatchEvent(new h.window.Event("input", { bubbles: true }));
    range.dispatchEvent(new h.window.Event("change", { bubbles: true }));
    assert(!host.querySelector("output").hidden);
    assert.equal(host.querySelector("output").textContent, "45");
    const answered = await h.json();
    await h.command("setContent", { document: answered });
    assert.deepEqual(await h.json(), answered);
    assert.equal(h.host("slider").querySelector("output").textContent, "45");
  } finally { h.close(); }
});

test("all four Daily Note responses save immediately, reopen exactly, and remain independent across documents", async () => {
  const h = await runtime([paragraph("Ordinary text beside components"), ...kinds.map(kind => component(kind)), { type: "plainCallout", attrs: { id: "callout", color: "#FF5EAB" }, content: [paragraph("Preserved callout")] }]);
  try {
    const original = await h.json();
    h.click("rating", 3);
    h.click("singleSelect", 3); h.click("singleSelect", 1);
    h.click("multiSelect", 0); h.click("multiSelect", 2); h.click("multiSelect", 0);
    const slider = h.host("slider").querySelector("input");
    for (const value of [10, 30, 70]) {
      slider.value = String(value); slider.dispatchEvent(new h.window.Event("input", { bubbles: true }));
      assert.equal(h.host("slider").querySelector("input"), slider, "Dragging must not recreate the slider");
    }
    slider.dispatchEvent(new h.window.Event("change", { bubbles: true }));
    const first = await h.json();
    const responses = Object.fromEntries(first.content.filter(node => node.type === "templateComponent").map(node => [node.attrs.id, node.attrs.response]));
    assert.deepEqual(responses, { rating: 4, singleSelect: "option-1", multiSelect: ["option-2"], slider: 70 });
    assert.equal(h.host("singleSelect").querySelectorAll(".is-selected").length, 1);
    assert.equal(h.events.filter(event => event.kind === "templateComponentConfigure").length, 0);
    assert(h.events.filter(event => event.kind === "snapshot").length >= 7);
    await h.command("setContent", { document: original });
    h.click("rating", 1);
    const second = await h.json();
    assert.equal(second.content.find(node => node.attrs?.id === "rating").attrs.response, 2);
    await h.command("setContent", { document: first });
    assert.deepEqual(await h.json(), first);
    assert.equal(h.host("rating").querySelectorAll(".is-selected")[0].textContent, "4");
    assert.equal(h.host("slider").querySelector("input").value, "70");
    assert.equal(h.host("slider").querySelector("output").textContent, "70");
    assert.deepEqual(first.content[0], original.content[0]);
    assert.deepEqual(first.content.at(-1), original.content.at(-1));
  } finally { h.close(); }
});

test("read-only and block-selection modes never save responses or open configuration", async () => {
  const h = await runtime();
  try {
    const saved = await h.json();
    await h.command("setEditable", { editable: false });
    h.click("rating", 1);
    assert(h.host("slider").querySelector("input").disabled);
    assert.deepEqual(await h.json(), saved);
    await h.command("setEditable", { editable: true });
    await h.command("setSelectionMode", { mode: "multi" });
    h.click("singleSelect", 1);
    assert.deepEqual(await h.json(), saved);
    assert.equal(h.events.filter(event => event.kind === "templateComponentConfigure").length, 0);
  } finally { h.close(); }
});

test("component alignment and indentation follow document block attributes after updates", async () => {
  const h = await runtime([component("singleSelect")]);
  try {
    const saved = await h.json();
    saved.content[0].attrs.textAlign = "center";
    saved.content[0].attrs.indent = 2;
    await h.command("setContent", { document: saved });
    assert.equal(h.host("singleSelect").dataset.vellixIndent, "2");
    assert.equal(h.host("singleSelect").style.textAlign, "center");
    assert.equal(h.host("singleSelect").querySelector(".penned-component-choices").style.justifyContent, "center");
    assert.deepEqual(await h.json(), saved);
  } finally { h.close(); }
});

test("a slider gesture suppresses ancestor block dragging only until the pointer ends", async () => {
  const h = await runtime([{ type: "plainCallout", attrs: { id: "parent", color: "#FFFFFF" }, content: [component("slider")] }]);
  try {
    const parent = h.window.document.querySelector('[data-vellix-block-id="parent"]');
    parent.draggable = true;
    const slider = h.host("slider").querySelector("input");
    slider.dispatchEvent(new h.window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    const drag = new h.window.Event("dragstart", { bubbles: true, cancelable: true });
    parent.dispatchEvent(drag);
    assert(drag.defaultPrevented);
    h.window.document.dispatchEvent(new h.window.Event("pointerup", { bubbles: true }));
    const regularDrag = new h.window.Event("dragstart", { bubbles: true, cancelable: true });
    parent.dispatchEvent(regularDrag);
    assert(!regularDrag.defaultPrevented);
    slider.dispatchEvent(new h.window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    slider.dispatchEvent(new h.window.MouseEvent("pointerup", { bubbles: true, button: 0 }));
    const saved = await h.json();
    assert.equal(saved.content[0].content[0].attrs.response, 0, "Tapping an unanswered slider at its minimum must save that answer");
  } finally { h.close(); }
});

function touchEvent(h, target, type, { x = 30, y = 30, touches = 1, cancelable = true } = {}) {
  const event = new h.window.Event(type, { bubbles: true, cancelable });
  const point = { identifier: 7, clientX: x, clientY: y };
  Object.defineProperties(event, {
    touches: { value: type === "touchend" || type === "touchcancel" ? [] : Array.from({ length: touches }, (_, index) => ({ ...point, identifier: 7 + index })) },
    changedTouches: { value: [point] }
  });
  target.dispatchEvent(event);
  return event;
}

function idleEditor(h) {
  const outside = h.window.document.createElement("button");
  h.window.document.body.appendChild(outside); outside.focus();
  h.events.length = 0;
}

for (const kind of kinds) {
  test(`${kind}: component surfaces and controls never place a caret or enter document editing`, async () => {
    const h = await runtime([paragraph("Keep typing here"), component(kind), paragraph("After")]);
    try {
      idleEditor(h);
      const host = h.host(kind), selection = h.editor.state.selection.toJSON();
      let editorMouseEvents = 0;
      h.editor.view.setProps({ handleDOMEvents: { mousedown: () => { editorMouseEvents++; return false; } } });
      for (const target of [host, host.querySelector(".penned-component-question"), host.querySelector("button,input")]) {
        const range = target.matches('input[type="range"]');
        const mouse = new h.window.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
        target.dispatchEvent(mouse);
        assert.equal(mouse.defaultPrevented, !range, "Only native slider interaction keeps its default behavior");
        touchEvent(h, target, "touchstart");
        const end = touchEvent(h, target, "touchend");
        assert.equal(end.defaultPrevented, !range);
        assert.deepEqual(h.editor.state.selection.toJSON(), selection);
        assert.equal(h.editor.view.hasFocus(), false);
      }
      assert.equal(editorMouseEvents, 0, "No component surface reaches ProseMirror caret handling");
      assert.equal(h.events.some(event => event.kind === "focus" && event.payload.focused), false);
      if (kind !== "slider") assert.notEqual((await h.json()).content[1].attrs.response, null);
    } finally { h.close(); }
  });

  test(`${kind}: scrolling or cancelled touches never activate controls or focus the editor`, async () => {
    const h = await runtime([paragraph("Keep"), component(kind)]);
    try {
      idleEditor(h);
      const before = await h.json(), target = h.host(kind).querySelector("button,input");
      assert.equal(touchEvent(h, target, "touchstart").defaultPrevented, false);
      assert.equal(touchEvent(h, target, "touchmove", { y: 100 }).defaultPrevented, false);
      assert.equal(touchEvent(h, target, "touchend", { y: 100 }).defaultPrevented, false);
      touchEvent(h, target, "touchstart");
      touchEvent(h, target, "touchcancel");
      touchEvent(h, target, "touchend");
      assert.deepEqual(await h.json(), before);
      assert.equal(h.editor.view.hasFocus(), false);
      assert.equal(h.events.some(event => event.kind === "focus" && event.payload.focused), false);
    } finally { h.close(); }
  });
}

test("completed choice taps save once even if WebKit follows with a compatibility click", async () => {
  const h = await runtime();
  try {
    for (const kind of ["rating", "singleSelect", "multiSelect"]) {
      idleEditor(h);
      const target = h.host(kind).querySelector("button");
      touchEvent(h, target, "touchstart"); touchEvent(h, target, "touchend");
      const selected = await h.json();
      const compatibility = new h.window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
      target.dispatchEvent(compatibility);
      assert(compatibility.defaultPrevented);
      assert.deepEqual(await h.json(), selected);
      assert.equal(h.events.filter(event => event.kind === "snapshot").length, 1);
      assert.equal(h.editor.view.hasFocus(), false);
    }
  } finally { h.close(); }
});

test("a real mouse or trackpad interaction immediately after touch is not discarded as a compatibility click", async () => {
  const h = await runtime();
  try {
    const target = h.host("multiSelect").querySelector("button");
    touchEvent(h, target, "touchstart"); touchEvent(h, target, "touchend");
    assert.equal(target.getAttribute("aria-pressed"), "true");
    const down = new h.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(down, "pointerType", { value: "mouse" });
    target.dispatchEvent(down);
    target.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    assert.equal(target.getAttribute("aria-pressed"), "false");
    assert.equal(h.events.filter(event => event.kind === "snapshot").length, 2);
  } finally { h.close(); }
});

test("slider value is centered and bold below the track on the endpoint row, including after reload", async () => {
  const h = await runtime([component("slider", 3)]);
  try {
    for (let reload = 0; reload < 2; reload++) {
      const host = h.host("slider"), output = host.querySelector("output"), footer = host.querySelector(".penned-component-endpoints");
      assert.equal(output.parentElement, footer);
      assert.equal(footer.previousElementSibling, host.querySelector("input"));
      assert.equal(footer.children[1], output);
      assert.equal(output.textContent, "3");
      assert.equal(h.window.getComputedStyle(output).fontWeight, "700");
      assert.equal(h.window.getComputedStyle(output).textAlign, "center");
      assert.equal(h.window.getComputedStyle(footer).display, "grid");
      assert.equal(h.window.getComputedStyle(host.querySelector("input")).marginTop, "0px");
      assert.equal(h.window.getComputedStyle(host).userSelect, "none");
      await h.command("setContent", { document: await h.json() });
    }
  } finally { h.close(); }
});

test("range input remains native, preserves its identity throughout dragging and never focuses document text", async () => {
  const h = await runtime([paragraph("Keep"), component("slider")]);
  try {
    idleEditor(h);
    const slider = h.host("slider").querySelector("input"), selection = h.editor.state.selection.toJSON();
    slider.focus();
    const down = new h.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    slider.dispatchEvent(down);
    assert.equal(down.defaultPrevented, false);
    for (const value of [1, 2, 3]) {
      slider.value = String(value); slider.dispatchEvent(new h.window.Event("input", { bubbles: true }));
      assert.equal(h.host("slider").querySelector("input"), slider);
    }
    slider.dispatchEvent(new h.window.Event("change", { bubbles: true }));
    assert.equal((await h.json()).content[1].attrs.response, 3);
    assert.deepEqual(h.editor.state.selection.toJSON(), selection);
    assert.equal(h.window.document.activeElement, slider);
    assert.equal(h.editor.view.hasFocus(), false);
    assert.equal(h.events.some(event => event.kind === "focus" && event.payload.focused), false);
  } finally { h.close(); }
});

test("template configuration uses the same focus-safe component taps for every kind without writing responses", async () => {
  const h = await runtime();
  try {
    await h.command("setTemplateEditing", { enabled: true });
    const before = await h.json();
    for (const kind of kinds) {
      idleEditor(h);
      const target = h.host(kind).querySelector(kind === "slider" ? ".penned-component-configure" : ".penned-component-choices button");
      touchEvent(h, target, "touchstart"); touchEvent(h, target, "touchend");
      assert.equal(h.events.filter(event => event.kind === "templateComponentConfigure").length, 1);
      assert.equal(h.editor.view.hasFocus(), false);
    }
    assert.deepEqual(await h.json(), before);
  } finally { h.close(); }
});

test("component taps do not disturb an existing caret and ordinary typing still works afterwards", async () => {
  const h = await runtime([paragraph("Ordinary text"), ...kinds.map(kind => component(kind))]);
  try {
    h.editor.view.focus(); h.editor.commands.setTextSelection(4);
    const selection = h.editor.state.selection.toJSON();
    for (const kind of ["rating", "singleSelect", "multiSelect"]) {
      const target = h.host(kind).querySelector("button");
      target.dispatchEvent(new h.window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      target.click();
      assert.deepEqual(h.editor.state.selection.toJSON(), selection);
      assert.equal(h.editor.view.hasFocus(), true);
    }
    h.editor.commands.insertContent(" works");
    assert.equal(h.editor.state.doc.firstChild.textContent, "Ord worksinary text");
  } finally { h.close(); }
});

test("component selection mode stays authoritative and read-only taps do not write answers", async () => {
  const h = await runtime();
  try {
    const before = await h.json();
    for (const command of ["setEditable", "setSelectionMode"]) {
      await h.command(command, command === "setEditable" ? { editable: false } : { mode: "multi" });
      for (const kind of kinds) {
        const target = h.host(kind).querySelector("button,input");
        touchEvent(h, target, "touchstart"); touchEvent(h, target, "touchend");
      }
      assert.deepEqual(await h.json(), before);
      await h.command("setEditable", { editable: true });
    }
  } finally { h.close(); }
});

test("destroy removes the component-local touch and focus listeners", async () => {
  const h = await runtime();
  try {
    const host = h.host("singleSelect");
    h.editor.destroy();
    const mouse = new h.window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
    host.dispatchEvent(mouse);
    assert.equal(mouse.defaultPrevented, false);
    touchEvent(h, host, "touchstart");
    assert.equal(touchEvent(h, host, "touchend").defaultPrevented, false);
  } finally { h.close(); }
});

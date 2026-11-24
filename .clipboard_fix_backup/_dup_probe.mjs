import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";

const card = {
  type: "informationCard",
  attrs: { id: "card-orig", titleColor: "#39D8C2", backgroundColor: "#101018", padding: 28, cornerRadius: 24 },
  content: [
    { type: "informationCardTitle", attrs: { id: "t-orig" }, content: [{ type: "text", text: "Probe Title" }] },
    { type: "informationCardDescription", attrs: { id: "d-orig" }, content: [{ type: "text", text: "Desc" }] },
    { type: "informationCardBody", attrs: { id: "b-orig" }, content: [
      { type: "informationCardLabel", content: [{ type: "text", marks: [{ type: "bold" }], text: "My Label" }] },
      { type: "paragraph", attrs: { id: "p-orig" }, content: [{ type: "text", text: "Value" }] },
      { type: "divider", attrs: { id: "div-orig", style: "thinLine" } },
    ] },
  ],
};
const trailing = { type: "paragraph", attrs: { id: "trail" }, content: [{ type: "text", text: "after" }] };

const dom = new JSDOM("<!doctype html><html><body><div id='editor'></div></body></html>",
  { runScripts: "outside-only", pretendToBeVisual: true, url: "https://penned.test" });
const { window } = dom;
window.console.log = window.console.info = window.console.warn = window.console.error = () => {};
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.HTMLMediaElement.prototype.pause = window.HTMLMediaElement.prototype.load = () => {};
const events = [];
window.webkit = { messageHandlers: { tiptap: { postMessage(m) { events.push(JSON.parse(JSON.stringify(m))); } } } };
window.crypto.randomUUID = randomUUID;
window.scrollBy = () => {};
window.Range.prototype.getClientRects = () => [];
window.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
const holds = new Map();
const _set = window.setTimeout.bind(window), _clr = window.clearTimeout.bind(window);
let nextTimer = -1;
window.setTimeout = (cb, delay, ...a) => { if (![400, 500, 550].includes(delay)) return _set(cb, delay, ...a); const id = nextTimer--; holds.set(id, cb); return id; };
window.clearTimeout = id => { holds.delete(id); _clr(id); };
const fireHolds = () => { for (const [id, cb] of [...holds]) { holds.delete(id); cb(); } };

const base = new URL("file:///Users/asteriasmoons/Desktop/penned-editor/dist/");
for (const f of ["vendor/formula-parser.min.js", "table-formulas.js", "vellix-tables.js", "vendor/table-library.js", "tiptap.bundle.js"]) {
  window.eval(await readFile(new URL(f, base), "utf8"));
}
const command = (name, args = {}) => window.tiptapCommand(name, args);

try {
  await command("setContent", { document: { type: "doc", content: [card, trailing] } });

  const el = window.document.querySelector(".penned-information-card");
  const pd = new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20 });
  for (const [k, v] of Object.entries({ pointerId: 1, isPrimary: true, pointerType: "touch" })) Object.defineProperty(pd, k, { value: v });
  el.dispatchEvent(pd);
  fireHolds();
  const pu = new window.MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20 });
  for (const [k, v] of Object.entries({ pointerId: 1, isPrimary: true, pointerType: "touch" })) Object.defineProperty(pu, k, { value: v });
  el.dispatchEvent(pu);

  const dupResult = await command("duplicateSelectedBlocks");
  const doc = JSON.parse(JSON.stringify(await command("getDocument")));

  const cards = doc.content.filter(n => n.type === "informationCard");
  const idsOf = node => { const ids = []; const walk = n => { if (n.attrs?.id) ids.push(n.attrs.id); (n.content || []).forEach(walk); }; walk(node); return ids; };
  const out = { dupResult, cardCount: cards.length, docTypes: doc.content.map(n => n.type) };
  if (cards.length === 2) {
    const a = idsOf(cards[0]), b = idsOf(cards[1]);
    out.sharedIds = a.filter(x => b.includes(x));
    out.dupAllUnique = new Set(b).size === b.length;
    out.settingsMatch = cards[0].attrs.titleColor === cards[1].attrs.titleColor
      && cards[0].attrs.backgroundColor === cards[1].attrs.backgroundColor
      && cards[0].attrs.padding === cards[1].attrs.padding
      && cards[0].attrs.cornerRadius === cards[1].attrs.cornerRadius;
    out.dupChildKinds = (() => { const k = []; const walk = n => { k.push(n.type); (n.content || []).forEach(walk); }; walk(cards[1]); return k; })();
  }
  console.log(JSON.stringify(out, null, 2));
} finally {
  window.close();
}

import { readFile, writeFile, cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "acorn";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.resolve(root, "../Vellix/Vellix/VellixEditor.bundle");
const file = path.join(bundle, "tiptap.bundle.js");
let source = await readFile(file, "utf8");
const originalSource = source;

// Generated bundles can contain older side-effect imports. Keep the maintained
// external modules authoritative instead of letting embedded copies replace them.
const moduleNames = new Set(["VellixTableLibrary", "VellixTableFormulas", "VellixTables"]);
function assignedModules(node, names = new Set()) {
  if (!node || typeof node !== "object") return names;
  if (node.type === "AssignmentExpression" && node.left.type === "MemberExpression" && !node.left.computed && moduleNames.has(node.left.property.name)) {
    names.add(node.left.property.name);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => assignedModules(child, names));
    else if (value && typeof value === "object") assignedModules(value, names);
  }
  return names;
}
const ast = parse(source, { ecmaVersion: "latest" });
const outer = ast.body.find(node => node.type === "ExpressionStatement" && node.expression.type === "CallExpression" && node.expression.callee.body?.type === "BlockStatement");
const embedded = (outer?.expression.callee.body.body || []).filter(node => assignedModules(node).size);
if (embedded.length) {
  const found = new Set();
  for (const node of embedded) {
    const names = assignedModules(node);
    if (node.type !== "ExpressionStatement" || names.size !== 1) throw new Error("Table modules are no longer isolated statements; refusing to remove unrelated code.");
    const name = [...names][0];
    if (found.has(name)) throw new Error(`Duplicate embedded table module: ${name}`);
    found.add(name);
  }
  if (found.size !== moduleNames.size) throw new Error("The embedded table modules are incomplete; refusing a partial replacement.");
  for (const node of embedded.sort((a, b) => b.start - a.start)) source = source.slice(0, node.start) + source.slice(node.end);
}

// Exact hooks into the existing shipped artifact, not a build or a replacement editor.
function replaceOnce(old, replacement) {
  if (source.split(old).length !== 2) throw new Error(`The shipped runtime changed; refusing to patch marker: ${old}`);
  source = source.replace(old, replacement);
}
if (!source.includes("window.VellixTables.createExtensions")) {
  replaceOnce("extensions:[window.VellixStructuredPlaceholders.createExtension", "extensions:[...window.VellixTables.createExtensions({Node:K,Extension:W,Plugin:z,PluginKey:V,Decoration:se,DecorationSet:G,TextSelection:L,post:Q,selectionActive:()=>q!==\"off\",modules:{\"prosemirror-state\":{Plugin:z,PluginKey:V,TextSelection:L,NodeSelection:P,Selection:H,SelectionRange:Ir},\"prosemirror-model\":{Fragment:M,Slice:I,DOMSerializer:Ve},\"prosemirror-view\":{Decoration:se,DecorationSet:G},\"prosemirror-transform\":{Transform:tn},\"prosemirror-keymap\":{keydownHandler:Ns}}}),window.VellixStructuredPlaceholders.createExtension");
  replaceOnce('{key:"heading1",title:"H1"', '{key:"table",title:"Table",detail:"Rows, columns and formulas",icon:"blackcal"},{key:"heading1",title:"H1"');
  replaceOnce("function ta(t,e=null){", 'function ta(t,e=null){if(t==="table"){if(e)v.chain().deleteRange(e).run();return window.VellixTables.command("requestInsert")}');
  replaceOnce("window.VellixStructuredPlaceholders.initialize(v);", "window.VellixStructuredPlaceholders.initialize(v);window.VellixTables.initialize(v);");
}
if (source !== originalSource) await writeFile(file, source);
const htmlFile = path.join(bundle, "tiptap.html");
let html = await readFile(htmlFile, "utf8");
if (!html.includes("./vellix-tables.js")) {
  const marker = '<script src="./tiptap.bundle.js"></script>';
  if (html.split(marker).length !== 2) throw new Error("The shipped HTML changed; refusing to replace it.");
  html = html.replace(marker, '<link rel="stylesheet" href="./vellix-tables.css" />\n    <script src="./vendor/formula-parser.min.js"></script>\n    <script src="./table-formulas.js"></script>\n    <script src="./vellix-tables.js"></script>\n    <script src="./vendor/table-library.js"></script>\n    ' + marker);
  await writeFile(htmlFile, html);
}
await mkdir(path.join(bundle, "vendor"), { recursive: true });
await cp(path.join(root, "src/vendor"), path.join(bundle, "vendor"), { recursive: true });
for (const name of ["table-formulas.js", "vellix-tables.js", "vellix-tables.css"]) {
  await cp(path.join(root, "src", name), path.join(bundle, name));
}
console.log("Installed the maintained table modules and exact shipped-editor hooks. No build was run.");

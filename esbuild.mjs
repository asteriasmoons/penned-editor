import esbuild from "esbuild";
import { copyFile, mkdir, rm, cp, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, "dist");
const isWatch = process.argv.includes("--watch");

const options = {
  entryPoints: { "tiptap.bundle": resolve(root, "src", "editor.js"), "code-syntax": resolve(root, "src", "code-syntax.js") },
  outdir: dist,
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "iife",
  target: ["safari15"],
  logLevel: "info",
  banner: {
    js: "/* Vellix TipTap bundle. Regenerate with `npm run build` from Vellix-backend. */",
  },
};

async function prepareDist() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  let html = await readFile(resolve(root, "src", "tiptap.html"), "utf8");
  const widgetLayout = JSON.parse(await readFile(resolve(root, "src", "document-widget-layout.json"), "utf8"));
  html = html.replace("__PENNED_WIDGET_LAYOUT__", JSON.stringify(widgetLayout));
  await copyFile(resolve(root, "src", "document-widget-layout.json"), resolve(dist, "document-widget-layout.json"));
  const grainName = "label-grain-light.png";
  const grain = await readFile(resolve(root, "src", grainName));
  // The inline WKWebView document and exports must not depend on a file request.
  html = html.replaceAll(`"./${grainName}"`, `"data:image/png;base64,${grain.toString("base64")}"`);
  await writeFile(resolve(dist, grainName), grain);
  await writeFile(resolve(dist, "tiptap.html"), html);
  await cp(resolve(root, "src", "fonts"), resolve(dist, "fonts"), { recursive: true });
  await cp(resolve(root, "src", "vendor"), resolve(dist, "vendor"), { recursive: true });
  await copyFile(resolve(root, "node_modules", "prismjs", "LICENSE"), resolve(dist, "Prism-LICENSE.txt"));
  for (const name of ["document-widgets.js", "mood-bar.js", "countdown-widget.js", "calculator-widget.js", "table-formulas.js", "vellix-tables.js", "vellix-tables.css", "text-gradient-paint.js", "code-block-catalog.json"]) {
    await copyFile(resolve(root, "src", name), resolve(dist, name));
  }
}

if (isWatch) {
  await prepareDist();
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[tiptap] watching for changes...");
} else {
  await prepareDist();
  await esbuild.build(options);
  console.log(`[tiptap] wrote ${resolve(dist, "tiptap.bundle.js")}`);
}

import esbuild from "esbuild";
import { copyFile, mkdir, rm, cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, "dist");
const isWatch = process.argv.includes("--watch");

const options = {
  entryPoints: [resolve(root, "src", "editor.js")],
  outfile: resolve(dist, "tiptap.bundle.js"),
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
  await copyFile(resolve(root, "src", "tiptap.html"), resolve(dist, "tiptap.html"));
  await cp(resolve(root, "src", "vendor"), resolve(dist, "vendor"), { recursive: true });
  for (const name of ["table-formulas.js", "vellix-tables.js", "vellix-tables.css", "text-gradient-paint.js"]) {
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

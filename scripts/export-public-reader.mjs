import { readFile, writeFile, mkdir, readdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import postcss from "postcss";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), args = process.argv.slice(2);
const site = args.includes("--site") ? resolve(args[args.indexOf("--site") + 1]) : null;
const app = args.includes("--app") ? resolve(args[args.indexOf("--app") + 1]) : null;
if (!site || !app) throw new Error("Provide --site <Penned-Site> and --app <Vellix project>");
const vendor = join(site, "vendor/penned-reader"), assets = join(site, "public/viewer-assets");
await mkdir(vendor, { recursive: true }); await mkdir(join(assets, "icons"), { recursive: true });
const manifest = {};
const sourceIcons = await readFile(join(app, "Vellix/Editor/PrecomputedTipTapIconData.swift"), "utf8");
const cached = new Map([...sourceIcons.matchAll(/^\s*"([^"]+)": "([A-Za-z\d+/=]+)",?$/gm)].map(match => [match[1], Buffer.from(match[2], "base64")]));
const catalogue = join(app, "Vellix/Assets.xcassets");
for (const name of (await readdir(catalogue)).filter(name => name.endsWith(".imageset")).sort()) {
  const icon = name.slice(0, -9), directory = join(catalogue, name);
  const contents = JSON.parse(await readFile(join(directory, "Contents.json"), "utf8"));
  const filename = contents.images?.find(image => image.filename)?.filename;
  if (!filename) continue;
  const source = join(directory, filename), bytes = cached.get(icon) || await readFile(source);
  const key = createHash("sha256").update(icon).update(bytes).digest("hex").slice(0, 24) + ".png";
  const destination = join(assets, "icons", key);
  if (cached.has(icon)) await writeFile(destination, cached.get(icon));
  else {
    try { await readFile(destination); }
    catch { execFileSync("sips", ["-s", "format", "png", "-Z", ["moonzs", "rainbowclouds"].includes(icon) ? "512" : "128", source, "--out", destination], { stdio: "pipe" }); }
  }
  manifest[icon] = `/viewer-assets/icons/${key}`;
}
const symbolManifest = join(tmpdir(), `penned-symbols-${process.pid}.json`);
execFileSync("swift", [join(root, "scripts/export-symbol-icons.swift"), join(app, "Vellix/Resources/SFSymbolCatalog.json"), join(assets, "symbols"), symbolManifest], { stdio: "pipe" });
Object.assign(manifest, JSON.parse(await readFile(symbolManifest, "utf8")));
await rm(symbolManifest);
await writeFile(join(vendor, "icons.json"), JSON.stringify(manifest));
const html = await readFile(join(root, "src/tiptap.html"), "utf8");
const extracted = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!extracted) throw new Error("The native editor stylesheet could not be found");
const css = postcss.parse(extracted + "\n" + await readFile(join(root, "src/vellix-tables.css"), "utf8"));
css.walkRules(rule => {
  if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
  rule.selectors = rule.selectors.map(selector => selector === ":root" ? ".penned-document" : `.penned-document ${selector}`);
});
css.walkDecls(declaration => {
  declaration.value = declaration.value.replace(/url\((["']?)vellix-icon:\/\/asset\/([^?'"\)]+)[^)]*\)/g,
    (_, quote, name) => `url(${JSON.stringify(manifest[decodeURIComponent(name)] || manifest.linedpages)})`);
});
await writeFile(join(assets, "editor.css"), "/* Generated from Penned's native editor CSS. Run export-public-reader.mjs. */\n" + css.toString());
await build({ entryPoints: [join(root, "src/public-document.js")], outfile: join(vendor, "index.mjs"), bundle: true,
  format: "esm", platform: "node", target: "node22", external: ["@tiptap/*"],
  banner: { js: '/* Generated from penned-editor/src/public-document.js. */\nimport {createRequire as readerRequire} from "node:module"; const require = readerRequire(import.meta.url);' },
  sourcemap: false, minify: false });
await copyFile(join(root, "src/public-document.d.ts"), join(vendor, "index.d.mts"));
await writeFile(join(vendor, "source.json"), JSON.stringify({ source: "penned-editor/src/public-document.js", icons: Object.keys(manifest).length,
  rendererSHA256: createHash("sha256").update(await readFile(join(root, "src/public-document.js"))).digest("hex"),
  cssSHA256: createHash("sha256").update(css.toString()).digest("hex") }, null, 2) + "\n");
console.log(`Exported the real Penned reader, native CSS and ${Object.keys(manifest).length} asset icons to ${site}`);

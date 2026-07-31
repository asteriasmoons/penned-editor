// Copies the freshly built `dist/` into the iOS app's VellixEditor.bundle so
// the compiled editor and this source never drift apart again.
//
// Runs automatically after `npm run build`. Assumes the Xcode project lives in
// a sibling folder: ../Vellix/Vellix/VellixEditor.bundle
// Override with:  VELLIX_BUNDLE_DIR=/absolute/path npm run build

import { cp, rm, stat, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const bundle =
  process.env.VELLIX_BUNDLE_DIR ??
  path.resolve(root, "..", "Vellix", "Vellix", "VellixEditor.bundle");

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

if (!(await isDir(dist))) {
  console.error(`[sync-bundle] No dist/ found at ${dist}. Did the build run?`);
  process.exit(1);
}

if (!(await isDir(bundle))) {
  console.error(
    `[sync-bundle] Bundle folder not found at:\n  ${bundle}\n` +
      `Set VELLIX_BUNDLE_DIR to the correct path and rebuild. Skipping copy.`,
  );
  process.exit(1);
}

// Replace the bundle's contents with the new build.
for (const entry of await readdir(bundle)) {
  await rm(path.join(bundle, entry), { recursive: true, force: true });
}
await cp(dist, bundle, { recursive: true });

console.log(`[sync-bundle] Copied dist/ -> ${bundle}`);

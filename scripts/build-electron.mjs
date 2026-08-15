// Bundles electron/main.ts and electron/preload.ts into electron/dist/*.cjs.
// Kept separate from the app's own (Lovable-managed) vite.config.ts on purpose —
// the renderer build and the Electron main/preload build have nothing to do
// with each other and shouldn't share config.
import { build, context } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyFileSync, mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
  outdir: path.join(root, "electron", "dist"),
  outExtension: { ".js": ".cjs" },
};

const entries = [
  { entryPoints: [path.join(root, "electron", "main.ts")], ...shared },
  { entryPoints: [path.join(root, "electron", "preload.ts")], ...shared },
  { entryPoints: [path.join(root, "electron", "tab-preload.ts")], ...shared },
];

// sql.js's WASM binary (used by password-import.ts to read Chrome/Edge's
// "Login Data" SQLite file) isn't something esbuild can inline into the
// bundle — it's loaded at runtime via fs.readFileSync, so it just needs to
// sit next to main.cjs. Copied on every build, not just once, so it never
// silently goes stale after a `npm update`.
function copyWasm() {
  const outDir = path.join(root, "electron", "dist");
  mkdirSync(outDir, { recursive: true });
  copyFileSync(path.join(root, "node_modules", "sql.js", "dist", "sql-wasm.wasm"), path.join(outDir, "sql-wasm.wasm"));
}

async function run() {
  copyWasm();
  if (watch) {
    const ctxs = await Promise.all(entries.map((cfg) => context(cfg)));
    await Promise.all(ctxs.map((ctx) => ctx.watch()));
    console.log("[electron] watching main.ts + preload.ts + tab-preload.ts for changes...");
  } else {
    await Promise.all(entries.map((cfg) => build(cfg)));
    console.log("[electron] built electron/dist/main.cjs + preload.cjs + tab-preload.cjs");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

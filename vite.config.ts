// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Overrides the Cloudflare Workers target with Nitro's plain Node.js
  // server preset — needed so `npm run build` produces a self-contained
  // Node HTTP server (electron/main.ts spawns this in the packaged app to
  // serve the chrome UI locally, see the "Production packaging" comment
  // there) instead of a Cloudflare-only bundle Electron can't run at all.
  //
  // Per this package's own type comment, preset overrides only apply
  // OUTSIDE a Lovable-hosted build (where it's force-pinned to Cloudflare
  // regardless) — exactly what's needed here, since packaging only ever
  // happens on someone's own machine via `npm run electron:pack`, never
  // inside Lovable's own sandbox.
  nitro: { preset: "node-server" },
});

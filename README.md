# QueckSilver Arch

A calm, minimal, Swiss-designed desktop browser for Windows, macOS and Linux, with Zora built in.

- **Browsing:** address bar for URLs and searches (15 search engines, default DuckDuckGo), favorites, tab groups, split view, optional vertical tabs, reader and night mode.
- **Privacy:** ad and tracker blocker, Incognito and Tor windows, HTTPS-only, WebRTC leak protection, DNS-over-HTTPS, per-site permissions.
- **Zora:** the same assistant as QueckSilver AI, in a sidebar next to the page, with tools to drive the browser. A permission preset (Autonomous, Balanced, Cautious) controls what runs without asking.
- **Account:** sign in with your QueckSilver account to sync favorites, passwords and settings.

Downloads: https://quecksilver.ch/arch

## Development

Electron app with a TanStack Start renderer.

```sh
npm install
npm run dev            # renderer only (browser fallback, no Electron APIs)
npm run electron:dev   # renderer + Electron
npm run electron:pack  # build installers
```

Zora talks to the `search-chat` Edge Function of the QueckSilver AI project (see `src/lib/supabase-config.ts`). Releases are published to GitHub Releases as `QueckSilver.Arch-<version>-<os>-<arch>`.

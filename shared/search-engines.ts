// Shared between electron/ (Zora's search_web_in_tab tool needs to build
// the same URL the person would get from the address bar, not a hardcoded
// Google search — see electron/browser-tools.ts) and src/lib/settings-store.ts
// (the URL bar and Settings' engine picker). Kept dependency-free (no
// React/DOM) so both sides can import it as-is.
export type SearchEngine =
  | "google"
  | "bing"
  | "duckduckgo"
  | "startpage"
  | "mojeek"
  | "ecosia"
  | "brave"
  | "yahoo"
  | "yandex"
  | "qwant"
  | "swisscows"
  | "presearch"
  | "you"
  | "perplexity";

export const SEARCH_ENGINES: { id: SearchEngine; label: string; domain: string; buildUrl: (q: string) => string }[] = [
  { id: "google", label: "Google", domain: "google.com", buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { id: "bing", label: "Bing", domain: "bing.com", buildUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  { id: "duckduckgo", label: "DuckDuckGo", domain: "duckduckgo.com", buildUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  { id: "startpage", label: "Startpage", domain: "startpage.com", buildUrl: (q) => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}` },
  { id: "brave", label: "Brave Search", domain: "search.brave.com", buildUrl: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
  { id: "mojeek", label: "Mojeek", domain: "mojeek.com", buildUrl: (q) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}` },
  { id: "ecosia", label: "Ecosia", domain: "ecosia.org", buildUrl: (q) => `https://www.ecosia.org/search?q=${encodeURIComponent(q)}` },
  { id: "qwant", label: "Qwant", domain: "qwant.com", buildUrl: (q) => `https://www.qwant.com/?q=${encodeURIComponent(q)}` },
  { id: "swisscows", label: "Swisscows", domain: "swisscows.com", buildUrl: (q) => `https://swisscows.com/en/web?query=${encodeURIComponent(q)}` },
  { id: "yahoo", label: "Yahoo", domain: "yahoo.com", buildUrl: (q) => `https://search.yahoo.com/search?p=${encodeURIComponent(q)}` },
  { id: "yandex", label: "Yandex", domain: "yandex.com", buildUrl: (q) => `https://yandex.com/search/?text=${encodeURIComponent(q)}` },
  { id: "you", label: "You.com", domain: "you.com", buildUrl: (q) => `https://you.com/search?q=${encodeURIComponent(q)}` },
  { id: "presearch", label: "Presearch", domain: "presearch.com", buildUrl: (q) => `https://presearch.com/search?q=${encodeURIComponent(q)}` },
  { id: "perplexity", label: "Perplexity", domain: "perplexity.ai", buildUrl: (q) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}` },
];

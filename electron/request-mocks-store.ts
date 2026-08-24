import { JsonStore } from "./json-store";

// Request-Interception/Mocking (masterplan #34) — a urlPattern -> fake
// response map, persisted the same JsonStore way as custom-css-store.ts.
// Global (not per-domain), since a mock is deliberately about matching a
// specific request URL/pattern for API testing, not "this whole site".
export type RequestMock = { status: number; body: string };
type RequestMocksMap = Record<string, RequestMock>;

const store = new JsonStore<RequestMocksMap>("request-mocks.json");

export function getAllRequestMocks(): { pattern: string; status: number; body: string }[] {
  const map = store.read({});
  return Object.entries(map).map(([pattern, mock]) => ({ pattern, ...mock }));
}

export function setRequestMock(pattern: string, status: number, body: string) {
  const map = store.read({});
  map[pattern] = { status, body };
  store.write(map);
}

export function deleteRequestMock(pattern: string) {
  const map = store.read({});
  delete map[pattern];
  store.write(map);
}

// Simple glob support (only "*" as wildcard) — same pragmatic scope as
// #33's customBlockedPatterns, converted to a RegExp once per lookup.
// Not cached: the mock list is small and requests aren't hot-path enough
// (unlike BLOCKED_HOSTS) to need it precomputed.
export function findMatchingMock(url: string): RequestMock | null {
  const map = store.read({});
  for (const [pattern, mock] of Object.entries(map)) {
    const regex = new RegExp("^" + pattern.split("*").map(escapeRegExp).join(".*") + "$");
    if (regex.test(url)) return mock;
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

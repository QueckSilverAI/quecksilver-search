import { useCallback, useMemo, useState } from "react";
import type { PasswordEntry } from "./use-browser-api";

// A short list of the most common leaked/default passwords — anyone using
// one of these is trivially guessable regardless of length or character
// variety, so it's checked before falling back to the heuristic below.
const COMMON_WEAK_PASSWORDS = new Set([
  "password", "123456", "12345678", "123456789", "1234567890", "qwerty",
  "111111", "abc123", "letmein", "monkey", "iloveyou", "admin", "welcome",
  "password1", "1234567", "12345", "000000", "1q2w3e4r", "dragon", "sunshine",
]);

// Deliberately a simple, explainable heuristic (not an entropy estimate) —
// same "err broad, cost is low" reasoning as use-zora-chat.ts's sensitive-
// domain list: a password flagged "weak" that's actually fine just means
// one badge the person can dismiss by looking at it; a genuinely weak one
// that slips through is the worse outcome.
function isWeak(password: string): boolean {
  if (!password) return true;
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) return true;
  if (password.length < 8) return true;
  const varietyCount = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
  return varietyCount < 2;
}

export type PasswordHealthEntry = {
  weak: boolean;
  reused: boolean;
  // null = breach check hasn't been run yet (or this entry's password
  // wasn't part of the last run); 0 = checked, not found in any breach;
  // >0 = the number of breaches it appeared in.
  breachCount: number | null;
};

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

// Have I Been Pwned's k-anonymity range API: only the first 5 hex
// characters of the password's SHA-1 hash ever leave the device. HIBP
// hands back every suffix that starts with that prefix (typically a few
// hundred), and the match against the real password happens locally right
// here — the full password, and even its full hash, never crosses the
// network. This is the same technique Chrome/Firefox/Edge's own password-
// breach checks use.
async function lookupBreachCount(password: string): Promise<number> {
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  if (!res.ok) throw new Error(`HIBP request failed (${res.status})`);
  const text = await res.text();
  for (const line of text.split("\n")) {
    const [lineSuffix, count] = line.trim().split(":");
    if (lineSuffix === suffix) return count !== undefined ? parseInt(count, 10) || 0 : 0;
  }
  return 0;
}

export function usePasswordHealth(passwords: PasswordEntry[]) {
  const [breachByPassword, setBreachByPassword] = useState<Map<string, number>>(new Map());
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [hasChecked, setHasChecked] = useState(false);

  const { weakIds, reusedIds } = useMemo(() => {
    const weak = new Set<string>();
    const byPassword = new Map<string, string[]>();
    for (const p of passwords) {
      if (isWeak(p.password)) weak.add(p.id);
      const ids = byPassword.get(p.password) ?? [];
      ids.push(p.id);
      byPassword.set(p.password, ids);
    }
    const reused = new Set<string>();
    for (const ids of byPassword.values()) {
      if (ids.length > 1) for (const id of ids) reused.add(id);
    }
    return { weakIds: weak, reusedIds: reused };
  }, [passwords]);

  // One HIBP request per UNIQUE password value, not per saved entry — if
  // the same password is reused across several logins, checking it once
  // and applying the result to every matching id avoids hammering the API
  // for no extra information. Run on demand (a button press), never
  // automatically — same "not polled" precedent as e.g. the Control
  // Center's page-metadata check, and it means nothing phones out just
  // from opening Settings.
  const runBreachCheck = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const unique = Array.from(new Set(passwords.map((p) => p.password).filter(Boolean)));
      const next = new Map<string, number>();
      let anyFailed = false;
      for (const pw of unique) {
        try {
          next.set(pw, await lookupBreachCount(pw));
        } catch {
          anyFailed = true; // one failed lookup shouldn't abort the whole batch
        }
      }
      setBreachByPassword(next);
      setHasChecked(true);
      if (anyFailed && unique.length > 0) {
        setCheckError("Some passwords couldn't be checked — try again in a moment.");
      }
    } catch {
      setCheckError("Couldn't reach the breach-check service. Check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }, [passwords]);

  const entries = useMemo<Record<string, PasswordHealthEntry>>(() => {
    const map: Record<string, PasswordHealthEntry> = {};
    for (const p of passwords) {
      map[p.id] = {
        weak: weakIds.has(p.id),
        reused: reusedIds.has(p.id),
        breachCount: hasChecked ? breachByPassword.get(p.password) ?? 0 : null,
      };
    }
    return map;
  }, [passwords, weakIds, reusedIds, breachByPassword, hasChecked]);

  const summary = useMemo(() => {
    const breachedCount = hasChecked
      ? passwords.filter((p) => (breachByPassword.get(p.password) ?? 0) > 0).length
      : 0;
    return { weakCount: weakIds.size, reusedCount: reusedIds.size, breachedCount };
  }, [passwords, weakIds, reusedIds, breachByPassword, hasChecked]);

  return { entries, summary, checking, checkError, hasChecked, runBreachCheck };
}

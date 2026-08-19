import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { QueckSilverLogo } from "@/components/QueckSilverLogo";
import { HOME_URL, SETTINGS_URL } from "@/hooks/use-browser-api";

function hostnameOf(pageUrl: string): string | null {
  try {
    // Password entries and freshly-typed URLs often don't include a
    // protocol ("google.com" rather than "https://google.com") — new URL()
    // throws on those, which used to just fall through to the letter
    // fallback below even though the domain itself was perfectly valid.
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(pageUrl) ? pageUrl : `https://${pageUrl}`;
    return new URL(withProtocol).hostname;
  } catch {
    return null;
  }
}

// Two favicon sources, tried in order, per host — not one fixed URL. The
// proxy (Google's s2 endpoint) is keyed and cached purely off the domain
// name, both at Google's edge and in Chromium's own HTTP cache, so once a
// site's favicon has changed the proxy can keep serving the stale one back
// indefinitely with nothing here able to tell. Going straight to the
// site's own /favicon.ico first sidesteps that cache entirely — it's
// fetched from the actual current site, so it's never stale by
// construction. That convention doesn't hold for every site (some only
// declare their icon via a <link> tag at a different path), which is what
// the proxy fallback below is still for.
function faviconSources(host: string): string[] {
  const direct = `https://${host}/favicon.ico`;
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const proxy = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64&_=${week}`;
  return [direct, proxy];
}

export function FavIcon({ url, label, size = "h-6 w-6" }: { url: string; label: string; size?: string }) {
  const [attempt, setAttempt] = useState(0);
  const host = hostnameOf(url);
  const sources = host ? faviconSources(host) : [];
  // A new URL means a fresh set of sources to try — without resetting
  // here, switching from a site whose direct fetch failed (attempt at
  // index 1, the proxy) straight to one whose direct fetch would have
  // worked would incorrectly start on the proxy for it too.
  useEffect(() => {
    setAttempt(0);
  }, [url]);
  if (url === SETTINGS_URL) {
    return <Settings className={`${size.includes("h-5") ? "h-[15px] w-[15px]" : "h-4 w-4"} shrink-0 text-foreground`} />;
  }
  // Only the internal "new tab" sentinel gets our own logo — a REAL
  // quecksilver.ch/.ai page (e.g. added as an actual favorite) fetches its
  // real favicon from the internet like any other site, not our own mark.
  if (url === HOME_URL) {
    return <QueckSilverLogo className={size} style={{ color: "var(--brand)" }} />;
  }
  const src = sources[attempt];
  if (src) {
    return <img src={src} alt="" onError={() => setAttempt((a) => a + 1)} className={`${size} object-contain`} />;
  }
  return <span className="text-sm font-semibold text-foreground">{label.charAt(0).toUpperCase()}</span>;
}

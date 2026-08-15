import { useState } from "react";
import { Settings } from "lucide-react";
import { QueckSilverLogo } from "@/components/QueckSilverLogo";
import { HOME_URL, SETTINGS_URL } from "@/hooks/use-browser-api";

function faviconUrl(pageUrl: string): string | null {
  try {
    // Password entries and freshly-typed URLs often don't include a
    // protocol ("google.com" rather than "https://google.com") — new URL()
    // throws on those, which used to just fall through to the letter
    // fallback below even though the domain itself was perfectly valid.
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(pageUrl) ? pageUrl : `https://${pageUrl}`;
    const host = new URL(withProtocol).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return null;
  }
}

export function FavIcon({ url, label, size = "h-6 w-6" }: { url: string; label: string; size?: string }) {
  const [failed, setFailed] = useState(false);
  if (url === SETTINGS_URL) {
    return <Settings className={`${size.includes("h-5") ? "h-[15px] w-[15px]" : "h-4 w-4"} shrink-0 text-foreground`} />;
  }
  // Only the internal "new tab" sentinel gets our own logo — a REAL
  // quecksilver.ch/.ai page (e.g. added as an actual favorite) fetches its
  // real favicon from the internet like any other site, not our own mark.
  if (url === HOME_URL) {
    return <QueckSilverLogo className={size} style={{ color: "var(--brand)" }} />;
  }
  const src = !failed ? faviconUrl(url) : null;
  if (src) {
    return <img src={src} alt="" onError={() => setFailed(true)} className={`${size} object-contain`} />;
  }
  return <span className="text-sm font-semibold text-foreground">{label.charAt(0).toUpperCase()}</span>;
}

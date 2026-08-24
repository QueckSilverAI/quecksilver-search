import { Pencil, Search, X, EyeOff, UserRound, Check, Ban } from "lucide-react";
import { TorOnionLogo } from "@/components/TorOnionLogo";
import { QueckSilverLogo } from "@/components/QueckSilverLogo";
import { Wordmark } from "@/components/QueckSilverMarks";
import { FavIcon } from "@/components/FavIcon";

export type Bookmark = { label: string; url: string } | null;
export const SLOT_COUNT = 5;

type PrivacyMode = "guest" | "incognito" | "tor" | null;

type Props = {
  urlDraft: string;
  onUrlDraftChange: (value: string) => void;
  onSubmit: (raw: string) => void;
  bookmarks: Bookmark[];
  onOpenBookmark: (url: string) => void;
  onOpenSlot: (index: number) => void;
  onRemoveSlot: (index: number) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  // Guest/Incognito/Tor windows never save favorites (see
  // profile-scoped-store.ts - guest mode is in-memory only), so the 5
  // click-to-add tiles below would just be dead weight for them: nothing
  // typed into an empty slot here would survive the window closing anyway.
  // Swapped for a short "what's saved, what isn't" explainer instead.
  privacyMode?: PrivacyMode;
};

// One row of the privacy explainer below - a small icon (do/don't) plus a
// line of text, kept to plain short sentences rather than a longer
// paragraph so the whole card scans in a glance.
function PrivacyRow({ saved, children }: { saved: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[13px] text-foreground/80">
      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${saved ? "bg-emerald-500/15 text-emerald-600" : "bg-foreground/10 text-muted-foreground"}`}>
        {saved ? <Check className="h-2.5 w-2.5" /> : <Ban className="h-2.5 w-2.5" />}
      </span>
      <span>{children}</span>
    </li>
  );
}

// The full, real home page — search bar and 5 bookmark tiles — extracted
// so it can render identically whether it's the primary tab's content or
// the secondary (right) side of split view. Previously split view showed
// just a small placeholder there instead of the real thing.
export function HomeContent({ urlDraft, onUrlDraftChange, onSubmit, bookmarks, onOpenBookmark, onOpenSlot, onRemoveSlot, inputRef, privacyMode = null }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-10 py-6 -translate-y-12 bg-white">
      <div className="flex w-full max-w-[700px] flex-col items-center gap-6">
        <div className="flex items-center gap-2.5">
          <QueckSilverLogo className="h-auto w-[92px]" style={{ color: "var(--brand)" }} />
          <Wordmark className="h-14 w-auto text-[var(--brand)]" />
        </div>

        <div className="flex w-full items-center gap-3 rounded-full bg-card px-[22px] py-3.5 shadow-[0_1px_6px_rgba(32,33,36,0.28)]">
          <Search className="h-[19px] w-[19px] shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={urlDraft}
            onChange={(e) => onUrlDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit(urlDraft);
            }}
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none"
            placeholder="Search the web"
          />
        </div>

        {privacyMode ? (
          <div className="flex w-full max-w-[420px] flex-col items-center gap-3 rounded-2xl bg-card px-6 py-5 text-center shadow-[0_2px_8px_rgba(0,0,0,0.12)]">
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white"
              style={{ background: privacyMode === "tor" ? "#6b3fa0" : privacyMode === "incognito" ? "#1f1f24" : "hsl(240 4% 46%)" }}
            >
              {privacyMode === "tor" ? <TorOnionLogo className="h-5 w-5" strokeWidth={2} /> : privacyMode === "incognito" ? <EyeOff className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
            </span>
            <p className="text-[15px] font-semibold text-foreground">
              {privacyMode === "tor" ? "You're browsing with Tor" : privacyMode === "incognito" ? "You've gone Incognito" : "You're browsing as a guest"}
            </p>
            <ul className="flex w-full flex-col gap-1.5">
              <PrivacyRow saved={false}>History, cookies and site data</PrivacyRow>
              <PrivacyRow saved={false}>Favorites and saved passwords</PrivacyRow>
              <PrivacyRow saved={true}>Files you download</PrivacyRow>
            </ul>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {privacyMode === "tor"
                ? "Your traffic is routed through Tor, hiding your IP address from the sites you visit."
                : "This won't hide your activity from your employer, school, or internet provider."}
            </p>
            {privacyMode === "tor" && (
              <button
                onClick={() => onOpenBookmark("https://check.torproject.org")}
                className="mt-1 rounded-full bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-blue-700"
              >
                Check Connection
              </button>
            )}
          </div>
        ) : (
          <div className="flex gap-7">
            {Array.from({ length: SLOT_COUNT }, (_, i) => bookmarks[i]).map((b, i) =>
              b ? (
                <div key={i} className="group relative flex flex-col items-center gap-2 cursor-pointer" onClick={() => onOpenBookmark(b.url)}>
                  <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-card shadow-[0_2px_8px_rgba(0,0,0,0.12)]">
                    <FavIcon url={b.url} label={b.label} />
                  </div>
                  <span className="max-w-[64px] truncate text-[13px] font-medium text-foreground">{b.label}</span>
                  <div className="absolute -right-1.5 -top-1.5 hidden gap-1 group-hover:flex">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenSlot(i);
                      }}
                      aria-label={`Edit ${b.label}`}
                      className="grid h-5 w-5 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveSlot(i);
                      }}
                      aria-label={`Remove ${b.label}`}
                      className="grid h-5 w-5 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <button key={i} onClick={() => onOpenSlot(i)} className="group flex flex-col items-center gap-2">
                  <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-card shadow-[0_2px_8px_rgba(0,0,0,0.12)]">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      className="text-muted-foreground transition-transform duration-150 group-hover:scale-125"
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </div>
                  <span className="text-[13px] font-medium text-foreground">Add</span>
                </button>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}


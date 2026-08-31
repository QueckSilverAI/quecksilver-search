import { useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { SEARCH_ENGINES, type SearchEngine } from "@/lib/settings-store";
import quecksilverAppIcon from "@/assets/quecksilver-app-icon.png";

type Props = {
  engine: SearchEngine;
  onChange: (engine: SearchEngine) => void;
  // The toolbar's version sits inline in the URL bar but still gets its
  // own visible pill (a subtle border, so it doesn't fight visually with
  // the URL bar's own larger pill it's embedded in) with a large,
  // easy-to-recognize engine icon. Settings' version is a standalone
  // control with the engine's name spelled out next to a smaller icon.
  //
  // "inline" opens the dropdown as a native overlay window instead of a
  // local absolutely-positioned panel (see the onClick below) — it's the
  // one that can show up over a real website tab, whose native
  // WebContentsView would otherwise paint straight over a plain DOM
  // panel here regardless of z-index. "standalone" isn't shown over any
  // tab content (Settings renders its own engine grid directly, not this
  // component) so it keeps the simple local dropdown.
  variant?: "inline" | "standalone";
};

// QueckSilver Search is our own engine — there's no favicon for it to fetch
// from DuckDuckGo's icon service (that's only for the third-party engines),
// so it gets the real app icon instead (the exact same PNG the desktop
// app itself uses for its window/taskbar/dock icon — see
// electron/main.ts's ICON_PATH and package.json's build.*.icon). Sized
// down from the slot (innerClassName, centered) rather than full-bleed —
// the artwork itself has almost no built-in padding (it's meant for an
// OS dock/taskbar, which does its own masking/insetting). Defaults to
// 92%; callers pass their own innerClassName when that's not the right
// fit — a tighter rounded-full pill (the toolbar trigger) wants it a
// bit smaller than that, a plain rounded-sm dropdown row (no circular
// clipping to worry about) can afford it a bit bigger.
export function EngineIcon({
  engine,
  className,
  innerClassName = "h-[92%] w-[92%]",
}: {
  engine: (typeof SEARCH_ENGINES)[number];
  className: string;
  innerClassName?: string;
}) {
  if (engine.id === "quecksilver") {
    return (
      <div className={`${className} flex items-center justify-center`}>
        <img src={quecksilverAppIcon} alt="" className={`${innerClassName} object-contain`} />
      </div>
    );
  }
  return <img src={`https://icons.duckduckgo.com/ip3/${engine.domain}.ico`} alt="" className={`${className} object-contain`} />;
}

export function SearchEngineChooser({ engine, onChange, variant = "standalone" }: Props) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const current = SEARCH_ENGINES.find((e) => e.id === engine) ?? SEARCH_ENGINES[0]!;

  return (
    <div className={`relative shrink-0 ${variant === "inline" ? "-ml-3" : ""}`}>
      <button
        onClick={(e) => {
          if (variant === "inline") {
            // Same native-overlay-window architecture as every other
            // toolbar dropdown (profile, downloads, ...) — see
            // SearchEngineOverlayContent.tsx and index.tsx's "searchEngine"
            // case in its overlay onAction listener, which is what
            // actually calls onChange once something gets picked there.
            const r = e.currentTarget.getBoundingClientRect();
            window.browserAPI?.overlay.open(
              "searchEngine",
              { current: engine },
              { top: r.top, left: r.left, right: r.right, bottom: r.bottom },
            );
            return;
          }
          setOpen((v) => !v);
        }}
        aria-label="Change search engine"
        className={
          variant === "standalone"
            ? "flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
            : "flex items-center gap-1 rounded-full bg-background px-1.5 py-0.5 shadow-sm"
        }
      >
        <EngineIcon
          engine={current}
          className={variant === "standalone" ? "h-[14px] w-[14px] shrink-0 rounded-sm" : "h-6 w-6 shrink-0 rounded-full"}
          innerClassName={variant === "inline" ? "h-[82%] w-[82%]" : "h-[92%] w-[92%]"}
        />
        {variant === "standalone" && <span className="truncate">{current.label}</span>}
        <ChevronDown className="h-3 w-3 shrink-0 text-foreground" />
      </button>
      {variant === "standalone" && open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-52 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
            <div className="border-b border-border py-2 pl-3 text-[12px] font-semibold text-muted-foreground">Choose Search Engine</div>
            <div ref={scrollRef} className="custom-scrollbar max-h-64 overflow-y-auto py-1 px-1">
              {SEARCH_ENGINES.map((e) => (
                <button
                  key={e.id}
                  onClick={() => {
                    onChange(e.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium hover:bg-muted ${
                    e.id === engine ? "text-[var(--brand)]" : "text-foreground"
                  }`}
                >
                  <EngineIcon engine={e} className="h-4 w-4 shrink-0 rounded-sm" />
                  <span className="truncate">{e.label}</span>
                  {e.id === engine && <Check className="ml-auto h-3.5 w-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

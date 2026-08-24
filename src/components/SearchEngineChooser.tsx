import { useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { SEARCH_ENGINES, type SearchEngine } from "@/lib/settings-store";

type Props = {
  engine: SearchEngine;
  onChange: (engine: SearchEngine) => void;
  // The toolbar's version sits inline in the URL bar but still gets its
  // own visible pill (a subtle border, so it doesn't fight visually with
  // the URL bar's own larger pill it's embedded in) with a large,
  // easy-to-recognize engine icon. Settings' version is a standalone
  // control with the engine's name spelled out next to a smaller icon.
  variant?: "inline" | "standalone";
};

export function SearchEngineChooser({ engine, onChange, variant = "standalone" }: Props) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const current = SEARCH_ENGINES.find((e) => e.id === engine) ?? SEARCH_ENGINES[0]!;

  return (
    <div className={`relative shrink-0 ${variant === "inline" ? "-ml-2" : ""}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Change search engine"
        className={
          variant === "standalone"
            ? "flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
            : "flex items-center gap-1 rounded-full bg-background px-1.5 py-0.5 shadow-sm"
        }
      >
        <img
          src={`https://icons.duckduckgo.com/ip3/${current.domain}.ico`}
          alt=""
          className={variant === "standalone" ? "h-[14px] w-[14px] shrink-0 rounded-sm object-contain" : "h-6 w-6 shrink-0 rounded-full object-contain"}
        />
        {variant === "standalone" && <span className="truncate">{current.label}</span>}
        <ChevronDown className="h-3 w-3 shrink-0 text-foreground" />
      </button>
      {open && (
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
                  <img src={`https://icons.duckduckgo.com/ip3/${e.domain}.ico`} alt="" className="h-4 w-4 shrink-0 rounded-sm object-contain" />
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

import { Check, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Same four Zora variants as QueckSilver AI's ModelSelector.tsx
// (VARIANT_LABEL: omni/Flash/FlashLite/Pro), renamed to this app's own
// "-Arch" naming. UI-only for now — search-chat always runs one fixed
// backend model; picking a variant here doesn't change what actually
// answers yet (see the master plan, this is scoped as a follow-up once
// search-chat supports a `variant` parameter).
const VARIANTS = ["6.1-Arch", "6.1-Flash-Arch", "6.1-Flash-Lite-Arch", "6.1-Pro-Arch"] as const;

// Lives inside ZoraChatInput's bottom row now (was the sidebar's own
// header before) — same QueckSilver AI convention this was already
// matching (model picker docked to the composer, not the page header),
// just applied here too. Opens upward (dropdown sits above the button)
// since the button itself is now near the bottom of the panel.
export function ZoraModelSelector() {
  const [selected, setSelected] = useState<(typeof VARIANTS)[number]>("6.1-Flash-Lite-Arch");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {selected}
        <ChevronUp className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 bottom-full z-20 mb-1 w-52 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-md">
          {VARIANTS.map((v) => (
            <button
              key={v}
              onClick={() => {
                setSelected(v);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
            >
              {v}
              {v === selected && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

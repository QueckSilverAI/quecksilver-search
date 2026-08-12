import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Same four Zora variants as QueckSilver AI's ModelSelector.tsx
// (VARIANT_LABEL: omni/Flash/FlashLite/Pro). UI-only for now — search-chat
// always runs one fixed backend model; picking a variant here doesn't
// change what actually answers yet (see the master plan, this is scoped
// as a follow-up once search-chat supports a `variant` parameter).
const VARIANTS = ["Zora-6.1", "Zora-Flash", "Zora-Flash-Lite", "Zora-Pro"] as const;

export function ZoraModelSelector() {
  const [selected, setSelected] = useState<(typeof VARIANTS)[number]>("Zora-6.1");
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
        className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-sm font-medium text-foreground transition-colors hover:bg-muted"
      >
        {selected}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-md">
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

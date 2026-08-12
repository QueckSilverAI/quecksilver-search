import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

// Simplified sibling of QueckSilver AI's CodeBlock.tsx — same overall shape
// ("</>" + language label header, rounded bordered card, copy button) but
// without porting the full custom syntax-highlighter tokenizer, since this
// sidebar is a much narrower surface. Plain monospace text, same chrome.
export function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="not-prose my-2 overflow-hidden rounded-2xl border border-border bg-muted/40">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <span aria-hidden className="font-mono text-xs text-muted-foreground">{"</>"}</span>
          <span className="text-xs font-medium text-foreground">{lang || "text"}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 pb-3 text-xs leading-relaxed text-foreground">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

import { Check, Copy, RotateCw } from "lucide-react";
import { useState } from "react";
import type { ZoraMessage as ZoraMessageType } from "@/hooks/use-zora-chat";
import { ZoraMarkdown } from "./ZoraMarkdown";
import { cn } from "@/lib/utils";

type Props = {
  message: ZoraMessageType;
  isLastModelMessage: boolean;
  onRegenerate: () => void;
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// Styling mirrors QueckSilver AI's ChatMessage.tsx bubble convention: user
// turns get a rounded pill bubble (rounded-3xl bg-muted/80), assistant turns
// render as plain text in the column. Both get a small actions row below
// (copy + timestamp; assistant also gets regenerate on its latest reply).
export function ZoraMessage({ message, isLastModelMessage, onRegenerate }: Props) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const copy = async () => {
    try {
      if (window.browserAPI) {
        await window.browserAPI.clipboard.writeText(message.text);
      } else {
        await navigator.clipboard.writeText(message.text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — silently ignore */
    }
  };

  const actions = (
    <div className={cn("flex items-center gap-1", isUser && "justify-end")}>
      <button
        onClick={copy}
        title="Copy"
        className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {!isUser && isLastModelMessage && (
        <button
          onClick={onRegenerate}
          title="Regenerate"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
      )}
      <span className="px-1 text-[11px] text-muted-foreground">{formatTime(message.time)}</span>
    </div>
  );

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1">
        {message.imageDataUrl && (
          <img src={message.imageDataUrl} alt="" className="max-h-48 max-w-[70%] rounded-2xl object-cover" />
        )}
        {message.text && (
          <div className="max-w-[85%] rounded-3xl bg-muted/80 px-4 py-3 text-sm text-foreground">{message.text}</div>
        )}
        {actions}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className={cn(message.failed && "text-destructive")}>
        <ZoraMarkdown text={message.text} />
      </div>
      {actions}
    </div>
  );
}

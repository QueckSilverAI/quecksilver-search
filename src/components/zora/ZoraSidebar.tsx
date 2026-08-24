import { useEffect, useRef } from "react";
import { Bookmark, Globe, MousePointerClick, PanelRightClose, SearchCheck, Square } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useZoraChat } from "@/hooks/use-zora-chat";
import { ZoraMascot } from "@/components/QueckSilverMarks";
import { ZoraMessage } from "./ZoraMessage";
import { ZoraChatInput } from "./ZoraChatInput";
import { ZoraModelSelector } from "./ZoraModelSelector";
import { ZoraToolApprovalCard } from "./ZoraToolApprovalCard";

type Props = { onClose: () => void };

const CAPABILITIES = [
  { icon: Globe, text: "Open tabs and navigate to URLs" },
  { icon: SearchCheck, text: "Read and search the current page" },
  { icon: MousePointerClick, text: "Click things and fill in forms" },
  { icon: Bookmark, text: "Manage your bookmarks" },
];

export function ZoraSidebar({ onClose }: Props) {
  const { session } = useAuth();
  const {
    messages,
    isLoading,
    statusText,
    pendingToolCall,
    send,
    regenerate,
    stop,
    approveToolCall,
    denyToolCall,
  } = useZoraChat(session?.accessToken ?? null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading, pendingToolCall]);

  const lastModelId = [...messages].reverse().find((m) => m.role === "model")?.id;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-1 pb-2">
        <ZoraModelSelector />
        <button
          onClick={onClose}
          aria-label="Close sidebar"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="thin-scrollbar flex-1 space-y-4 overflow-y-auto px-1 py-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-4 pt-6 text-center">
            <ZoraMascot className="h-12 w-12 text-primary" />
            <div className="w-full space-y-2 text-left">
              {CAPABILITIES.map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2.5 rounded-xl bg-muted/60 px-3 py-2">
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-xs text-muted-foreground">{text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <ZoraMessage key={m.id} message={m} isLastModelMessage={m.id === lastModelId} onRegenerate={regenerate} />
        ))}
        {pendingToolCall && (
          <ZoraToolApprovalCard call={pendingToolCall} onApprove={approveToolCall} onDeny={denyToolCall} />
        )}
        {isLoading && !pendingToolCall && (
          <p className="px-1 text-sm text-muted-foreground">{statusText ?? "Thinking…"}</p>
        )}
      </div>
      <div className="flex items-center gap-2 pt-2">
        <ZoraChatInput onSend={send} disabled={isLoading} />
        {/* Immediate-stop (zora-browser-integration-plan.md section 6) —
            only shown mid-turn, so it can't be mistaken for a second send
            button the rest of the time. */}
        {isLoading && (
          <button
            onClick={stop}
            title="Stop"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        )}
      </div>
    </div>
  );
}

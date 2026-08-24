import { useEffect, useRef, useState } from "react";
import { Bookmark, Globe, Info, MousePointerClick, PanelRightClose, ScreenShare, SearchCheck, Square } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useZoraChat } from "@/hooks/use-zora-chat";
import { useZoraSettings } from "@/hooks/use-zora-settings";
import { ZoraMascot } from "@/components/QueckSilverMarks";
import { ZoraMessage } from "./ZoraMessage";
import { ZoraChatInput } from "./ZoraChatInput";
import { ZoraModelSelector } from "./ZoraModelSelector";
import { ZoraToolApprovalCard } from "./ZoraToolApprovalCard";
import { ZoraAuditLog } from "./ZoraAuditLog";

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
  const { settings: zoraSettings, setScreenShareEnabled } = useZoraSettings();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [showScreenShareInfo, setShowScreenShareInfo] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading, pendingToolCall]);

  const lastModelId = [...messages].reverse().find((m) => m.role === "model")?.id;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-1 pb-2">
        <ZoraModelSelector />
        <div className="flex items-center gap-1">
          {/* zora-browser-integration-plan.md section 5 — off by default,
              gates only the see_screen tool. The visibility indicator
              (green dot) is deliberately always next to this exact
              toggle, not tucked away in Settings, so it can't go unnoticed
              while it's on. */}
          <div className="relative flex items-center">
            <button
              onClick={() => setShowScreenShareInfo((v) => !v)}
              aria-label="About screen sharing"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
            {showScreenShareInfo && (
              <div className="absolute right-0 top-7 z-10 w-56 rounded-xl border border-border bg-popover p-3 text-xs leading-relaxed text-muted-foreground shadow-lg">
                When on, Zora can take screenshots of this page to actually see it — useful for anything text alone
                can't tell it (layout, images, a canvas or video). This uses more usage (image tokens) than normal
                chat.
              </div>
            )}
          </div>
          <button
            onClick={() => void setScreenShareEnabled(!zoraSettings.screenShareEnabled)}
            aria-pressed={zoraSettings.screenShareEnabled}
            title={zoraSettings.screenShareEnabled ? "Screen sharing on — click to turn off" : "Screen sharing off — click to turn on"}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              zoraSettings.screenShareEnabled
                ? "bg-emerald-500/15 text-emerald-600"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {zoraSettings.screenShareEnabled && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />}
            <ScreenShare className="h-3.5 w-3.5 shrink-0" />
            {zoraSettings.screenShareEnabled ? "Sharing" : "Share screen"}
          </button>
          <ZoraAuditLog />
          <button
            onClick={onClose}
            aria-label="Close sidebar"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
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

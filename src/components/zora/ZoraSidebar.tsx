import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, Globe, MousePointerClick, ScreenShare, SearchCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useZoraChat } from "@/hooks/use-zora-chat";
import { useZoraSettings } from "@/hooks/use-zora-settings";
import { ZoraMascot } from "@/components/QueckSilverMarks";
import { ZoraMessage } from "./ZoraMessage";
import { ZoraChatInput } from "./ZoraChatInput";
import { ZoraToolApprovalCard } from "./ZoraToolApprovalCard";
import { ZoraHopLimitCard } from "./ZoraHopLimitCard";
import { ZoraSessionExpiredCard } from "./ZoraSessionExpiredCard";
import { ZoraAuditLog } from "./ZoraAuditLog";

// No onClose prop anymore — the Chat button in the main header (which
// toggles zoraOpen in routes/index.tsx) is the only way to open/close
// this now; a second close button inside the panel itself was redundant.
type Props = Record<string, never>;

const CAPABILITIES = [
  { icon: Globe, text: "Open tabs and navigate to URLs" },
  { icon: SearchCheck, text: "Read and search the current page" },
  { icon: MousePointerClick, text: "Click things and fill in forms" },
  { icon: Bookmark, text: "Manage your bookmarks" },
];

// How long the "Connecting…" state shows before the real panel appears —
// this component is only ever mounted while zoraOpen is true (routes/
// index.tsx unmounts it entirely on close), so a plain useState(true)
// here already re-triggers this on every single open, matching "always,
// briefly" exactly without any extra plumbing. Not tied to a real network
// wait (there isn't one worth waiting on here) — purely a deliberate,
// consistent beat before the panel appears, same spirit as the Tor
// connecting screen elsewhere in this app.
const CONNECT_MS = 900;

function ZoraConnecting() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8">
      <ZoraMascot className="h-10 w-10 text-primary" />
      <p className="text-[13px] font-medium text-muted-foreground">Connecting…</p>
      <div className="h-1 w-full max-w-[160px] overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ animation: `zora-connect-fill ${CONNECT_MS}ms ease-out forwards` }}
        />
      </div>
      <style>{`@keyframes zora-connect-fill { from { width: 0%; } to { width: 100%; } }`}</style>
    </div>
  );
}

export function ZoraSidebar(_props: Props) {
  const { session, login } = useAuth();
  // Stable identity (only changes if login() itself ever does) so it
  // doesn't cascade a fresh identity through useZoraChat's
  // handleUnauthorized/send/continueFromLimit on every render — see
  // use-auth.tsx's login() for why this can just check the return value
  // instead of re-reading the (possibly stale) session state.
  const attemptZoraReauth = useCallback(async () => Boolean(await login("reauth")), [login]);
  const {
    messages,
    isLoading,
    statusText,
    pendingToolCall,
    hopLimitReached,
    sessionExpired,
    send,
    regenerate,
    stop,
    approveToolCall,
    denyToolCall,
    continueFromLimit,
  } = useZoraChat(session?.accessToken ?? null, attemptZoraReauth);
  const { settings: zoraSettings, setScreenShareEnabled } = useZoraSettings();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [connecting, setConnecting] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setConnecting(false), CONNECT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading, pendingToolCall, hopLimitReached, sessionExpired]);

  if (connecting) return <ZoraConnecting />;

  const lastModelId = [...messages].reverse().find((m) => m.role === "model")?.id;

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex items-center justify-end px-1 pb-2">
        {/* No title/model-label here anymore — the model picker moved into
            ZoraChatInput's own composer, and a static "Zora" text label
            next to it was redundant with the mascot itself. */}
        <div className="flex items-center gap-1">
          {/* zora-browser-integration-plan.md section 5 — off by default,
              gates only the see_screen tool. The visibility indicator
              (green dot) is deliberately always right on this toggle,
              not tucked away in Settings, so it can't go unnoticed while
              it's on. */}
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
        {hopLimitReached && <ZoraHopLimitCard onContinue={continueFromLimit} />}
        {sessionExpired && <ZoraSessionExpiredCard onSignIn={() => void login("reauth")} />}
        {isLoading && !pendingToolCall && (
          <p className="px-1 text-sm text-muted-foreground">{statusText ?? "Thinking…"}</p>
        )}
      </div>
      <div className="pt-2">
        <ZoraChatInput onSend={send} disabled={isLoading} isLoading={isLoading} onStop={stop} />
      </div>
    </div>
  );
}

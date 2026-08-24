import { useCallback, useRef, useState } from "react";
import { SEARCH_CHAT_URL, SUPABASE_ANON_KEY } from "@/lib/supabase-config";

export type ZoraMessage = {
  id: string;
  role: "user" | "model";
  text: string;
  time: number;
  failed?: boolean;
};

export type PendingToolCall = { name: string; args: Record<string, unknown> };

type GeminiContent = { role: "user" | "model"; parts: unknown[] };
type SearchChatResponse =
  | { reply: string; usage: unknown }
  | { toolCall: { name: string; args: Record<string, unknown> }; contents: GeminiContent[]; usage: unknown }
  | { error: string };
type ToolPermissionMode = "auto" | "ask";

const MAX_CLIENT_HOPS = 20;

function statusFor(name: string, args: Record<string, unknown>): string {
  if (name === "web_search") return `Searching the web for "${String(args["query"] ?? "")}"...`;
  return `Using ${name}…`;
}

// zora-browser-integration-plan.md section 6, "additional safety layers":
// clicking or typing anywhere on a banking/payment-looking domain always
// asks first, regardless of preset or a per-tool "auto" override — a
// person who set click_element to auto because it's handy for everyday
// browsing didn't necessarily mean "including my bank". Deliberately a
// small, easy-to-extend keyword list rather than a real domain database —
// false negatives (a bank site this doesn't catch) fail safe to "whatever
// the preset says", false positives (a non-bank site with "pay" in the
// name) just mean one extra confirmation click, so erring broad here costs
// little.
const SENSITIVE_DOMAIN_PATTERNS = [
  /\bbank\b/i,
  /banking/i,
  /paypal/i,
  /\bpay\b/i,
  /checkout/i,
  /\bwallet\b/i,
  /stripe\.com$/i,
  /wellsfargo/i,
  /chase\.com$/i,
  /revolut/i,
  /coinbase/i,
  /\bcrypto\b/i,
];

function isSensitiveDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  return SENSITIVE_DOMAIN_PATTERNS.some((re) => re.test(domain));
}

function requiresApproval(
  name: string,
  permissions: Record<string, ToolPermissionMode>,
  activeTabDomain: string | null | undefined,
): boolean {
  // submit_form always asks, no matter the preset or a per-tool override —
  // called out specifically in zora-browser-integration-plan.md's
  // category D table as needing that (unlike the rest of the category).
  if (name === "submit_form") return true;
  if ((name === "click_element" || name === "type_text") && isSensitiveDomain(activeTabDomain)) return true;
  return permissions[name] === "ask";
}

// Talks to supabase/functions/search-chat. Most tools (open_url,
// read_page_text, click_element, ...) can only run inside this Electron
// app, so when the server hands back a `toolCall` instead of a `reply`, we
// execute it locally via window.browserAPI.tools.execute and POST the
// result back with the echoed `contents` to continue the same turn —
// looping until a final text reply comes back (or MAX_CLIENT_HOPS is hit).
// web_search is a special case: it's bounced here too (so the UI can show
// "Searching the web for ..."), but the server ignores whatever we send
// back for it and redoes the real search itself — this client never touches
// search credentials.
//
// Before a tool that needs confirmation (electron/zora-settings-store.ts's
// preset/overrides, resolved server-side into `permissions`) actually
// runs, the loop pauses and exposes `pendingToolCall` — the UI renders an
// inline approve/deny card and calls approveToolCall()/denyToolCall() to
// resume.
export function useZoraChat(accessToken: string | null) {
  const [messages, setMessages] = useState<ZoraMessage[]>([]);
  const messagesRef = useRef<ZoraMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [pendingToolCall, setPendingToolCall] = useState<PendingToolCall | null>(null);
  const idRef = useRef(0);
  const nextId = () => `m${++idRef.current}`;
  const approvalResolveRef = useRef<((approved: boolean) => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const applyMessages = useCallback((updater: (prev: ZoraMessage[]) => ZoraMessage[]) => {
    setMessages((prev) => {
      const next = updater(prev);
      messagesRef.current = next;
      return next;
    });
  }, []);

  const postJson = useCallback(
    async (body: Record<string, unknown>, appContext: unknown, signal: AbortSignal): Promise<SearchChatResponse> => {
      const res = await fetch(SEARCH_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // No account needed to chat — falls back to the public anon key,
          // same convention Supabase uses for unauthenticated calls.
          Authorization: `Bearer ${accessToken ?? SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ ...body, appContext }),
        signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`[zora] search-chat ${res.status}:`, detail.slice(0, 500));
        throw new Error(`search-chat failed: ${res.status}`);
      }
      return (await res.json()) as SearchChatResponse;
    },
    [accessToken],
  );

  // Resolved by approveToolCall()/denyToolCall() below.
  const waitForApproval = useCallback((call: PendingToolCall): Promise<boolean> => {
    return new Promise((resolve) => {
      approvalResolveRef.current = resolve;
      setPendingToolCall(call);
    });
  }, []);

  const approveToolCall = useCallback(() => {
    setPendingToolCall(null);
    approvalResolveRef.current?.(true);
    approvalResolveRef.current = null;
  }, []);

  const denyToolCall = useCallback(() => {
    setPendingToolCall(null);
    approvalResolveRef.current?.(false);
    approvalResolveRef.current = null;
  }, []);

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || isLoading) return;

      const userMsg: ZoraMessage = { id: nextId(), role: "user", text, time: Date.now() };
      const historyBefore = messagesRef.current.map((m) => ({ role: m.role, text: m.text }));
      applyMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        // Snapshot once per turn (not once per hop) — see
        // electron/build-app-context.ts. Only a subset of the full
        // AppContext travels over the wire; see AppContextPayload in
        // supabase/functions/search-chat/index.ts for which fields it reads.
        const fullAppContext = window.browserAPI ? await window.browserAPI.zora.getAppContext() : null;
        const zoraSettings = window.browserAPI ? await window.browserAPI.zora.getSettings() : null;
        const appContext = fullAppContext
          ? {
              controlCenterSettings: fullAppContext.controlCenterSettings,
              openTabs: fullAppContext.openTabs,
              windowMode: fullAppContext.windowMode,
              activeTabDomain: fullAppContext.activeTabDomain,
              screenShareEnabled: zoraSettings?.screenShareEnabled === true,
            }
          : null;
        // Resolved once per turn too (preset + overrides collapsed into
        // one auto/ask per tool) — electron/zora-tool-catalog.ts's
        // resolveAllToolPermissions.
        const permissions = window.browserAPI ? await window.browserAPI.zora.getEffectivePermissions() : {};

        let response = await postJson({ prompt: text, history: historyBefore }, appContext, abort.signal);
        let hops = 0;

        while ("toolCall" in response && hops < MAX_CLIENT_HOPS) {
          if (abort.signal.aborted) break;
          hops++;
          const { name, args } = response.toolCall;

          let result: { ok: boolean; text: string; imageBase64?: string };
          if (requiresApproval(name, permissions, appContext?.activeTabDomain)) {
            setStatusText(null);
            const approved = await waitForApproval({ name, args });
            if (abort.signal.aborted) break;
            result = approved
              ? name === "web_search"
                ? { ok: true, text: "" }
                : window.browserAPI
                  ? await window.browserAPI.tools.execute(name, args)
                  : { ok: false, text: "Browser tools aren't available outside the desktop app." }
              : { ok: false, text: "The person declined to run this tool. Don't retry it — ask what they'd like instead." };
          } else {
            setStatusText(statusFor(name, args));
            result =
              name === "web_search"
                ? { ok: true, text: "" } // server redoes the real search itself, see postJson comment above
                : window.browserAPI
                  ? await window.browserAPI.tools.execute(name, args)
                  : { ok: false, text: "Browser tools aren't available outside the desktop app." };
          }

          response = await postJson(
            { contents: response.contents, toolResult: { name, response: result.text, imageBase64: result.imageBase64 } },
            appContext,
            abort.signal,
          );
        }

        setStatusText(null);
        if (abort.signal.aborted) return;

        if ("reply" in response) {
          applyMessages((prev) => [...prev, { id: nextId(), role: "model", text: response.reply, time: Date.now() }]);
        } else {
          throw new Error("error" in response ? response.error : "unresolved tool loop");
        }
      } catch (e) {
        if (abort.signal.aborted) {
          // Person hit stop — the partial turn just ends here, no error
          // bubble; a half-finished tool loop with no final reply isn't a
          // failure, it's what they asked for.
          setStatusText(null);
          return;
        }
        console.error("[zora] send failed:", e);
        setStatusText(null);
        applyMessages((prev) => [
          ...prev,
          { id: nextId(), role: "model", text: "Something went wrong, try again.", time: Date.now(), failed: true },
        ]);
      } finally {
        setIsLoading(false);
        setPendingToolCall(null);
        abortRef.current = null;
      }
    },
    [isLoading, applyMessages, postJson, waitForApproval],
  );

  // Immediate-stop (zora-browser-integration-plan.md section 6) — aborts
  // whatever's in flight right now. If a tool approval card is showing,
  // resolves it as denied first so the awaited promise in send() above
  // doesn't hang forever on an abort with nobody left to click a button.
  const stop = useCallback(() => {
    approvalResolveRef.current?.(false);
    approvalResolveRef.current = null;
    setPendingToolCall(null);
    abortRef.current?.abort();
  }, []);

  const regenerate = useCallback(() => {
    const lastUser = [...messagesRef.current].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    applyMessages((prev) => prev.slice(0, prev.findIndex((m) => m.id === lastUser.id)));
    void send(lastUser.text);
  }, [applyMessages, send]);

  return {
    messages,
    isLoading,
    statusText,
    pendingToolCall,
    send,
    regenerate,
    stop,
    approveToolCall,
    denyToolCall,
  };
}

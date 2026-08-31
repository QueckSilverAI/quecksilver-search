import { useCallback, useEffect, useRef, useState } from "react";
import { SEARCH_CHAT_URL, SUPABASE_ANON_KEY } from "@/lib/supabase-config";

export type ZoraMessage = {
  id: string;
  role: "user" | "model";
  text: string;
  time: number;
  failed?: boolean;
  // "+" button in ZoraChatInput.tsx — shown as a small thumbnail on the
  // message itself so the person can see what they attached, alongside
  // being sent to Gemini as real image input (see send()'s imageBase64
  // param below).
  imageDataUrl?: string;
};

export type ImageAttachment = { name: string; mimeType: string; base64: string };

export type PendingToolCall = { name: string; args: Record<string, unknown> };

type GeminiContent = { role: "user" | "model"; parts: unknown[] };
type SearchChatResponse =
  | { reply: string; usage: unknown }
  | { toolCall: { name: string; args: Record<string, unknown> }; contents: GeminiContent[]; usage: unknown }
  | { error: string };
type ToolPermissionMode = "auto" | "ask";
type ToolCallResponse = Extract<SearchChatResponse, { toolCall: unknown }>;
type SentAppContext = {
  controlCenterSettings: unknown;
  openTabs: unknown;
  windowMode: unknown;
  activeTabDomain: string | null | undefined;
  screenShareEnabled: boolean;
} | null;

const MAX_CLIENT_HOPS = 20;

// Resolved entirely server-side — see the comment at the call site in
// send() below and supabase/functions/search-chat/index.ts.
const SERVER_RESOLVED_TOOLS = new Set(["web_search", "remember_preference", "fact_check", "find_coupon_codes"]);

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
  // Swiss banks/brokers — QueckSilver is a Swiss product, and the list
  // above was otherwise entirely US-centric (Chase, Wells Fargo) despite
  // that.
  /\bubs\.com$/i,
  /postfinance/i,
  /raiffeisen/i,
  /\bzkb\.ch$/i,
  /migrosbank/i,
  /swissquote/i,
  // Generic login/sign-in pages — not every sensitive form is a payment;
  // an account login is exactly the kind of field a person wouldn't want
  // Zora typing into on "auto" just because click_element/type_text
  // happened to be set that way for everyday browsing.
  /\blogin\b/i,
  /sign-?in/i,
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
// looping until a final text reply comes back (or MAX_CLIENT_HOPS is hit,
// see runHops below — that pauses with a "Continue" affordance rather
// than failing the turn, since a genuinely long multi-tool task hitting a
// round-number cap isn't an error, just a checkpoint).
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
export function useZoraChat(accessToken: string | null, attemptReauth?: () => Promise<boolean>) {
  const [messages, setMessages] = useState<ZoraMessage[]>([]);
  const messagesRef = useRef<ZoraMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [pendingToolCall, setPendingToolCall] = useState<PendingToolCall | null>(null);
  const [hopLimitReached, setHopLimitReached] = useState(false);
  // search-chat returns 401 specifically when a real (non-anon) access
  // token failed to validate — see search-chat/index.ts's auth block and
  // electron/auth.ts's own comment: this flow's token is short-lived with
  // no refresh, so a stale session is expected eventually, not a bug.
  // Rather than immediately surfacing that as an interruption, a 401 first
  // tries attemptReauth() (ZoraSidebar wires this to the same reauth flow
  // ZoraSessionExpiredCard's button used to trigger manually) — if the
  // person's system browser still has a live quecksilver.ch session, that
  // completes almost instantly with no typing required, so most of the
  // time this never becomes visible at all. sessionExpired (and
  // ZoraSessionExpiredCard) is now the FALLBACK for when attemptReauth
  // itself fails or isn't available — genuinely signed out, not just a
  // stale token.
  const [sessionExpired, setSessionExpired] = useState(false);
  const idRef = useRef(0);
  const nextId = () => `m${++idRef.current}`;
  const approvalResolveRef = useRef<((approved: boolean) => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // read_page_aloud/stop_reading (Phase N) — the one tool result that's
  // played locally instead of being sent back to Gemini as input, see the
  // result-handling branch inside runHops() below.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // What continueFromLimit() needs to pick up exactly where runHops() left
  // off — the still-unexecuted toolCall (with its contents so far) plus
  // the same appContext/permissions snapshot the rest of this turn used.
  const hopLimitStateRef = useRef<{
    response: ToolCallResponse;
    appContext: SentAppContext;
    permissions: Record<string, ToolPermissionMode>;
  } | null>(null);

  useEffect(() => {
    return window.browserAPI?.zora.onStopReading(() => {
      audioRef.current?.pause();
      audioRef.current = null;
    });
  }, []);

  // Once the caller hands in a new token (a successful login/reauth), the
  // stale-session card is no longer relevant — clears on its own rather
  // than waiting for the next send() to reset it.
  useEffect(() => {
    setSessionExpired(false);
  }, [accessToken]);

  // Shared by send()'s and continueFromLimit()'s catch blocks below — see
  // sessionExpired's own comment for the attemptReauth-first reasoning.
  // The turn itself isn't automatically retried (accessToken here is a
  // snapshot from whenever this hook instance's props last updated, not
  // necessarily the fresh one attemptReauth() just obtained) — instead
  // this just tells the person to send it again, once, rather than
  // silently losing what they typed.
  const handleUnauthorized = useCallback(async () => {
    const reauthed = attemptReauth ? await attemptReauth() : false;
    if (reauthed) {
      applyMessages((prev) => [
        ...prev,
        { id: nextId(), role: "model", text: "Reconnected — send that again.", time: Date.now(), failed: true },
      ]);
    } else {
      setSessionExpired(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptReauth]);

  const applyMessages = useCallback((updater: (prev: ZoraMessage[]) => ZoraMessage[]) => {
    setMessages((prev) => {
      const next = updater(prev);
      messagesRef.current = next;
      return next;
    });
  }, []);

  const postJson = useCallback(
    async (body: Record<string, unknown>, appContext: unknown, signal: AbortSignal): Promise<SearchChatResponse> => {
      // Retries transient failures (network blips, a cold-starting
      // function, a brief upstream rate limit) up to twice with a short
      // backoff before actually giving up — the exact symptom this was
      // added for: a tool call succeeds, then the very next hop in the
      // same turn intermittently fails and recovers seconds later on its
      // own. Never retries a definite failure (4xx other than 429) —
      // retrying a bad request or an auth problem wouldn't fix it, just
      // delay showing the real error.
      let lastError: unknown;
      for (let attempt = 0; attempt <= 2; attempt++) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        try {
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
            const isTransient = res.status === 429 || res.status >= 500;
            if (isTransient && attempt < 2) {
              lastError = new Error(`search-chat failed: ${res.status}`);
              await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
              continue;
            }
            throw new Error(`search-chat failed: ${res.status}`);
          }
          return (await res.json()) as SearchChatResponse;
        } catch (e) {
          if (signal.aborted || (e instanceof Error && e.name === "AbortError")) throw e;
          // A network-level failure (e.g. "Failed to fetch" — no HTTP
          // response at all, not even a 5xx) is exactly as transient as a
          // 5xx, and just as worth one retry.
          const isHttpError = e instanceof Error && e.message.startsWith("search-chat failed:");
          if (!isHttpError && attempt < 2) {
            console.error(`[zora] search-chat network error (attempt ${attempt + 1}):`, e);
            lastError = e;
            await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
            continue;
          }
          throw e;
        }
      }
      throw lastError;
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

  // Runs up to MAX_CLIENT_HOPS tool-execute-then-continue round trips
  // starting from `startResponse`. Returns a final `reply`/`error`
  // response once the model stops calling tools, OR — if the cap is hit
  // while a toolCall is still pending — the unexecuted ToolCallResponse
  // for continueFromLimit() to pick up later, distinguished from a normal
  // in-progress toolCall by the caller checking hops against the cap.
  const runHops = useCallback(
    async (
      startResponse: SearchChatResponse,
      appContext: SentAppContext,
      permissions: Record<string, ToolPermissionMode>,
      abort: AbortController,
    ): Promise<{ limitReached: true; pending: ToolCallResponse } | { limitReached: false; response: SearchChatResponse }> => {
      let response = startResponse;
      let hops = 0;

      while ("toolCall" in response && hops < MAX_CLIENT_HOPS) {
        if (abort.signal.aborted) return { limitReached: false, response };
        hops++;
        const { name, args } = response.toolCall;

        let result: { ok: boolean; text: string; imageBase64?: string; audioBase64?: string; audioMimeType?: string };
        // These four are resolved entirely server-side (web_search via
        // Gemini grounding; remember_preference/fact_check/find_coupon_codes
        // the same way, see supabase/functions/search-chat/index.ts) —
        // the client never actually executes them, just bounces an empty
        // placeholder so the loop continues.
        const isServerResolved = SERVER_RESOLVED_TOOLS.has(name);
        if (requiresApproval(name, permissions, appContext?.activeTabDomain)) {
          setStatusText(null);
          const approved = await waitForApproval({ name, args });
          if (abort.signal.aborted) return { limitReached: false, response };
          result = approved
            ? isServerResolved
              ? { ok: true, text: "" }
              : window.browserAPI
                ? await window.browserAPI.tools.execute(name, args)
                : { ok: false, text: "Browser tools aren't available outside the desktop app." }
            : { ok: false, text: "The person declined to run this tool. Don't retry it — ask what they'd like instead." };
        } else {
          setStatusText(statusFor(name, args));
          result = isServerResolved
            ? { ok: true, text: "" } // server redoes the real thing itself, see postJson comment above
            : window.browserAPI
              ? await window.browserAPI.tools.execute(name, args)
              : { ok: false, text: "Browser tools aren't available outside the desktop app." };
        }

        // read_page_aloud's audio is for the person to actually hear —
        // played locally right here, never forwarded to Gemini (unlike
        // imageBase64, which the server turns into real model input).
        if (result.audioBase64) {
          audioRef.current?.pause();
          const audio = new Audio(`data:${result.audioMimeType ?? "audio/wav"};base64,${result.audioBase64}`);
          audioRef.current = audio;
          void audio.play().catch(() => {});
        }

        response = await postJson(
          { contents: response.contents, toolResult: { name, response: result.text, imageBase64: result.imageBase64 } },
          appContext,
          abort.signal,
        );
      }

      if ("toolCall" in response) {
        return { limitReached: true, pending: response };
      }
      return { limitReached: false, response };
    },
    [postJson, waitForApproval],
  );

  // Shared by send() and continueFromLimit() — everything that happens
  // once runHops() actually stops (a real reply, a hard error, or the hop
  // cap hit again).
  const finishTurn = useCallback(
    (
      result: Awaited<ReturnType<typeof runHops>>,
      appContext: SentAppContext,
      permissions: Record<string, ToolPermissionMode>,
      abort: AbortController,
    ) => {
      setStatusText(null);
      if (abort.signal.aborted) return;

      if (result.limitReached) {
        hopLimitStateRef.current = { response: result.pending, appContext, permissions };
        setHopLimitReached(true);
        return;
      }
      if ("reply" in result.response) {
        applyMessages((prev) => [...prev, { id: nextId(), role: "model", text: result.response.reply, time: Date.now() }]);
      } else {
        throw new Error("error" in result.response ? result.response.error : "unresolved tool loop");
      }
    },
    [applyMessages],
  );

  const send = useCallback(
    async (rawText: string, attachment?: ImageAttachment) => {
      const text = rawText.trim();
      if ((!text && !attachment) || isLoading) return;

      const userMsg: ZoraMessage = {
        id: nextId(),
        role: "user",
        text,
        time: Date.now(),
        imageDataUrl: attachment ? `data:${attachment.mimeType};base64,${attachment.base64}` : undefined,
      };
      const historyBefore = messagesRef.current.map((m) => ({ role: m.role, text: m.text }));
      applyMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setHopLimitReached(false);
      hopLimitStateRef.current = null;
      setSessionExpired(false);
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        // Snapshot once per turn (not once per hop) — see
        // electron/build-app-context.ts. Only a subset of the full
        // AppContext travels over the wire; see AppContextPayload in
        // supabase/functions/search-chat/index.ts for which fields it reads.
        const fullAppContext = window.browserAPI ? await window.browserAPI.zora.getAppContext() : null;
        const zoraSettings = window.browserAPI ? await window.browserAPI.zora.getSettings() : null;
        const appContext: SentAppContext = fullAppContext
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

        const initial = await postJson(
          {
            prompt: text || "What do you see in this image?",
            history: historyBefore,
            imageBase64: attachment?.base64,
            imageMimeType: attachment?.mimeType,
          },
          appContext,
          abort.signal,
        );
        const result = await runHops(initial, appContext, permissions, abort);
        finishTurn(result, appContext, permissions, abort);
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
        if (e instanceof Error && e.message === "search-chat failed: 401") {
          void handleUnauthorized();
          return;
        }
        // A specific reason (rather than always the same generic
        // sentence) — helps tell "this is expected, wait and retry" (a
        // transient network/rate-limit blip that just wasn't recoverable
        // within postJson's own retries) apart from something actually
        // broken worth reporting.
        const reason =
          e instanceof Error && e.message.startsWith("search-chat failed:")
            ? `Something went wrong (${e.message.replace("search-chat failed: ", "error ")}). Try again in a moment.`
            : "Something went wrong, try again.";
        applyMessages((prev) => [
          ...prev,
          { id: nextId(), role: "model", text: reason, time: Date.now(), failed: true },
        ]);
      } finally {
        setIsLoading(false);
        setPendingToolCall(null);
        abortRef.current = null;
      }
    },
    [isLoading, applyMessages, postJson, runHops, finishTurn, handleUnauthorized],
  );

  // "Continue" button on the tool-limit card (QueckSilver AI /code's own
  // pattern for the same situation) — picks up the exact unexecuted
  // toolCall runHops() stopped on, not a fresh turn, so nothing about
  // what the model was doing gets lost or repeated.
  const continueFromLimit = useCallback(async () => {
    const saved = hopLimitStateRef.current;
    if (!saved || isLoading) return;
    setHopLimitReached(false);
    hopLimitStateRef.current = null;
    setIsLoading(true);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const result = await runHops(saved.response, saved.appContext, saved.permissions, abort);
      finishTurn(result, saved.appContext, saved.permissions, abort);
    } catch (e) {
      if (abort.signal.aborted) {
        setStatusText(null);
        return;
      }
      console.error("[zora] continue failed:", e);
      setStatusText(null);
      if (e instanceof Error && e.message === "search-chat failed: 401") {
        void handleUnauthorized();
      } else {
        applyMessages((prev) => [
          ...prev,
          { id: nextId(), role: "model", text: "Something went wrong, try again.", time: Date.now(), failed: true },
        ]);
      }
    } finally {
      setIsLoading(false);
      setPendingToolCall(null);
      abortRef.current = null;
    }
  }, [isLoading, runHops, finishTurn, applyMessages, handleUnauthorized]);

  // Immediate-stop (zora-browser-integration-plan.md section 6) — aborts
  // whatever's in flight right now. If a tool approval card is showing,
  // resolves it as denied first so the awaited promise in send() above
  // doesn't hang forever on an abort with nobody left to click a button.
  const stop = useCallback(() => {
    approvalResolveRef.current?.(false);
    approvalResolveRef.current = null;
    setPendingToolCall(null);
    audioRef.current?.pause();
    audioRef.current = null;
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
    hopLimitReached,
    sessionExpired,
    send,
    regenerate,
    stop,
    approveToolCall,
    denyToolCall,
    continueFromLimit,
  };
}

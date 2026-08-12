import { useCallback, useRef, useState } from "react";
import { SEARCH_CHAT_URL, SUPABASE_ANON_KEY } from "@/lib/supabase-config";

export type ZoraMessage = {
  id: string;
  role: "user" | "model";
  text: string;
  time: number;
  failed?: boolean;
};

type GeminiContent = { role: "user" | "model"; parts: unknown[] };
type SearchChatResponse =
  | { reply: string; usage: unknown }
  | { toolCall: { name: string; args: Record<string, unknown> }; contents: GeminiContent[]; usage: unknown }
  | { error: string };

const MAX_CLIENT_HOPS = 20;

function statusFor(name: string, args: Record<string, unknown>): string {
  if (name === "web_search") return `Searching the web for "${String(args["query"] ?? "")}"...`;
  return `Using ${name}…`;
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
export function useZoraChat(accessToken: string | null) {
  const [messages, setMessages] = useState<ZoraMessage[]>([]);
  const messagesRef = useRef<ZoraMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const idRef = useRef(0);
  const nextId = () => `m${++idRef.current}`;

  const applyMessages = useCallback((updater: (prev: ZoraMessage[]) => ZoraMessage[]) => {
    setMessages((prev) => {
      const next = updater(prev);
      messagesRef.current = next;
      return next;
    });
  }, []);

  const postJson = useCallback(
    async (body: Record<string, unknown>): Promise<SearchChatResponse> => {
      const res = await fetch(SEARCH_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // No account needed to chat — falls back to the public anon key,
          // same convention Supabase uses for unauthenticated calls.
          Authorization: `Bearer ${accessToken ?? SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(body),
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

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || isLoading) return;

      const userMsg: ZoraMessage = { id: nextId(), role: "user", text, time: Date.now() };
      const historyBefore = messagesRef.current.map((m) => ({ role: m.role, text: m.text }));
      applyMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      try {
        let response = await postJson({ prompt: text, history: historyBefore });
        let hops = 0;

        while ("toolCall" in response && hops < MAX_CLIENT_HOPS) {
          hops++;
          const { name, args } = response.toolCall;
          setStatusText(statusFor(name, args));

          const result =
            name === "web_search"
              ? { ok: true, text: "" } // server redoes the real search itself, see postJson comment above
              : window.browserAPI
                ? await window.browserAPI.tools.execute(name, args)
                : { ok: false, text: "Browser tools aren't available outside the desktop app." };

          response = await postJson({
            contents: response.contents,
            toolResult: { name, response: result.text },
          });
        }

        setStatusText(null);

        if ("reply" in response) {
          applyMessages((prev) => [...prev, { id: nextId(), role: "model", text: response.reply, time: Date.now() }]);
        } else {
          throw new Error("error" in response ? response.error : "unresolved tool loop");
        }
      } catch (e) {
        console.error("[zora] send failed:", e);
        setStatusText(null);
        applyMessages((prev) => [
          ...prev,
          { id: nextId(), role: "model", text: "Something went wrong — try again.", time: Date.now(), failed: true },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, applyMessages, postJson],
  );

  const regenerate = useCallback(() => {
    const lastUser = [...messagesRef.current].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    applyMessages((prev) => prev.slice(0, prev.findIndex((m) => m.id === lastUser.id)));
    void send(lastUser.text);
  }, [applyMessages, send]);

  return { messages, isLoading, statusText, send, regenerate };
}

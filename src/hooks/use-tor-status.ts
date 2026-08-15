import { useEffect, useState } from "react";

export type TorStatus =
  | { state: "stopped" }
  | { state: "starting"; bootstrapPercent: number; message: string }
  | { state: "ready"; socksPort: number }
  | { state: "error"; message: string };

export function useTorStatus() {
  const api = typeof window !== "undefined" ? window.browserAPI?.tor : undefined;
  const [status, setStatus] = useState<TorStatus>({ state: "stopped" });

  useEffect(() => {
    api?.getStatus().then((s) => s && setStatus(s));
    return api?.onStatusChanged((s) => setStatus(s));
  }, [api]);

  return { status, newIdentity: () => api?.newIdentity() };
}

import { LogIn } from "lucide-react";

type Props = { onSignIn: () => void };

// search-chat's access token is short-lived with no refresh (see
// electron/auth.ts) — a 401 here means the stored session went stale, not
// a real failure. Shown instead of the generic error bubble so there's an
// actual next step: use-zora-chat.ts clears this on its own once login()
// hands back a fresh token.
export function ZoraSessionExpiredCard({ onSignIn }: Props) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/60 px-4 py-3">
      <LogIn className="h-4 w-4 shrink-0 text-muted-foreground" />
      <p className="flex-1 text-sm text-foreground">Your session expired. Sign in again to keep chatting.</p>
      <button
        onClick={onSignIn}
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Sign in
      </button>
    </div>
  );
}

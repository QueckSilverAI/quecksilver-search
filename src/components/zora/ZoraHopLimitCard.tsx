import { ArrowRight, ListChecks } from "lucide-react";

type Props = { onContinue: () => void };

// zora-browser-integration-plan.md's tool-loop cap (MAX_CLIENT_HOPS = 20
// in use-zora-chat.ts) exists so one runaway turn can't loop forever —
// hitting it during a genuinely long multi-tool task isn't a failure, so
// it shouldn't look like one. Continue re-enters runHops() from the exact
// unexecuted toolCall it stopped on (see continueFromLimit()), not a
// fresh turn — nothing about what Zora was doing gets lost or repeated.
export function ZoraHopLimitCard({ onContinue }: Props) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/60 px-4 py-3">
      <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
      <p className="flex-1 text-sm text-foreground">Tool limit reached for this turn.</p>
      <button
        onClick={onContinue}
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Continue
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

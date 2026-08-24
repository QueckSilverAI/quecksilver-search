import { AlertTriangle, Check, X } from "lucide-react";
import type { PendingToolCall } from "@/hooks/use-zora-chat";

type Props = {
  call: PendingToolCall;
  onApprove: () => void;
  onDeny: () => void;
};

// Human-friendly one-liner per tool — kept here rather than fetched from
// electron/zora-tool-catalog.ts's descriptions (those are written for the
// model, not for a person glancing at a confirmation card, and fetching
// them just to render this would be an extra IPC round-trip for a static
// string). Falls back to the raw tool name for anything not listed, so a
// future tool added to browser-tools.ts without a line here still shows
// something reasonable instead of breaking.
const TOOL_LABELS: Record<string, string> = {
  new_tab: "open a new tab",
  close_tab: "close a tab",
  switch_tab: "switch to a different tab",
  open_url: "navigate to a URL",
  go_back: "go back in history",
  go_forward: "go forward in history",
  reload_tab: "reload the page",
  click_element: "click something on this page",
  type_text: "type into a field on this page",
  scroll_page: "scroll the page",
  add_bookmark: "save a bookmark",
  remove_bookmark: "remove a bookmark",
  set_control_center_setting: "change a Control Center setting",
  run_control_center_tool: "run a Control Center action",
  apply_preset: "apply a Control Center preset",
};

function describe(call: PendingToolCall): string {
  const base = TOOL_LABELS[call.name] ?? `run ${call.name}`;
  const detail =
    typeof call.args.selector === "string"
      ? ` (${call.args.selector})`
      : typeof call.args.url === "string"
        ? ` (${call.args.url})`
        : typeof call.args.key === "string"
          ? ` (${call.args.key})`
          : "";
  return `${base}${detail}`;
}

// Pauses the tool loop until the person clicks one of these — see
// use-zora-chat.ts's waitForApproval/approveToolCall/denyToolCall. Shown
// whenever electron/zora-tool-catalog.ts's resolveToolPermission (preset +
// per-tool override) says "ask" for this tool, or the sensitive-domain
// override in use-zora-chat.ts forced it regardless of preset.
export function ZoraToolApprovalCard({ call, onApprove, onDeny }: Props) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-sm text-foreground">
          Zora wants to <span className="font-medium">{describe(call)}</span>.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onDeny}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
          Deny
        </button>
        <button
          onClick={onApprove}
          className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Check className="h-3.5 w-3.5" />
          Allow
        </button>
      </div>
    </div>
  );
}

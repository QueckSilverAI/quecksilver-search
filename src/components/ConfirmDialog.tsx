import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  title: string;
  body: string;
  actionLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

// 1:1 the delete-confirmation pattern from QueckSilver AI's code workspace
// (CodeWorkspacePage.tsx) — same layout, spacing, and red destructive
// button, reused here for downloads and favorites instead of the generic
// shadcn Dialog.
export function ConfirmDialog({ open, title, body, actionLabel = "Delete", busy, onCancel, onConfirm }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onCancel}>
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="mb-2 text-base font-semibold text-foreground">{title}</p>
        <p className="mb-6 break-words text-sm text-muted-foreground">{body}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-xl border border-border px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onConfirm();
            }}
            disabled={busy}
            className="rounded-xl bg-red-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Shown while/after a Chrome or Edge import runs (favorites or passwords in
// SettingsView.tsx) — an indeterminate sliding-stripe bar while in
// progress (there's no real percentage to report, the backend does the
// whole thing in one call), then the plain result text once it's done.
export function ImportProgress({ text, inProgress }: { text: string; inProgress: boolean }) {
  return (
    <div className="mt-3 pl-11">
      <p className="text-sm font-medium text-foreground">{text}</p>
      {inProgress && (
        <div className="mt-2 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 rounded-full bg-[var(--brand)] animate-[import-progress_1.1s_ease-in-out_infinite]" />
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { Check, Download, Plus, type LucideIcon } from "lucide-react";
import type { ToolbarStyleId } from "@/lib/toolbar-style";
import type { ToolbarIconId } from "@/lib/settings-store";

export type ToolbarAction = {
  id: ToolbarIconId;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean; // e.g. split is currently on
  busy?: boolean; // e.g. a download is in progress
  justDone?: boolean; // e.g. a download just finished — brief checkmark
};

// The one download currently driving the toolbar's unified download state
// (see the early return below). Only the single most-recent progressing
// download is shown — the toolbar isn't a download manager, it's a status
// glance; Settings → Downloads is still where every download lives.
export type ActiveDownload = {
  filename: string;
  receivedBytes: number;
  totalBytes: number;
};

type Props = {
  style: ToolbarStyleId;
  actions: ToolbarAction[];
  // When set, the whole toolbar cluster renders as a single green
  // download-progress pill instead of whatever `style` normally draws —
  // deliberately the same look regardless of style, since a 17-way
  // reskin of an in-progress download isn't worth the upkeep and would
  // make the "something is downloading" signal less consistent, not more.
  activeDownload?: ActiveDownload;
  // Drag-reorder — same mechanism regardless of visual style, since it's
  // just which array position each action renders at.
  draggedId: ToolbarIconId | null;
  onDragStart: (id: ToolbarIconId) => void;
  onDropOn: (id: ToolbarIconId) => void;
  onDragEnd: () => void;
};

function iconColor(a: ToolbarAction, activeColor = "var(--brand)"): string | undefined {
  if (a.busy || a.active) return a.busy ? "#16a34a" : activeColor;
  return undefined;
}

function Glyph({ a, className }: { a: ToolbarAction; className?: string }) {
  if (a.justDone) return <Check className={className} strokeWidth={2.5} style={{ color: "#16a34a" }} />;
  const Icon = a.icon;
  return <Icon className={className} style={{ color: iconColor(a) }} />;
}

// A fixed-size square wrapper around icon + spin ring, so the ring is
// always a perfect circle centered on the icon — independent of whatever
// (rectangular, flex-col, padded) container the button itself has. Fixes
// the "ellipse" ring in non-square buttons and the "ring not lined up
// with the icon" issue in row/column layouts.
function SpinnerIcon({ a, ringClass = "h-[22px] w-[22px]", iconClass = "h-[15px] w-[15px]" }: { a: ToolbarAction; ringClass?: string; iconClass?: string }) {
  return (
    <span className={`relative flex shrink-0 items-center justify-center ${ringClass}`}>
      {a.busy && <span className="pointer-events-none absolute inset-0 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />}
      <Glyph a={a} className={iconClass} />
    </span>
  );
}

// Drag handlers are applied uniformly to whatever element each style
// renders as the clickable button — reordering is about array position,
// not about how that position happens to look.
function dragProps(a: ToolbarAction, draggedId: ToolbarIconId | null, onDragStart: Props["onDragStart"], onDropOn: Props["onDropOn"], onDragEnd: Props["onDragEnd"]) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData("text/plain", a.id);
      e.dataTransfer.effectAllowed = "move";
      onDragStart(a.id);
    },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (draggedId && draggedId !== a.id) onDropOn(a.id);
    },
    onDragEnd,
  };
}

export function ToolbarActionIcons({ style, actions, activeDownload, draggedId, onDragStart, onDropOn, onDragEnd }: Props) {
  const [clickedId, setClickedId] = useState<ToolbarIconId | null>(null);
  // Declared unconditionally here (not inside the sliding-highlight branch
  // below) — React requires the same hooks in the same order on every
  // render. Calling useState only when style === "sliding-highlight" meant
  // the hook count changed the moment someone switched TO or FROM that
  // style, which is exactly what was crashing the page ("This page didn't
  // load").
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const drag = (a: ToolbarAction) => dragProps(a, draggedId, onDragStart, onDropOn, onDragEnd);
  const opacity = (a: ToolbarAction) => (draggedId === a.id ? "opacity-40" : "");
  const withPulse = (a: ToolbarAction, onClick: () => void) => () => {
    onClick();
    setClickedId(a.id);
    setTimeout(() => setClickedId((v) => (v === a.id ? null : v)), 420);
  };

  // ── unified download state — overrides every style below while a
  // download is progressing. Clicking it opens Downloads, same as the
  // normal download icon (reuses that action's onClick rather than
  // hardcoding a route, so it stays correct if that ever changes). Placed
  // after every hook above (not as an early return right at the top) for
  // the exact same reason as the hoverIdx comment above: an early return
  // before a hook call changes the hook count between renders and crashes
  // the page the moment a download starts or finishes.
  if (activeDownload) {
    const pct = activeDownload.totalBytes > 0 ? Math.min(1, activeDownload.receivedBytes / activeDownload.totalBytes) : null;
    const openDownloads = actions.find((a) => a.id === "download")?.onClick;
    return (
      <button
        onClick={openDownloads}
        className="flex h-8 items-center gap-1.5 rounded-full bg-green-600 pl-2 pr-3 text-white shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
      >
        {/* Download icon — static, far left, deliberately its own element
            rather than the spinner drawn on top of it (that read as one
            confused icon instead of two separate signals: "this is a
            download" + "it's in progress"). */}
        <Download className="h-3.5 w-3.5 shrink-0" />
        {/* Spinner — a plain ring, nothing inside it, sitting beside the
            download icon rather than wrapping it. */}
        <span className="h-3 w-3 shrink-0 rounded-full border-2 border-white/40 border-t-white animate-spin" />
        {/* Name + progress bar — a fixed min/max width range so a short
            filename doesn't leave the whole pill looking squashed, but a
            very long one still gets truncated instead of growing forever. */}
        <span className="flex min-w-[110px] max-w-[180px] flex-col items-start gap-0.5">
          <span className="w-full truncate text-left text-[11px] font-semibold leading-none">{activeDownload.filename}</span>
          <span className="h-[3px] w-full overflow-hidden rounded-full bg-white/25">
            <span
              className="block h-full rounded-full bg-white transition-[width] duration-200"
              style={{ width: pct !== null ? `${Math.round(pct * 100)}%` : "40%", ...(pct === null ? { animation: "toolbar-download-indeterminate 1.2s ease-in-out infinite" } : {}) }}
            />
          </span>
        </span>
        <style>{`
          @keyframes toolbar-download-indeterminate {
            0% { transform: translateX(-60%); }
            100% { transform: translateX(160%); }
          }
        `}</style>
      </button>
    );
  }

  // ── seamless-pill — one h-8 pill, same height/shadow as the profile
  // pill next to it, all icons inside with just a per-icon hover circle
  // (no dividers between them, unlike segmented-pill above).
  if (style === "seamless-pill") {
    return (
      <div className="flex h-8 items-center gap-0.5 rounded-full bg-card px-1 shadow-[0_1px_3px_rgba(0,0,0,0.15)]">
        {actions.map((a) => (
          <button
            key={a.id}
            {...drag(a)}
            onClick={a.onClick}
            className={`relative flex h-6 w-6 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/10 ${opacity(a)}`}
          >
            {a.busy ? (
              <span className="h-4 w-4 shrink-0 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
            ) : (
              <Glyph a={a} className="h-[15px] w-[15px]" />
            )}
          </button>
        ))}
      </div>
    );
  }

  // ── plain — the original, always-visible row ──────────────────────
  if (style === "plain") {
    return (
      <div className="flex items-center gap-2.5">
        {actions.map((a) => (
          <button
            key={a.id}
            {...drag(a)}
            onClick={a.onClick}
            className={`relative flex h-8 w-8 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-foreground/5 ${a.active ? "bg-foreground/10" : ""} ${opacity(a)}`}
          >
            {a.busy && <span className="pointer-events-none absolute inset-1 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />}
            <Glyph a={a} className="h-4 w-4" />
          </button>
        ))}
      </div>
    );
  }

  // ── segmented-pill — one capsule, thin dividers ────────────────────
  if (style === "segmented-pill") {
    return (
      <div className="flex items-center overflow-hidden rounded-full bg-muted">
        {actions.map((a, i) => (
          <button
            key={a.id}
            {...drag(a)}
            onClick={a.onClick}
            className={`flex h-8 w-9 items-center justify-center bg-transparent text-foreground transition-colors hover:bg-foreground/5 ${i > 0 ? "border-l border-black/[0.06] dark:border-white/[0.08]" : ""} ${opacity(a)}`}
          >
            <SpinnerIcon a={a} ringClass="h-[28px] w-[28px]" />
          </button>
        ))}
      </div>
    );
  }

  // ── tinted-circles — permanent soft accent background ──────────────
  if (style === "tinted-circles") {
    return (
      <div className="flex items-center gap-2">
        {actions.map((a) => (
          <button
            key={a.id}
            {...drag(a)}
            onClick={a.onClick}
            className={`relative flex h-8 w-8 items-center justify-center rounded-full ${opacity(a)}`}
            style={{ background: a.busy ? "rgba(22,163,74,0.10)" : "var(--brand-10, rgba(45,108,210,0.10))" }}
          >
            {a.busy && <span className="pointer-events-none absolute -inset-0.5 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />}
            <Glyph a={a} className="h-[15px] w-[15px]" />
          </button>
        ))}
      </div>
    );
  }

  // ── labeled-card — icon + tiny label, one bordered card ─────────────
  if (style === "labeled-card") {
    return (
      <div className="flex items-center gap-0.5 rounded-xl border border-border bg-card px-1.5 py-1">
        {actions.map((a) => (
          <button
            key={a.id}
            {...drag(a)}
            onClick={a.onClick}
            className={`flex w-[52px] flex-col items-center gap-0.5 rounded-lg py-1 text-foreground transition-colors hover:bg-muted ${opacity(a)}`}
          >
            <SpinnerIcon a={a} ringClass="h-[26px] w-[26px]" />
            <span className="text-[9px] font-semibold tracking-tight text-muted-foreground">{a.label}</span>
          </button>
        ))}
      </div>
    );
  }

  // ── floating-island — detached pill with its own shadow ─────────────
  if (style === "floating-island") {
    return (
      <div className="flex items-center gap-0.5 rounded-full bg-card p-1 shadow-[0_2px_8px_rgba(0,0,0,0.10),0_1px_2px_rgba(0,0,0,0.06)]">
        {actions.map((a) => (
          <button
            key={a.id}
            {...drag(a)}
            onClick={a.onClick}
            className={`relative flex h-[30px] w-[30px] items-center justify-center rounded-full transition-colors ${opacity(a)}`}
            style={{ background: a.busy ? "#dcfce7" : undefined }}
          >
            {a.busy && !a.justDone && <span className="pointer-events-none absolute inset-0.5 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />}
            <Glyph a={a} className="h-[15px] w-[15px]" />
          </button>
        ))}
      </div>
    );
  }

  // ── sliding-highlight — soft background glides to hovered item ──────
  if (style === "sliding-highlight") {
    return (
      <div className="relative flex items-center gap-0.5" onMouseLeave={() => setHoverIdx(null)}>
        {hoverIdx !== null && (
          <span
            className="pointer-events-none absolute top-0 h-8 w-8 rounded-full bg-muted transition-transform duration-200 ease-out"
            style={{ transform: `translateX(${hoverIdx * 34}px)` }}
          />
        )}
        {actions.map((a, i) => (
          <button
            key={a.id}
            {...drag(a)}
            onMouseEnter={() => setHoverIdx(i)}
            onClick={a.onClick}
            className={`relative z-[1] flex h-8 w-8 items-center justify-center rounded-full bg-transparent text-foreground ${opacity(a)}`}
          >
            {a.busy && <span className="pointer-events-none absolute inset-1 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />}
            <Glyph a={a} className="h-[15px] w-[15px]" />
          </button>
        ))}
      </div>
    );
  }

  // ── gradient-strip — soft gradient background bar ───────────────────
  if (style === "gradient-strip") {
    return (
      <div
        className="flex items-center gap-1 rounded-full p-1"
        style={{ background: "linear-gradient(135deg, var(--brand-10, rgba(45,108,210,0.08)), transparent)", border: "1px solid var(--brand-16, rgba(45,108,210,0.12))" }}
      >
        {actions.map((a) => (
          <button
            key={a.id}
            {...drag(a)}
            onClick={a.onClick}
            className={`relative flex h-7 w-7 items-center justify-center rounded-full text-foreground ${opacity(a)}`}
            style={{ background: a.active ? "var(--card)" : "transparent", boxShadow: a.active ? "0 1px 3px rgba(0,0,0,0.12)" : undefined }}
          >
            {a.busy && <span className="pointer-events-none absolute inset-0.5 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />}
            <Glyph a={a} className="h-[15px] w-[15px]" />
          </button>
        ))}
      </div>
    );
  }

  // ── whitespace-groups — no dividers, spacing alone groups them ──────
  if (style === "whitespace-groups") {
    return (
      <div className="flex items-center">
        <div className="flex items-center gap-1.5">
          {actions.slice(0, 3).map((a) => (
            <button key={a.id} {...drag(a)} onClick={a.onClick} className={`relative flex h-7 w-7 items-center justify-center rounded-lg text-foreground hover:bg-foreground/5 ${opacity(a)}`}>
              {a.busy && <span className="pointer-events-none absolute inset-0.5 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />}
              <Glyph a={a} className="h-[15px] w-[15px]" />
            </button>
          ))}
        </div>
        <div className="w-5" />
        {actions.slice(3).map((a) => (
          <button key={a.id} {...drag(a)} onClick={a.onClick} className={`flex h-7 w-7 items-center justify-center rounded-lg text-foreground hover:bg-foreground/5 ${opacity(a)}`}>
            <Glyph a={a} className="h-[15px] w-[15px]" />
          </button>
        ))}
      </div>
    );
  }

  // ── elevated-chips — barely-there shadow, quiet precision ───────────
  if (style === "elevated-chips") {
    return (
      <div className="flex items-center gap-2">
        {actions.map((a) => (
          <button
            key={a.id}
            {...drag(a)}
            onClick={a.onClick}
            className={`relative flex h-8 w-8 items-center justify-center rounded-[9px] border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${opacity(a)}`}
          >
            {a.busy && <span className="pointer-events-none absolute inset-1 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />}
            <Glyph a={a} className="h-[15px] w-[15px]" />
          </button>
        ))}
      </div>
    );
  }

  // ── inline-chips — icon + word ───────────────────────────────────────
  if (style === "inline-chips") {
    return (
      <div className="flex items-center gap-1">
        {actions.map((a) => (
          <button
            key={a.id}
            {...drag(a)}
            onClick={a.onClick}
            className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold text-foreground hover:bg-foreground/5 ${a.active ? "bg-[var(--brand)]/10" : ""} ${opacity(a)}`}
          >
            <SpinnerIcon a={a} ringClass="h-[24px] w-[24px]" />
            {a.label}
          </button>
        ))}
      </div>
    );
  }

  // ── underline — plain otherwise, thin bar appears on hover ──────────
  if (style === "underline") {
    return (
      <div className="flex items-center gap-1">
        {actions.map((a) => (
          <button
            key={a.id}
            {...drag(a)}
            onClick={a.onClick}
            className={`group relative flex h-8 w-8 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-foreground/5 ${opacity(a)}`}
          >
            {a.busy && <span className="pointer-events-none absolute inset-1 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />}
            <Glyph a={a} className="h-4 w-4" />
            <span
              className="pointer-events-none absolute bottom-0.5 left-1.5 right-1.5 h-[2px] scale-x-0 rounded-full opacity-0 transition-all duration-150 group-hover:scale-x-100 group-hover:opacity-100"
              style={{ background: a.busy ? "#16a34a" : "var(--brand)" }}
            />
          </button>
        ))}
      </div>
    );
  }

  // ── click-pulse — a clean feedback animation on every click ──────────
  if (style === "click-pulse") {
    return (
      <div className="flex items-center gap-1.5">
        {actions.map((a) => (
          <button
            key={a.id}
            {...drag(a)}
            onClick={withPulse(a, a.onClick)}
            className={`relative flex h-8 w-8 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-foreground/5 ${opacity(a)}`}
          >
            {a.busy && <span className="pointer-events-none absolute inset-1 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />}
            {clickedId === a.id && (
              <span
                className="pointer-events-none absolute inset-0 rounded-lg"
                style={{ background: "var(--brand)", animation: "toolbar-pulse 0.42s ease-out" }}
              />
            )}
            <span className="relative z-[1]">
              <Glyph a={a} className="h-4 w-4" />
            </span>
          </button>
        ))}
        <style>{`
          @keyframes toolbar-pulse {
            0% { opacity: 0.35; transform: scale(0.7); }
            60% { opacity: 0.12; }
            100% { opacity: 0; transform: scale(1.35); }
          }
        `}</style>
      </div>
    );
  }

  // ── radial-fan — a single "+" that fans the four actions open ───────
  // Uses the details/summary-free CSS :focus-within trick instead of
  // React state, so no extra hook is needed here either.
  if (style === "radial-fan") {
    return (
      <div className="group/fan relative flex items-center">
        <button className="flex h-8 w-8 items-center justify-center rounded-full text-white" style={{ background: "var(--brand)" }} tabIndex={0}>
          <Plus className="h-4 w-4" />
        </button>
        <div className="ml-1.5 flex items-center gap-1 rounded-full border border-border bg-card p-1 opacity-0 shadow-md transition-opacity duration-150 group-focus-within/fan:opacity-100 group-hover/fan:opacity-100">
          {actions.map((a) => (
            <button
              key={a.id}
              {...drag(a)}
              onClick={a.onClick}
              className={`relative flex h-7 w-7 items-center justify-center rounded-full text-foreground hover:bg-foreground/5 ${opacity(a)}`}
            >
              {a.busy && <span className="pointer-events-none absolute inset-0.5 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />}
              <Glyph a={a} className="h-[15px] w-[15px]" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── progressive-dots — near-invisible until the row is hovered ──────
  // Pure CSS (group/group-hover), same reasoning as radial-fan.
  if (style === "progressive-dots") {
    return (
      <div className="group/dots flex items-center gap-2.5">
        {actions.map((a) => (
          <button
            key={a.id}
            {...drag(a)}
            onClick={a.onClick}
            className={`relative flex h-[6px] w-[6px] items-center justify-center rounded-full transition-all duration-150 group-hover/dots:h-7 group-hover/dots:w-7 ${a.busy ? "bg-green-500 group-hover/dots:bg-transparent" : ""} ${opacity(a)}`}
            style={a.busy ? undefined : { background: "var(--border)" }}
          >
            {a.busy && (
              <span className="pointer-events-none absolute inset-0 scale-50 rounded-full border-2 border-green-500 border-t-transparent opacity-0 animate-spin transition-all duration-150 group-hover/dots:scale-100 group-hover/dots:opacity-100" />
            )}
            <span className="pointer-events-none absolute scale-50 opacity-0 transition-all duration-150 group-hover/dots:scale-100 group-hover/dots:opacity-100">
              <Glyph a={a} className="h-[15px] w-[15px]" />
            </span>
          </button>
        ))}
      </div>
    );
  }

  // ── sliding-drawer — a handle that slides open on hover ─────────────
  if (style === "sliding-drawer") {
    return (
      <div className="group/drawer flex items-center overflow-hidden rounded-full bg-muted">
        <button className="flex h-8 w-8 shrink-0 items-center justify-center text-foreground">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <div className="flex max-w-0 items-center overflow-hidden transition-all duration-300 group-hover/drawer:max-w-[160px]">
          {actions.map((a) => (
            <button
              key={a.id}
              {...drag(a)}
              onClick={a.onClick}
              className={`relative flex h-8 w-8 shrink-0 items-center justify-center text-foreground ${opacity(a)}`}
            >
              {a.busy && <span className="pointer-events-none absolute inset-1 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />}
              <Glyph a={a} className="h-[15px] w-[15px]" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── underline-slide — new default: the "underline" look, but the
  // hover highlight is a single shared square that glides between icons
  // (like sliding-highlight) instead of each button lighting up on its
  // own. hoverIdx is declared once at the top of the component, shared
  // with sliding-highlight, so this needs no hook of its own.
  return (
    <div className="relative flex items-center gap-0.5" onMouseLeave={() => setHoverIdx(null)}>
      {hoverIdx !== null && (
        <span
          className="pointer-events-none absolute top-0 z-0 h-8 w-8 rounded-lg bg-foreground/5 transition-transform duration-200 ease-out"
          style={{ transform: `translateX(${hoverIdx * 34}px)` }}
        />
      )}
      {actions.map((a, i) => (
        <button
          key={a.id}
          {...drag(a)}
          onMouseEnter={() => setHoverIdx(i)}
          onClick={a.onClick}
          className={`relative z-[1] flex h-8 w-8 items-center justify-center rounded-lg text-foreground ${opacity(a)}`}
        >
          {a.busy && <span className="pointer-events-none absolute inset-1 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />}
          <Glyph a={a} className="h-4 w-4" />
          <span
            className={`pointer-events-none absolute bottom-0.5 left-1.5 right-1.5 h-[2px] rounded-full transition-all duration-150 ${hoverIdx === i ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"}`}
            style={{ background: a.busy ? "#16a34a" : "var(--brand)" }}
          />
        </button>
      ))}
    </div>
  );
}

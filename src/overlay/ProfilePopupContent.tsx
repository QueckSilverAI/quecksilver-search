// Content-only port of the old src/components/ProfilePopup.tsx (removed —
// every caller of the profile menu now goes through the native overlay
// window), now hosted inside that native overlay window (see
// electron/overlay-window.ts) instead of as an absolutely-positioned DOM
// panel in the main chrome window. That old approach needed the active
// tab's native WebContentsView hidden for the whole time this was open —
// this doesn't, since it's a genuinely separate native window that can sit
// above the tab's view on its own.
import { useState } from "react";
import { LogOut, Plus, UserRound, RefreshCw, EyeOff } from "lucide-react";
import { TorOnionLogo } from "@/components/TorOnionLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueckSilverLogo } from "@/components/QueckSilverLogo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActiveIdentity, Profile } from "@/hooks/use-browser-api";
import type { ProfileOverlayAction, ProfileOverlayPayload } from "@/overlay/types";

// Same reasoning as ProfilePopup.tsx's original — Incognito/Tor windows
// are guest-like too, but shouldn't disable "Browse as guest".
function isPlainGuestWindow(active: ActiveIdentity): boolean {
  return active.guestMode && !active.windowMode;
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function initialFor(profile: Profile): string {
  const source = profile.kind === "quecksilver" ? (profile.email ?? profile.name) : profile.name;
  return source.charAt(0).toUpperCase() || "?";
}

function Avatar({ profile, size = "h-9 w-9", textSize = "text-[13px]" }: { profile: Profile; size?: string; textSize?: string }) {
  return (
    <span
      className={`grid ${size} shrink-0 place-items-center rounded-full ${textSize} font-semibold text-white`}
      style={{ background: profile.kind === "quecksilver" ? "var(--brand)" : "hsl(240 4% 46%)" }}
    >
      {initialFor(profile)}
    </span>
  );
}

export function ProfilePopupContent({
  payload,
  onAction,
  onNotify,
}: {
  payload: ProfileOverlayPayload;
  onAction: (action: ProfileOverlayAction) => void;
  onNotify: (action: ProfileOverlayAction) => void;
}) {
  const { profiles, active, loginPending, syncing } = payload;

  // "list" = the main profile switcher. "choose" = QueckSilver vs simple.
  // "name" = typing a name for a new simple profile. Purely local to this
  // window's own lifetime — a fresh overlay open() sends a new
  // "overlay:init" payload but doesn't remount this component (the
  // overlay window is hidden, not destroyed, between opens — see
  // overlay-window.ts's close()), so step intentionally does NOT reset
  // itself on every payload change; only a full close (blur/Escape/action
  // taken) throws it away by virtue of the window being hidden and
  // reopened via a fresh mount next time this route itself unmounts.
  const [step, setStep] = useState<"list" | "choose" | "name">("list");
  const [newProfileName, setNewProfileName] = useState("");
  const [removeTarget, setRemoveTarget] = useState<Profile | null>(null);

  function handleCreateSimple() {
    if (!newProfileName.trim()) return;
    onAction({ type: "createSimple", name: newProfileName.trim() });
  }

  const activeProfile = !active.guestMode ? (profiles.find((p) => p.id === active.activeProfileId) ?? null) : null;
  const otherProfiles = profiles.filter((p) => p.id !== active.activeProfileId || active.guestMode);

  return (
    <>
      {/* max-h is a fixed pixel cap, deliberately NOT calc(100vh-24px) —
          "vh" here means the OVERLAY WINDOW's own current height, which
          starts at a tiny placeholder (see overlay-window.ts's
          INITIAL_SIZE) before this content has ever been measured. A
          vh-based cap creates a circular dependency: content height gets
          capped by the window's (still tiny) height, then the measured
          (now-capped-tiny) content height is what the window gets resized
          to — permanently stuck small. A fixed cap breaks that loop; 640px
          comfortably fits the profile list without ever needing it in
          practice, with overflow-y-auto as a genuine fallback only for an
          unusually long profile list. No CSS box-shadow on this root div
          on purpose — the native overlay window is sized EXACTLY to this
          div's own measured bounds (see reportSize in overlay-window.ts),
          and box-shadow paints outside those bounds without affecting
          layout size, so it would get hard-clipped into a visible
          rectangular edge right where the window ends instead of fading
          out. hasShadow:false already means there's no native window
          shadow either — this popup is just flat, deliberately. */}
      <div className="w-[340px] max-h-[640px] overflow-y-auto rounded-2xl border border-border bg-popover p-4 text-popover-foreground">
        {step === "list" && (
          <>
            <h2 className="mb-2 text-base font-semibold leading-none tracking-tight text-foreground">Profiles</h2>

            {activeProfile ? (
              <div className="flex flex-col items-center gap-0.5 rounded-2xl bg-muted px-5 py-4 text-center">
                <Avatar profile={activeProfile} size="h-12 w-12" textSize="text-lg" />
                <div className="mt-1">
                  <p className="text-base font-semibold text-foreground">
                    {activeProfile.kind === "quecksilver" && activeProfile.email ? nameFromEmail(activeProfile.email) : activeProfile.name}
                  </p>
                  <p className="text-[13px] text-muted-foreground">{activeProfile.kind === "quecksilver" ? activeProfile.email : "On this device"}</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-0.5 rounded-2xl bg-muted px-5 py-4 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground">
                  <UserRound className="h-6 w-6" />
                </span>
                <div className="mt-1">
                  <p className="text-base font-semibold text-foreground">
                    {active.windowMode === "tor" ? "Tor" : active.windowMode === "incognito" ? "Incognito" : "Anonymous"}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {active.windowMode === "tor" ? "Browsing with Tor" : active.windowMode === "incognito" ? "You've gone Incognito" : "Browsing as a guest"}
                  </p>
                </div>
              </div>
            )}

            {activeProfile && (
              <div className="mt-2 flex w-full flex-col items-center gap-1.5">
                {activeProfile.kind === "quecksilver" && (
                  <div className="flex w-full flex-col items-center gap-1.5">
                    <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                      <button
                        onClick={() => onNotify({ type: "syncNow" })}
                        title="Sync now"
                        disabled={syncing}
                        className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                      </button>
                      <span>{syncing ? "Syncing…" : "Synced to the cloud"}</span>
                    </div>
                    {/* Indeterminate — the sync call itself doesn't report
                        real progress (it's a single request/response, not
                        a streamed operation), so this is a moving bar
                        rather than a filling one, same idea as a browser's
                        own "loading" bar. Shown/hidden by mounting the
                        element itself (not just toggling opacity), so
                        there's no empty gap reserving its height while
                        not syncing. */}
                    {syncing && (
                      <div className="h-1 w-32 overflow-hidden rounded-full bg-muted">
                        <div className="h-full w-1/3 animate-[import-progress_1.1s_ease-in-out_infinite] rounded-full bg-[var(--brand)]" />
                      </div>
                    )}
                  </div>
                )}
                <button
                  onClick={() => setRemoveTarget(activeProfile)}
                  className="rounded-full bg-red-600 px-5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-red-700"
                >
                  Log out
                </button>
              </div>
            )}

            {otherProfiles.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Other profiles</p>
                <div className="flex flex-col">
                  {otherProfiles.map((profile) => (
                    <div key={profile.id} className="group flex items-center gap-1 rounded-xl transition-colors hover:bg-muted">
                      <button
                        onClick={() => onAction({ type: "openProfileInNewWindow", id: profile.id })}
                        className="flex flex-1 items-center gap-3 px-2 py-1.5 text-left"
                      >
                        <Avatar profile={profile} />
                        <span className="flex flex-col">
                          <span className="text-[13px] font-medium text-foreground">
                            {profile.kind === "quecksilver" ? (profile.email ? nameFromEmail(profile.email) : profile.name) : profile.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{profile.kind === "quecksilver" ? profile.email : "On this device"}</span>
                        </span>
                      </button>
                      <button
                        onClick={() => setRemoveTarget(profile)}
                        title="Log out"
                        className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground opacity-0 transition-colors transition-opacity hover:bg-red-600 hover:text-white group-hover:opacity-100"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="my-2.5 h-px bg-border/60" />

            <div className="flex flex-col">
              <button
                onClick={() => setStep("choose")}
                className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-muted"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-dashed border-border text-muted-foreground">
                  <Plus className="h-4 w-4" />
                </span>
                <span className="text-[13px] font-semibold text-foreground">Add profile</span>
              </button>

              <button
                onClick={() => onAction({ type: "openGuestInNewWindow" })}
                disabled={isPlainGuestWindow(active)}
                className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <UserRound className="h-4 w-4" />
                </span>
                <span className="text-[13px] font-semibold text-foreground">{isPlainGuestWindow(active) ? "Browsing as guest" : "Browse as guest"}</span>
              </button>

              <button
                onClick={() => onAction({ type: "openIncognitoInNewWindow" })}
                className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-muted"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#1f1f24] text-white">
                  <EyeOff className="h-4 w-4" />
                </span>
                <span className="text-[13px] font-semibold text-foreground">Open Incognito window</span>
              </button>

              <button
                onClick={() => onAction({ type: "openTorInNewWindow" })}
                className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-muted"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#6b3fa0] text-white">
                  <TorOnionLogo className="h-4 w-4" strokeWidth={2} />
                </span>
                <span className="text-[13px] font-semibold text-foreground">Open Tor window</span>
              </button>
            </div>
          </>
        )}

        {step === "choose" && (
          <>
            <div className="mb-3">
              <h2 className="text-base font-semibold leading-none tracking-tight text-foreground">Add a profile</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">Sign in with QueckSilver, or add a local profile.</p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => onAction({ type: "loginQuecksilver" })}
                disabled={loginPending}
                className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-3 py-3 text-left transition-colors hover:bg-muted disabled:opacity-50"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white shadow-sm">
                  <QueckSilverLogo className="h-6 w-6" style={{ color: "var(--brand)" }} />
                </span>
                <span>
                  <span className="block text-[13px] font-semibold text-foreground">Continue with QueckSilver</span>
                  <span className="block text-[11px] text-muted-foreground">Syncs favorites, settings and passwords to the cloud</span>
                </span>
              </button>
              <button
                onClick={() => setStep("name")}
                className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-3 py-3 text-left transition-colors hover:bg-muted"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <UserRound className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-[13px] font-semibold text-foreground">Add profile</span>
                  <span className="block text-[11px] text-muted-foreground">Kept on this device only</span>
                </span>
              </button>
              <button
                onClick={() => onAction({ type: "openGuestInNewWindow" })}
                disabled={isPlainGuestWindow(active)}
                className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-3 py-3 text-left transition-colors hover:bg-muted disabled:opacity-50"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <UserRound className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-[13px] font-semibold text-foreground">Browse as guest</span>
                  <span className="block text-[11px] text-muted-foreground">Nothing is saved</span>
                </span>
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" onClick={() => setStep("list")} className="rounded-full">Back</Button>
            </div>
          </>
        )}

        {step === "name" && (
          <>
            <div className="mb-3">
              <h2 className="text-base font-semibold leading-none tracking-tight text-foreground">Name this profile</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">Just a label to tell it apart.</p>
            </div>
            <Input
              autoFocus
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              placeholder="e.g. Work"
              onKeyDown={(e) => e.key === "Enter" && handleCreateSimple()}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep("choose")} className="rounded-full">Back</Button>
              <Button onClick={handleCreateSimple} disabled={!newProfileName.trim()} className="rounded-full text-white shadow hover:opacity-90" style={{ background: "var(--brand)" }}>
                Add profile
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Destructive confirmation — a real centered modal within the
          overlay window's own small viewport. Radix's Dialog portals into
          `document.body` by default, which here is this overlay window's
          own document, not the main chrome window's — exactly what's
          wanted, since this window has nothing else in it to portal over. */}
      <Dialog open={removeTarget !== null} onOpenChange={(next) => !next && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{removeTarget?.kind === "quecksilver" ? "Sign out?" : "Remove this profile?"}</DialogTitle>
            <DialogDescription>
              {removeTarget?.kind === "quecksilver"
                ? `You'll be signed out as ${removeTarget?.email}. Its favorites and passwords stay safe in the cloud, just removed from this device.`
                : `"${removeTarget?.name}" and everything saved in it (favorites, passwords, settings) will be permanently removed from this device.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)} className="rounded-full">Cancel</Button>
            <Button
              variant="destructive"
              className="rounded-full"
              onClick={() => {
                if (removeTarget) onAction({ type: "remove", id: removeTarget.id });
                setRemoveTarget(null);
              }}
            >
              {removeTarget?.kind === "quecksilver" ? "Sign out" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

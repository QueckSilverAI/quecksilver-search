import { useEffect, useRef, useState } from "react";
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

// Guest windows are plain windows with guestMode=true and no windowMode.
// Incognito/Tor windows ALSO set guestMode=true (they're guest-like too -
// see use-profiles.ts), but carry their own windowMode. Without excluding
// that, "Browse as guest" read as already-active (and got disabled) from
// inside an Incognito or Tor window, even though a real, plain guest
// window is a genuinely different thing you'd still want to open from
// there. Only a true plain guest window should disable this button.
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

// Where the popup opens from - the profile button's own bounding rect,
// captured at click time (see index.tsx's onClick handlers). Anchoring to
// this (instead of the centered Dialog this used to be) matches the
// reference design: the panel hangs directly off the avatar/name button in
// the header, right-edge aligned, the same way a real browser's own
// account switcher does.
type AnchorRect = { top: number; left: number; right: number; bottom: number };

export function ProfilePopup({
  open,
  onOpenChange,
  anchorRect,
  profiles,
  active,
  onOpenProfileInNewWindow,
  onOpenGuestInNewWindow,
  onOpenIncognitoInNewWindow,
  onOpenTorInNewWindow,
  onRemove,
  onCreateSimple,
  onLoginQuecksilver,
  onSyncNow,
  loginPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRect: AnchorRect | null;
  profiles: Profile[];
  active: ActiveIdentity;
  onOpenProfileInNewWindow: (id: string) => void;
  onOpenGuestInNewWindow: () => void;
  onOpenIncognitoInNewWindow: () => void;
  onOpenTorInNewWindow: () => void;
  onRemove: (id: string) => void;
  onCreateSimple: (name: string) => void;
  onLoginQuecksilver: () => void;
  onSyncNow: () => Promise<boolean> | undefined;
  loginPending: boolean;
}) {
  // "list" = the main profile switcher. "choose" = QueckSilver vs simple.
  // "name" = typing a name for a new simple profile. One small state
  // machine instead of a separate dialog per step, since this is a quick,
  // low-stakes flow.
  const [step, setStep] = useState<"list" | "choose" | "name">("list");
  const [newProfileName, setNewProfileName] = useState("");
  const [removeTarget, setRemoveTarget] = useState<Profile | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "done">("idle");
  const popupRef = useRef<HTMLDivElement | null>(null);

  function handleSyncNow() {
    if (syncState === "syncing") return;
    setSyncState("syncing");
    Promise.resolve(onSyncNow())
      .then(() => {
        setSyncState("done");
        setTimeout(() => setSyncState("idle"), 1800);
      })
      .catch(() => setSyncState("idle"));
  }

  function close() {
    onOpenChange(false);
    // Reset after the close animation has room to finish, so the dialog
    // doesn't visibly flash back to "list" while it's still fading out.
    setTimeout(() => {
      setStep("list");
      setNewProfileName("");
      setRemoveTarget(null);
    }, 200);
  }

  // Closes on any click outside the panel, and on Escape - same two exits
  // a Radix Dialog would have given for free, reimplemented here since
  // this is now a plain anchored panel instead of a modal. mousedown (not
  // click) so the panel is already closing by the time whatever was
  // clicked underneath gets its own click event, matching the context
  // menu's own outside-click handling in index.tsx.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (popupRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleCreateSimple() {
    if (!newProfileName.trim()) return;
    onCreateSimple(newProfileName.trim());
    close();
  }

  function handleQuecksilverLogin() {
    onLoginQuecksilver();
    close();
  }

  const activeProfile = !active.guestMode ? (profiles.find((p) => p.id === active.activeProfileId) ?? null) : null;
  const otherProfiles = profiles.filter((p) => p.id !== active.activeProfileId || active.guestMode);

  return (
    <>
      {open && (
        <div
          ref={popupRef}
          className="fixed z-[100] w-[340px] max-h-[calc(100vh-24px)] origin-top-right overflow-y-auto rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-2xl duration-150 animate-in fade-in-0 zoom-in-95 [-webkit-app-region:no-drag]"
          style={
            anchorRect
              ? { top: anchorRect.bottom + 8, right: Math.max(12, window.innerWidth - anchorRect.right) }
              : { top: 56, right: 12 }
          }
        >
          {step === "list" && (
            <>
              <h2 className="mb-2 text-base font-semibold leading-none tracking-tight text-foreground">Profiles</h2>

              {/* Current profile - a card at the top with just avatar/name/
                  email (matching Chrome's own profile menu), same shape
                  whether it's a real profile or guest mode. Sync/log out
                  sit as their own separate rows below it, not inside it. */}
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
                <div className="mt-2 flex flex-col items-center gap-1.5">
                  {activeProfile.kind === "quecksilver" && (
                    <div className="flex flex-col items-center gap-1.5">
                      {/* Only the icon is the click target - the label
                          next to it is purely informational. */}
                      <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                        <button
                          onClick={handleSyncNow}
                          disabled={syncState === "syncing"}
                          title="Sync now"
                          className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${syncState === "syncing" ? "animate-spin" : ""}`} />
                        </button>
                        <span>{syncState === "syncing" ? "Syncing…" : syncState === "done" ? "Synced" : "Synced to the cloud"}</span>
                      </div>
                      {syncState === "syncing" && (
                        <span className="h-1 w-20 overflow-hidden rounded-full bg-muted">
                          <span className="block h-full w-1/3 rounded-full bg-[var(--brand)] animate-[import-progress_1.1s_ease-in-out_infinite]" />
                        </span>
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
                          onClick={() => {
                            onOpenProfileInNewWindow(profile.id);
                            close();
                          }}
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
                  onClick={() => {
                    onOpenGuestInNewWindow();
                    close();
                  }}
                  disabled={isPlainGuestWindow(active)}
                  className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                    <UserRound className="h-4 w-4" />
                  </span>
                  <span className="text-[13px] font-semibold text-foreground">{isPlainGuestWindow(active) ? "Browsing as guest" : "Browse as guest"}</span>
                </button>

                <button
                  onClick={() => {
                    onOpenIncognitoInNewWindow();
                    close();
                  }}
                  className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-muted"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#1f1f24] text-white">
                    <EyeOff className="h-4 w-4" />
                  </span>
                  <span className="text-[13px] font-semibold text-foreground">Open Incognito window</span>
                </button>

                <button
                  onClick={() => {
                    onOpenTorInNewWindow();
                    close();
                  }}
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
                  onClick={handleQuecksilverLogin}
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
                  onClick={() => {
                    onOpenGuestInNewWindow();
                    close();
                  }}
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
      )}

      {/* Destructive confirmation stays a real centered modal - unlike the
          switcher above, this isn't anchored to any particular button
          (it can be reached from either the "list" or "choose" step). */}
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
                if (removeTarget) onRemove(removeTarget.id);
                setRemoveTarget(null);
                close();
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

// Icon for Tor-related UI, dropped in everywhere the generic lucide
// <Shield> was previously used as a stand-in for "this is the Tor feature"
// (Open Tor window, the Tor connecting screen, New Identity, the Tor
// binary path setting). Geometry is the uploaded quecksilver-icon-v4.svg
// mark (solid half-disk + three concentric open rings), redrawn here with
// fill/stroke="currentColor" instead of its own gradient so it still
// inherits color from whatever wraps it - white on the purple Tor avatar
// circle, text-muted-foreground in Settings rows, text-[#8a5fc4] on the
// connecting screen, etc. - exactly like the old stroke icon did. Keeps
// the same className/style/strokeWidth props as before so every existing
// call site drops in unchanged; strokeWidth is accepted but unused since
// this mark's ring thickness is fixed proportionally to its own viewBox.
export function TorOnionLogo({ className, style }: { className?: string; style?: React.CSSProperties; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 200 200" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* solid half */}
      <path d="M 100 16 A 84 84 0 0 0 100 184 Z" fill="currentColor" />
      {/* concentric open rings */}
      <path d="M 100 23 A 77 77 0 0 1 100 177" fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="butt" />
      <path d="M 100 49 A 51 51 0 0 1 100 151" fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="butt" />
      <path d="M 100 75 A 25 25 0 0 1 100 125" fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="butt" />
    </svg>
  );
}

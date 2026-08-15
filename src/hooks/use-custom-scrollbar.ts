import { useEffect, useRef, useState, type RefObject } from "react";

// Same track/thumb math as electron/tab-preload.ts's buildScrollbar() — kept
// in sync deliberately so the widget behaves identically whether it's
// injected into a browsed page or rendered here for our own chrome UI
// (Start/Settings, see PageScrollbar.tsx).
const SCROLL_STEP = 120;

export function useCustomScrollbar(scrollRef: RefObject<HTMLElement | null>) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [thumbHeight, setThumbHeight] = useState(0);
  const [thumbTop, setThumbTop] = useState(0);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    // Only scrollRef's element is required to even set up listeners — the
    // track div isn't mounted yet at this point (PageScrollbar doesn't
    // render it until visible is already true), and gating this whole
    // effect on it existing meant NONE of the listeners below, or the
    // raf/timeout fallbacks, ever got attached in the first place. See the
    // comment inside update() below for the full chain of why that left
    // the scrollbar permanently invisible.
    if (!el) return;

    function update() {
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;
      // Rounded, and compared with a wider (3px, not 1px) tolerance —
      // CSS `zoom` (used by ZoomedContent for Start/Settings) computes
      // layout at the zoomed scale, so a fractional zoom factor (0.8,
      // 0.67, ...) can leave scrollHeight a sub-pixel above clientHeight
      // even when there's nothing to actually scroll. A 1px tolerance
      // wasn't enough slack for that and flashed the scrollbar in on
      // zoom changes that didn't really overflow.
      const scrollH = Math.round(scrollEl.scrollHeight);
      const clientH = Math.round(scrollEl.clientHeight);
      const scrollable = scrollH > clientH + 3;
      setVisible(scrollable);
      // The track div (trackRef) only exists in the DOM once PageScrollbar
      // itself is already rendering the "visible" branch — on the very
      // first call here, right after mount, visible is still false and the
      // track hasn't rendered yet, so trackRef.current is null. That used
      // to make this whole function bail out immediately (checking
      // `!track` up front) and never run again (the effect only reruns on
      // scrollRef changing, which never happens for a stable ref), so
      // "visible" got stuck at false forever — no scrollbar ever appeared,
      // no matter how much content overflowed. Splitting the visibility
      // check (needs only scrollEl) from the thumb-size math (needs track,
      // only available a render later) fixes that: setVisible above runs
      // regardless, and the already-scheduled raf/timeout calls below
      // pick up the thumb measurements once the track has actually
      // mounted a moment later.
      const track = trackRef.current;
      if (!scrollable || !track) return;
      const trackH = track.clientHeight;
      if (trackH === 0) return;

      setAtTop(scrollEl.scrollTop <= 1);
      setAtBottom(scrollEl.scrollTop + clientH >= scrollH - 1);

      const ratio = clientH / scrollH;
      const h = Math.max(36, trackH * ratio);
      const maxTop = trackH - h;
      const top = (scrollEl.scrollTop / (scrollH - clientH)) * maxTop;
      setThumbHeight(h);
      setThumbTop(Math.min(Math.max(top, 0), maxTop));
    }

    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // Catches content that grows/shrinks the container without firing
    // scroll/resize — settings sections expanding, favorites loading in,
    // route-internal content swaps.
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const raf = requestAnimationFrame(update);
    const t1 = setTimeout(update, 150);
    const t2 = setTimeout(update, 600);

    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      mo.disconnect();
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [scrollRef]);

  function scrollByStep(direction: 1 | -1) {
    scrollRef.current?.scrollBy({ top: direction * SCROLL_STEP, behavior: "smooth" });
  }

  function onThumbMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    setDragging(true);

    const startY = e.clientY;
    const startScroll = el.scrollTop;
    const trackH = track.clientHeight;
    const thumbH = Math.max(36, trackH * (el.clientHeight / el.scrollHeight));
    const scrollRange = el.scrollHeight - el.clientHeight;
    const trackRange = trackH - thumbH;

    function onMove(ev: MouseEvent) {
      const ratio = trackRange > 0 ? (ev.clientY - startY) / trackRange : 0;
      el!.scrollTop = Math.max(0, Math.min(scrollRange, startScroll + ratio * scrollRange));
    }
    function onUp() {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return { trackRef, visible, thumbHeight, thumbTop, atTop, atBottom, dragging, scrollByStep, onThumbMouseDown };
}

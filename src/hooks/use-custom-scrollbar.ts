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
    const track = trackRef.current;
    if (!el || !track) return;

    function update() {
      const trackH = track!.clientHeight;
      const scrollH = el!.scrollHeight;
      const clientH = el!.clientHeight;
      const scrollable = scrollH > clientH + 1;
      setVisible(scrollable);
      if (!scrollable || trackH === 0) return;

      setAtTop(el!.scrollTop <= 1);
      setAtBottom(el!.scrollTop + clientH >= scrollH - 1);

      const ratio = clientH / scrollH;
      const h = Math.max(36, trackH * ratio);
      const maxTop = trackH - h;
      const top = (el!.scrollTop / (scrollH - clientH)) * maxTop;
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

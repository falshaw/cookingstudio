"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Card picture for grids: a small lazy thumbnail (WebP, ~30 KB) and NO video element until the card is
 * hovered or focused — then the loop clip is mounted and plays; leaving removes it again.
 * Why: a grid of 180+ cards, each pulling the full-size original as a <video poster> and looping at once,
 * makes the page lag. Never plays under prefers-reduced-motion.
 */
export function HoverClip({ thumb, video, alt, className }: { thumb: string; video: string; alt: string; className?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const host = el.closest("a, article, li") ?? el.parentElement ?? el;
    const enter = () => {
      if (!reduce.matches) setOn(true);
    };
    const leave = (e: Event) => {
      const next = (e as FocusEvent).relatedTarget as Node | null;
      if (e.type === "focusout" && next && host.contains(next)) return;
      setOn(false);
    };
    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("focusin", enter);
    host.addEventListener("focusout", leave);
    return () => {
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("focusin", enter);
      host.removeEventListener("focusout", leave);
    };
  }, []);
  return (
    <span className="relative block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={ref} src={thumb} alt={alt} loading="lazy" decoding="async" className={className} />
      {on && (
        <video
          src={video}
          aria-hidden="true"
          className={`${className ?? ""} absolute inset-0 h-full w-full`}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
      )}
    </span>
  );
}

"use client";

import { useEffect, useRef } from "react";

/** Muted looping hero clip; the still is the poster. Paused for people who ask the OS for reduced motion. */
export function LoopVideo({ src, poster, alt, className }: { src: string; poster: string; alt: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (mq.matches) v.pause();
      else void v.play().catch(() => {});
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return (
    <video ref={ref} src={src} poster={poster} aria-label={alt} className={className} autoPlay muted loop playsInline preload="metadata" />
  );
}

"use client";

// Per-viewer, per-device memory for one cooking session (ticked ingredients, the cook-along step). localStorage only:
// a convenience, never data the app relies on — every read/write is wrapped, and entries expire so yesterday's ticks
// do not show up the next time the dish is cooked.

import { useCallback, useEffect, useState } from "react";

const PREFIX = "kitchen:";

export function readStored<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { at, v } = JSON.parse(raw) as { at: number; v: T };
    if (typeof at !== "number" || Date.now() - at > maxAgeMs) return null;
    return v;
  } catch {
    return null;
  }
}

export function writeStored<T>(key: string, v: T | null): void {
  try {
    if (v === null) window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), v }));
  } catch {
    /* private mode / storage blocked: just don't remember */
  }
}

/** A set of ticked ids for one recipe, shared by the recipe page and mise en place on this device (12 h). */
export function useTicks(slug: string) {
  const key = `ticks:${slug}`;
  const [ticks, setTicks] = useState<Set<string>>(new Set());
  useEffect(() => {
    // after mount (localStorage is client-only); async so render stays pure — same pattern as Timers.tsx
    void Promise.resolve().then(() => {
      const v = readStored<string[]>(key, 12 * 3600_000);
      if (v?.length) setTicks(new Set(v));
    });
  }, [key]);
  const toggle = useCallback(
    (id: string) =>
      setTicks((d) => {
        const n = new Set(d);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        writeStored(key, n.size ? [...n] : null);
        return n;
      }),
    [key],
  );
  const clear = useCallback(() => {
    writeStored(key, null);
    setTicks(new Set());
  }, [key]);
  return { ticks, toggle, clear };
}

"use client";

// Multiple concurrent, labelled timers. They live in a React context and in localStorage (a
// per-viewer convenience), so they keep running across steps, cook mode and page reloads.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Pause, Play, Plus, Timer as TimerIcon, X } from "lucide-react";
import { clock } from "@/lib/cooking";

export interface KTimer {
  id: string;
  label: string;
  total: number; // seconds
  endsAt: number | null; // ms epoch while running
  left: number; // seconds left while paused
  done: boolean;
}

interface Ctx {
  timers: KTimer[];
  start: (label: string, seconds: number) => void;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  addMinute: (id: string) => void;
  now: number;
}

const TimerCtx = createContext<Ctx | null>(null);
const KEY = "kitchen.timers.v1";

function beep() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ac.destination);
      g.gain.setValueAtTime(0.25, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.3);
      o.start(ac.currentTime + t);
      o.stop(ac.currentTime + t + 0.3);
    });
    navigator.vibrate?.([300, 150, 300]);
  } catch {
    /* audio blocked until first tap — the tray still flashes */
  }
}

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const [timers, setTimers] = useState<KTimer[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const loaded = useRef(false);

  useEffect(() => {
    // Read persisted timers after mount (localStorage is client-only); async so render stays pure.
    void Promise.resolve().then(() => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) setTimers(JSON.parse(raw) as KTimer[]);
      } catch {
        /* storage blocked */
      }
      loaded.current = true;
    });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(timers));
    } catch {
      /* storage blocked */
    }
  }, [timers]);

  // Clock tick + finish detection in one interval callback (no setState inside an effect body).
  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      setTimers((ts) => {
        if (!ts.some((x) => !x.done && x.endsAt && x.endsAt <= n)) return ts;
        beep();
        return ts.map((x) => (!x.done && x.endsAt && x.endsAt <= n ? { ...x, done: true, endsAt: null, left: 0 } : x));
      });
    }, 500);
    return () => clearInterval(t);
  }, []);

  const start = useCallback((label: string, seconds: number) => {
    setTimers((ts) => {
      // Starting the same step timer again restarts it rather than adding a duplicate.
      const fresh = { label, total: seconds, endsAt: Date.now() + seconds * 1000, left: seconds, done: false };
      return ts.some((t) => t.label === label) ? ts.map((t) => (t.label === label ? { ...t, ...fresh } : t)) : [...ts, { id: Math.random().toString(36).slice(2), ...fresh }];
    });
  }, []);
  const toggle = useCallback((id: string) => {
    setTimers((ts) =>
      ts.map((t) => {
        if (t.id !== id || t.done) return t;
        if (t.endsAt) return { ...t, left: Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)), endsAt: null };
        return { ...t, endsAt: Date.now() + t.left * 1000 };
      }),
    );
  }, []);
  const remove = useCallback((id: string) => setTimers((ts) => ts.filter((t) => t.id !== id)), []);
  const addMinute = useCallback(
    (id: string) =>
      setTimers((ts) =>
        ts.map((t) => (t.id !== id ? t : t.done ? { ...t, done: false, endsAt: Date.now() + 60_000, left: 60 } : t.endsAt ? { ...t, endsAt: t.endsAt + 60_000 } : { ...t, left: t.left + 60 })),
      ),
    [],
  );

  const value = useMemo(() => ({ timers, start, toggle, remove, addMinute, now }), [timers, start, toggle, remove, addMinute, now]);
  return <TimerCtx.Provider value={value}>{children}</TimerCtx.Provider>;
}

export function useTimers(): Ctx {
  const c = useContext(TimerCtx);
  if (!c) throw new Error("useTimers outside TimerProvider");
  return c;
}

export function secondsLeft(t: KTimer, now: number): number {
  return t.done ? 0 : t.endsAt ? Math.max(0, (t.endsAt - now) / 1000) : t.left;
}

export function StartTimerButton({ label, seconds, big = false }: { label: string; seconds: number; big?: boolean }) {
  const { start } = useTimers();
  return (
    <button
      type="button"
      onClick={() => start(label, seconds)}
      className={`inline-flex items-center gap-1.5 rounded-full border border-sea/30 bg-sea/10 text-sea-deep font-semibold hover:bg-sea/15 ${big ? "px-5 py-3 text-lg" : "px-3 py-1 text-sm"}`}
    >
      <TimerIcon size={big ? 22 : 15} /> {label}
    </button>
  );
}

/** The tray: every running timer, always visible at the bottom of the screen. */
export function TimerTray({ dark = false, alwaysShow = false }: { dark?: boolean; alwaysShow?: boolean }) {
  const { timers, toggle, remove, addMinute, now, start } = useTimers();
  const [custom, setCustom] = useState("");
  if (!alwaysShow && timers.length === 0) return null;
  return (
    <div className={`fixed bottom-0 inset-x-0 z-40 border-t ${dark ? "bg-[#0b0918] border-[#2a2440] text-white" : "bg-sand/95 backdrop-blur border-line"}`} role="region" aria-label="Timers">
      <div className="mx-auto max-w-5xl px-3 py-2 flex gap-2 overflow-x-auto items-center">
        {timers.length === 0 && <span className={`text-sm ${dark ? "text-white/60" : "text-ink-muted"}`}>No timers running</span>}
        {timers.map((t) => {
          const left = secondsLeft(t, now);
          return (
            <div key={t.id} className={`shrink-0 flex items-center gap-2 rounded-xl border px-3 py-1.5 ${t.done ? "animate-pulse bg-clay text-white border-clay" : dark ? "border-white/15 bg-white/5" : "border-line bg-paper"}`}>
              {t.done ? <BellRing size={16} /> : <TimerIcon size={16} />}
              <div className="leading-tight">
                <div className="text-[11px] opacity-80 max-w-[9rem] truncate">{t.label}</div>
                <div className="font-mono text-lg font-bold tabular-nums">{t.done ? "DONE" : clock(left)}</div>
              </div>
              {!t.done && (
                <button aria-label={t.endsAt ? "Pause" : "Resume"} onClick={() => toggle(t.id)} className="p-1">
                  {t.endsAt ? <Pause size={16} /> : <Play size={16} />}
                </button>
              )}
              <button aria-label="Add one minute" onClick={() => addMinute(t.id)} className="text-xs font-semibold px-1">+1</button>
              <button aria-label="Remove timer" onClick={() => remove(t.id)} className="p-1 opacity-70">
                <X size={15} />
              </button>
            </div>
          );
        })}
        <form
          className="shrink-0 flex items-center gap-1 ml-auto"
          onSubmit={(e) => {
            e.preventDefault();
            const m = parseFloat(custom);
            if (m > 0) start(`${m} min`, Math.round(m * 60));
            setCustom("");
          }}
        >
          <input value={custom} onChange={(e) => setCustom(e.target.value)} inputMode="decimal" placeholder="min" aria-label="Custom timer minutes" className={`w-14 rounded-lg border px-2 py-1 text-sm ${dark ? "bg-white/10 border-white/20 text-white" : "border-line bg-paper"}`} />
          <button aria-label="Start custom timer" className="p-1.5 rounded-lg border border-current/20">
            <Plus size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}

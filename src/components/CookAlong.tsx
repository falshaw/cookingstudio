"use client";

// Cook-along: one step per screen, readable from a metre away, zero clutter. Wake Lock keeps the
// screen on; Web Speech (browser-local) understands "next", "back", "repeat", "start timer".
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, ClipboardList, Lightbulb, Mic, MicOff, Soup, Sun, Users, X } from "lucide-react";
import type { RecipeVM } from "@/lib/recipe-view";
import { defaultServings, scaleLines } from "@/lib/scale";
import { cookTogether } from "@/lib/cooking";
import { nameList } from "@/lib/household";
import { fmtQty } from "@/lib/utils";
import { Pic } from "./ui";
import { StartTimerButton, TimerTray, useTimers } from "./Timers";
import { MealOrderTips } from "./MealOrderTips";
import { StepText } from "./StepText";
import { amountsForSteps } from "@/lib/inline-amounts";
import { readStored, useTicks, writeStored } from "@/lib/use-stored";

type View = "steps" | "mise" | "together";

/** Sauce drill: practise just the sauce at 1–2 portions; opens on the first sauce step. */
export interface Drill {
  start: number;
  servings: 1 | 2;
  /** today's dinner from the plan, if any — "pour it over tonight's dinner" */
  tonight: { title: string; slug: string } | null;
}

interface SpeechRec {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> & { length: number } }) => void) | null;
  onend: (() => void) | null;
}

function useWakeLock() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const get = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (!wl) return;
        lock = await wl.request("screen");
        if (!cancelled) setOn(true);
      } catch {
        setOn(false);
      }
    };
    void get();
    const vis = () => document.visibilityState === "visible" && void get();
    document.addEventListener("visibilitychange", vis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", vis);
      void lock?.release().catch(() => {});
    };
  }, []);
  return on;
}

export function CookAlong({ r, initialView, drill }: { r: RecipeVM; initialView: View; drill?: Drill }) {
  const [view, setView] = useState<View>(initialView);
  const [i, setI] = useState(drill?.start ?? 0);
  const [servings, setServings] = useState<number>(() => drill?.servings ?? defaultServings(r.servings, r.people.map((p) => ({ id: p.id, portionFactor: p.portionFactor }))));
  const [showWhy, setShowWhy] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const recRef = useRef<SpeechRec | null>(null);
  const awake = useWakeLock();
  const { start } = useTimers();
  const eaters = useMemo(() => r.people.map((p) => ({ id: p.id, portionFactor: p.portionFactor })), [r.people]);
  const lines = useMemo(() => scaleLines(r.lines, r.servings, servings, eaters), [r.lines, r.servings, servings, eaters]);
  // who is cooking today (default: the whole household); at least one cook stays selected
  const [cookIds, setCookIds] = useState<string[]>(() => r.people.map((p) => p.id));
  const toggleCook = (id: string) => setCookIds((ids) => (ids.includes(id) ? (ids.length > 1 ? ids.filter((x) => x !== id) : ids) : r.people.filter((p) => p.id === id || ids.includes(p.id)).map((p) => p.id)));
  const byId = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);
  const stepSegs = useMemo(() => amountsForSteps(r.steps, lines.map((l) => ({ id: l.id, qty: l.qty, unit: l.unit, name: l.ingredient.nameEn })), fmtQty), [r.steps, lines]);
  const step = r.steps[i];
  const total = r.steps.length;
  const isSauceStep = i === r.sauceStep;
  // the sauce step always gets a timer: its own (timerSeconds / "N minutes" in the text), else its ~minutes
  const sauceTimer = isSauceStep && step && step.timers.length === 0 && step.minutes > 0 ? { label: "Sauce timer", seconds: step.minutes * 60 } : null;

  // Resume where you were after the phone locked / you switched apps (6 h, this device). A drill has its own start.
  const stepKey = `step:${r.slug}`;
  const [resumed, setResumed] = useState(false);
  useEffect(() => {
    if (drill) return;
    void Promise.resolve().then(() => {
      const saved = readStored<number>(stepKey, 6 * 3600_000);
      if (saved && saved > 0 && saved < total) {
        setI(saved);
        setResumed(true);
      }
      restored.current = true;
    });
  }, [drill, stepKey, total]);
  const restored = useRef(false);
  useEffect(() => {
    if (drill || !restored.current) return; // don't overwrite the saved step before it was read
    writeStored(stepKey, i > 0 && i < total - 1 ? i : null);
  }, [drill, stepKey, i, total]);

  const next = useCallback(() => setI((x) => Math.min(total - 1, x + 1)), [total]);
  const back = useCallback(() => setI((x) => Math.max(0, x - 1)), []);
  const speak = useCallback((text: string) => {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = navigator.language || "en-US";
      window.speechSynthesis.speak(u);
    } catch {
      /* no TTS */
    }
  }, []);

  // keyboard + swipe
  useEffect(() => {
    if (view !== "steps") return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") next();
      if (e.key === "ArrowLeft") back();
    };
    let x0: number | null = null;
    const ts = (e: TouchEvent) => (x0 = e.touches[0].clientX);
    const te = (e: TouchEvent) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (dx < -60) next();
      if (dx > 60) back();
      x0 = null;
    };
    window.addEventListener("keydown", k);
    window.addEventListener("touchstart", ts, { passive: true });
    window.addEventListener("touchend", te);
    return () => {
      window.removeEventListener("keydown", k);
      window.removeEventListener("touchstart", ts);
      window.removeEventListener("touchend", te);
    };
  }, [view, next, back]);

  // voice commands (stateful handler via ref so the recogniser is created once)
  const handler = useRef<(t: string) => void>(() => {});
  const onVoice = (t: string) => {
    const s = t.toLowerCase();
    setHeard(s);
    if (/\b(next|weiter|forward)\b/.test(s)) next();
    else if (/\b(back|previous)\b/.test(s)) back();
    else if (/\b(repeat|again|read)\b/.test(s)) speak(step.text);
    else if (/\b(start )?timer\b/.test(s) && step.timers[0]) start(step.timers[0].label, step.timers[0].seconds);
    else if (/\bwhy\b/.test(s)) speak(step.why);
  };
  useEffect(() => {
    handler.current = onVoice;
  });
  const toggleVoice = () => {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) {
      setHeard("Voice control is not supported in this browser (try Chrome or Safari).");
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => handler.current(e.results[e.results.length - 1][0].transcript);
    rec.onend = () => {
      if (recRef.current === rec && listeningRef.current) rec.start();
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
  };
  const listeningRef = useRef(false);
  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);
  useEffect(() => () => recRef.current?.stop(), []);

  const cooks = useMemo(() => r.people.filter((p) => cookIds.includes(p.id)).map((p) => ({ id: p.id, name: p.name, skill: p.cookingSkill })), [r.people, cookIds]);
  const timeline = useMemo(() => cookTogether(r.steps.map((s) => ({ n: s.n, skill: s.skill, minutes: s.minutes, text: s.text })), cooks), [r.steps, cooks]);
  const cookOf = (n: number) => cooks.find((c) => c.id === timeline.items.find((it) => it.n === n)?.lane)?.name;
  const skilledNames = cooks.filter((c) => c.skill === "skilled").map((c) => c.name);
  const beginnerNames = cooks.filter((c) => c.skill === "beginner").map((c) => c.name);
  const nameOf = (id: string | null) => r.people.find((p) => p.id === id)?.name ?? "";
  // a drill makes only the sauce: the meat/fish it is cooked with is tonight's dinner, not on the drill list
  const sauceLines = drill ? lines.filter((l) => !l.ingredient.protein) : lines;
  const proteinNames = drill ? [...new Set(lines.filter((l) => l.ingredient.protein).map((l) => l.ingredient.nameEn))] : [];
  const base = sauceLines.filter((l) => l.forUserId == null);
  const extras = sauceLines.filter((l) => l.forUserId != null);

  return (
    <div className="min-h-[100dvh] bg-[#07060f] text-[#f4f1ff] cook-neon flex flex-col">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <Link href={`/recipes/${r.slug}`} aria-label="Close cook mode" className="p-2 rounded-lg hover:bg-white/10"><X size={22} /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display font-semibold text-base">{drill && "Sauce drill · "}{r.title}</h1>
          <p className="text-xs text-white/60">{awake ? "screen stays on" : "screen may sleep"}{heard && ` · heard: “${heard}”`}</p>
        </div>
        <nav className="flex gap-1" aria-label="Cook views">
          {([["steps", "Steps", Sun], ["mise", "Mise en place", ClipboardList], ["together", "Together", Users]] as const).map(([v, label, Icon]) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm ${view === v ? "neon-nav-active" : "hover:bg-white/10 text-white/80"}`}>
              <Icon size={16} /><span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </nav>
        {view === "steps" && (
          <button onClick={toggleVoice} aria-pressed={listening} aria-label={listening ? "Stop voice control" : "Start voice control"} className={`p-2 rounded-lg ${listening ? "neon-nav-active" : "hover:bg-white/10"}`}>
            {listening ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
        )}
      </header>
      <p className="text-center text-[11px] text-white/45 py-1">Not medical advice, check with your doctor.</p>
      {drill && (
        <p className="mx-auto mt-1 max-w-4xl rounded-xl bg-[#b6ff3d]/10 border border-[#b6ff3d]/50 px-4 py-2 text-sm" data-testid="drill-hint">
          Small batch ({servings} portion{servings === 1 ? "" : "s"}), just the sauce.
          {drill.start > 0 && " The first step(s) cook the meat — use tonight's dinner, or go Back to see them."}
          {drill.tonight ? <> Pour it over tonight&apos;s dinner: <Link href={`/recipes/${drill.tonight.slug}`} className="underline">{drill.tonight.title}</Link>.</> : " Pour it over whatever you cook tonight."}
        </p>
      )}

      {view === "steps" && step && (
        <main className="flex-1 flex flex-col lg:flex-row gap-4 p-4 pb-[calc(11rem+env(safe-area-inset-bottom))] max-w-6xl w-full mx-auto">
          <div className="lg:w-1/2">
            <Pic image={step.image} alt={`Step ${step.n}`} className="w-full aspect-[4/3]" />
            <div className="mt-3 flex gap-1" aria-hidden>
              {r.steps.map((s, k) => <span key={s.n} className={`h-1.5 flex-1 rounded-full ${k <= i ? "bg-[#ff4fd8] shadow-[0_0_10px_#ff4fd8]" : "bg-white/15"}`} />)}
            </div>
          </div>
          <div className="lg:w-1/2 flex flex-col gap-4">
            {isSauceStep && (
              <div className="flex flex-wrap items-center gap-3" data-testid="sauce-moment">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ffb03d] text-[#07060f] px-4 py-1.5 text-lg font-bold shadow-[0_0_16px_#ffb03d]"><Soup size={20} /> Now the sauce</span>
                {r.sauceLesson && r.sauceLessonTitle && (
                  <Link href={`/recipes/${r.sauceLesson}`} target="_blank" rel="noopener" className="text-sm underline text-white/80">How this sauce works: {r.sauceLessonTitle}</Link>
                )}
              </div>
            )}
            {resumed && (
              <p className="text-sm text-white/70" data-testid="resumed">
                Picked up where you left off.{" "}
                <button className="underline" onClick={() => { setI(0); setResumed(false); }}>Start from step 1</button>
              </p>
            )}
            <p className="text-sm uppercase tracking-[0.2em] text-[#3df5ff] font-semibold">
              Step {step.n} of {total} · {cooks.length > 1 ? cookOf(step.n) ?? "anyone" : step.skill === "skilled" ? "skilled cook" : step.skill === "beginner" ? "beginner-safe" : "anyone"} · ~{step.minutes} min
            </p>
            <p className="text-[1.65rem] sm:text-[2rem] leading-snug font-medium" data-testid="cook-step-text">
              <StepText segs={stepSegs[i] ?? [{ text: step.text }]} amountClass="font-bold text-[#ff4fd8] [text-shadow:0_0_12px_rgba(255,79,216,0.6)]" />
            </p>
            {step.lineIds.length > 0 && (
              <ul className="flex flex-wrap gap-2 text-lg">
                {step.lineIds.map((id) => byId.get(id)).filter(Boolean).map((l) => (
                  <li key={l!.id} className="rounded-lg bg-white/10 px-3 py-1"><strong>{fmtQty(l!.qty)} {l!.unit}</strong> {l!.ingredient.nameEn}</li>
                ))}
              </ul>
            )}
            {step.cue && <p className="text-xl rounded-xl bg-[#b6ff3d]/10 border border-[#b6ff3d]/50 px-4 py-3 shadow-[0_0_14px_rgba(182,255,61,0.18)]"><span className="font-bold text-[#b6ff3d]">Look for: </span>{step.cue}</p>}
            {step.mistake && <p className="text-lg rounded-xl bg-[#ff5a5a]/10 border border-[#ff5a5a]/50 px-4 py-3"><span className="font-bold text-[#ff8a8a]">Avoid: </span>{step.mistake}</p>}
            {step.timers.length > 0 && <div className="flex flex-wrap gap-2">{step.timers.map((t, k) => <StartTimerButton key={k} label={t.label} seconds={t.seconds} big />)}</div>}
            {sauceTimer && <div className="flex flex-wrap gap-2"><StartTimerButton label={sauceTimer.label} seconds={sauceTimer.seconds} big /></div>}
            {step.why && (
              <button onClick={() => setShowWhy((w) => !w)} className="self-start inline-flex items-center gap-1 text-[#3df5ff]">
                <Lightbulb size={18} /> {showWhy ? "Hide why" : "Why this works"}
              </button>
            )}
            {showWhy && <p className="text-lg text-white/80">{step.why}</p>}
            {step.technique && <Link href={`/techniques/${step.technique}`} className="self-start text-sm underline text-white/70">Refresher: {step.techniqueTitle ?? step.technique}</Link>}
          </div>
        </main>
      )}

      {view === "mise" && (
        <main className="flex-1 p-4 pb-[calc(11rem+env(safe-area-inset-bottom))] max-w-4xl w-full mx-auto">
          <h2 className="font-display text-2xl font-bold mb-1">Mise en place</h2>
          <p className="text-white/70 mb-4">Get everything chopped, measured and out before the hob goes on. Tick as you go.</p>
          <label className="flex items-center gap-3 mb-4 text-lg">Servings
            <input type="number" min={1} max={24} value={servings} onChange={(e) => setServings(Math.max(1, Math.min(24, +e.target.value || 1)))} className="w-20 rounded-lg bg-white/10 border border-white/20 px-2 py-1" />
          </label>
          {drill && proteinNames.length > 0 && <p className="mb-3 text-white/80">Not on this list: {proteinNames.join(", ")} — the sauce goes over tonight&apos;s dinner.</p>}
          <MiseList lines={base} title={drill ? "For the sauce" : "Base (everyone)"} slug={r.slug} nameOf={nameOf} />
          {extras.length > 0 && <MiseList lines={extras} title="Per-person extras" slug={r.slug} nameOf={nameOf} />}
          {r.equipment.length > 0 && <p className="mt-6 text-white/80"><strong>Get out:</strong> {r.equipment.map((e) => e.replace("-", " ")).join(", ")}</p>}
          <div className="mt-6"><MealOrderTips dark /></div>
          <button onClick={() => setView("steps")} className="mt-6 btn-primary px-6 py-3 text-lg">Ready — start cooking</button>
        </main>
      )}

      {view === "together" && (
        <main className="flex-1 p-4 pb-[calc(11rem+env(safe-area-inset-bottom))] max-w-5xl w-full mx-auto">
          <h2 className="font-display text-2xl font-bold mb-1">Cook together</h2>
          <p className="text-white/70 mb-3">
            Who does what, minute by minute.{" "}
            {skilledNames.length > 0 && beginnerNames.length > 0
              ? `${nameList(beginnerNames)} ${beginnerNames.length > 1 ? "get" : "gets"} the beginner-safe jobs, ${nameList(skilledNames)} the knives and hot pans.`
              : skilledNames.length === 0 && cooks.length > 0
                ? "Nobody is set as a skilled cook (Profiles), so the knife and hot-pan steps go to whoever is free."
                : ""}{" "}
            All done at minute {timeline.total}.
          </p>
          {r.people.length > 1 && (
            <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="cooks">
              <span className="text-sm text-white/60">Cooking today:</span>
              {r.people.map((p) => (
                <button key={p.id} onClick={() => toggleCook(p.id)} aria-pressed={cookIds.includes(p.id)} className={`rounded-full border px-3 py-1 text-sm ${cookIds.includes(p.id) ? "neon-nav-active border-transparent" : "border-white/20 text-white/70"}`}>
                  {p.name} <span className="text-white/50 text-xs">· {p.cookingSkill}</span>
                </button>
              ))}
            </div>
          )}
          <div className={`grid gap-4 ${cooks.length >= 3 ? "sm:grid-cols-2 lg:grid-cols-3" : cooks.length === 2 ? "sm:grid-cols-2" : ""}`}>
            {cooks.map((c) => (
              <section key={c.id} className="rounded-2xl border border-white/10 bg-white/5 p-3" data-testid="lane">
                <h3 className="font-semibold text-lg mb-2">{c.name} <span className="text-white/60 text-sm">· done at {timeline.ends[c.id] ?? 0} min</span></h3>
                <ol className="space-y-2">
                  {timeline.items.filter((it) => it.lane === c.id).map((it) => (
                    <li key={it.n} className="rounded-xl bg-black/20 p-2">
                      <span className="font-mono text-[#ff4fd8]">{it.start}–{it.end} min</span> · <button className="underline" onClick={() => { setI(it.n - 1); setView("steps"); }}>step {it.n}</button>
                      <p className="text-white/85 text-sm mt-0.5 line-clamp-2">{it.text}</p>
                    </li>
                  ))}
                  {timeline.items.every((it) => it.lane !== c.id) && <li className="text-white/60 text-sm">Nothing for this cook — set the table, wash up as you go.</li>}
                </ol>
              </section>
            ))}
          </div>
        </main>
      )}

      {view === "steps" && (
        <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] inset-x-0 flex justify-between px-4 pointer-events-none">
          <button onClick={back} disabled={i === 0} className="pointer-events-auto rounded-full bg-white/10 disabled:opacity-30 px-6 py-4 text-lg flex items-center gap-1"><ChevronLeft /> Back</button>
          {i < total - 1 ? (
            <button onClick={next} className="pointer-events-auto btn-primary bg-[#07060f]/80 backdrop-blur px-8 py-4 text-lg flex items-center gap-1">Next <ChevronRight /></button>
          ) : (
            <Link href={`/recipes/${r.slug}#cooked`} className="pointer-events-auto rounded-full border-2 border-[#b6ff3d] text-[#b6ff3d] bg-[#07060f]/80 shadow-[0_0_14px_#b6ff3d] px-8 py-4 text-lg font-semibold flex items-center gap-1"><ArrowLeft size={18} /> Done — log it</Link>
          )}
        </div>
      )}
      <TimerTray dark alwaysShow />
    </div>
  );
}

// Same ticks as the recipe page's ingredient list (useTicks, per recipe, this device, 12 h).
function MiseList({ lines, title, slug, nameOf }: { lines: RecipeVM["lines"]; title: string; slug: string; nameOf: (id: string | null) => string }) {
  const { ticks: done, toggle } = useTicks(slug);
  return (
    <section className="mb-5">
      <h3 className="text-sm uppercase tracking-[0.18em] text-[#3df5ff] font-semibold mb-2">{title}</h3>
      <ul className="grid sm:grid-cols-2 gap-2">
        {lines.map((l) => (
          <li key={l.id}>
            <label className={`flex items-center gap-3 rounded-xl border border-white/10 p-2 ${done.has(l.id) ? "opacity-50" : ""}`}>
              <input type="checkbox" className="h-6 w-6 accent-[#ff4fd8]" checked={done.has(l.id)} onChange={() => toggle(l.id)} />
              <Pic image={l.ingredient.image} alt={l.ingredient.nameEn} className="h-14 w-14 shrink-0" rounded="rounded-lg" />
              <span className="text-lg leading-tight">
                <strong>{fmtQty(l.qty)} {l.unit}</strong> {l.ingredient.nameEn}
                {l.forUserId != null && <span className="ml-1 text-xs rounded bg-white/15 px-1.5">{nameOf(l.forUserId)}</span>}
                {l.prep && <span className="block text-base text-[#ff9be9]">{l.prep}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

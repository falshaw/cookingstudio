"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Heart, Lock, LockOpen, RefreshCw, ShoppingBasket, Sparkles, Wand2, XCircle, CheckCircle2, Recycle } from "lucide-react";
import type { Issue } from "@/lib/rules";
import { cn } from "@/lib/utils";
import { JobPanel, useJob } from "./JobWatcher";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MEALS = ["breakfast", "lunch", "dinner"] as const;

interface Slot {
  id: string;
  day: number;
  meal: string;
  locked: boolean;
  source: string;
  recipe: { id: string; slug: string; title: string; kind: string; goesWith: string };
  /** the signed-in person's portion */
  mine: { netCarbs: number; protein: number; kcal: number } | null;
  issues: Issue[];
  /** meal score per user id */
  scores: Record<string, number> | null;
}

const scoreClass = (n: number) => (n >= 75 ? "text-olive font-semibold" : n >= 55 ? "text-[#7a5f0e] font-semibold" : "text-clay-deep font-semibold");

export function PlanClient({ week, planId, generatedBy, slots, batches, report, favIds, recipes, people }: {
  week: string;
  planId: string | null;
  generatedBy: string | null;
  slots: Slot[];
  batches: { id: string; title: string; slug: string; portions: number; used: number }[];
  report: { ok: boolean; week: Issue[]; omega3: Record<string, number>; redMeat?: Record<string, number> } | null;
  favIds: string[];
  recipes: { id: string; title: string; mealTypes: string[] }[];
  /** household members in household order */
  people: { id: string; slug: string; name: string }[];
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [leftFor, setLeftFor] = useState<string | null>(null);
  const job = useJob(jobId);
  const fav = new Set(favIds);
  const shift = (d: number) => {
    const x = new Date(`${week}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + d * 7);
    return x.toISOString().slice(0, 10);
  };

  async function act(body: unknown) {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setMsg(j.error ?? "Failed");
    router.refresh();
  }

  async function aiWeek() {
    const res = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "plan", weekStart: week }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg(j.error ?? "Could not start");
    setJobId(j.id);
  }

  async function shopping() {
    if (!planId) return;
    setBusy(true);
    const res = await fetch("/api/shopping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: "plan", planId }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) router.push(`/shopping?list=${j.id}`);
    else setMsg(j.error ?? "Failed");
  }

  useEffect(() => {
    if (job?.status === "done") router.refresh();
  }, [job?.status, router]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Link href={`/plan?week=${shift(-1)}`} className="btn-secondary !px-3" aria-label="Previous week"><ChevronLeft size={18} /></Link>
        <span className="font-semibold">Week of {week}</span>
        <Link href={`/plan?week=${shift(1)}`} className="btn-secondary !px-3" aria-label="Next week"><ChevronRight size={18} /></Link>
        <span className="flex-1" />
        <button disabled={busy} onClick={aiWeek} className="btn-primary inline-flex items-center gap-2"><Sparkles size={17} /> Generate week (local AI)</button>
        <button disabled={busy} onClick={() => act({ action: "solve", weekStart: week })} className="btn-secondary inline-flex items-center gap-2"><Wand2 size={17} /> Instant week (rule solver)</button>
        {planId && <button disabled={busy} onClick={shopping} className="btn-secondary inline-flex items-center gap-2"><ShoppingBasket size={17} /> Shopping list</button>}
      </div>
      {msg && <p className="mb-3 text-sm text-clay-deep">{msg}</p>}
      {jobId && <div className="mb-4"><JobPanel job={job} /></div>}

      {report && (
        <div className={cn("mb-4 rounded-xl border p-3 text-sm", report.ok ? "border-olive/30 bg-olive/10" : "border-clay/30 bg-clay/5")} data-testid="week-report">
          <p className="font-semibold inline-flex items-center gap-1">
            {report.ok ? <CheckCircle2 size={16} className="text-olive" /> : <XCircle size={16} className="text-clay-deep" />}
            {report.ok ? "This week passes every rule." : "Some meals break a rule — swap them."}
          </p>
          <span className="ml-2 text-ink-soft">Oily fish: {people.map((p) => `${p.name} ${report.omega3[p.slug] ?? 0}×`).join(" · ")} ·{report.redMeat ? ` Red meat: ${people.map((p) => `${p.name} ${report.redMeat?.[p.slug] ?? 0}×`).join(" · ")} ·` : ""} made by {generatedBy === "llm" ? "local AI + rule check" : "rule solver"}</span>
          {report.week.map((i, k) => <p key={k} className="text-clay-deep">{i.msg}</p>)}
        </div>
      )}

      {!planId ? (
        <div className="glass-card p-6 text-ink-muted">No plan for this week yet. Generate one with the local AI (takes a few minutes) or instantly with the rule solver.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] border-separate border-spacing-2" data-testid="plan-grid">
            <thead>
              <tr>
                <th className="w-20"></th>
                {DAYS.map((d) => <th key={d} className="text-left text-sm font-semibold text-ink-soft">{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {MEALS.map((meal) => (
                <tr key={meal}>
                  <th className="text-left align-top text-xs uppercase tracking-wide text-ink-muted pt-3">{meal}</th>
                  {DAYS.map((_, day) => {
                    const s = slots.find((x) => x.day === day && x.meal === meal);
                    if (!s) return <td key={day} className="glass-card p-2 text-xs text-ink-muted align-top">—</td>;
                    const fails = s.issues.filter((i) => i.level === "fail");
                    const warns = s.issues.filter((i) => i.level === "warn" && i.code !== "nutrition");
                    return (
                      <td key={day} className={cn("glass-card p-2 align-top text-sm", fails.length > 0 && "!border-clay")}>
                        <Link href={`/recipes/${s.recipe.slug}`} className="font-medium leading-tight hover:underline">{s.recipe.title}</Link>
                        <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                          {s.source === "prep" && <span className="rounded bg-sea/10 px-1 text-sea-deep">prepped</span>}
                          {s.source === "freezer" && <span className="rounded bg-sea/10 px-1 text-sea-deep">from the freezer</span>}
                          {s.source === "leftover" && <span className="rounded bg-gold/15 px-1 text-[#7a5f0e]">leftovers</span>}
                          {fav.has(s.recipe.id) && <Heart size={12} className="text-clay fill-clay" aria-label="favourite" />}
                        </div>
                        {s.source === "freezer" && <p className="text-[11px] text-ink-muted mt-1">Thaw the night before · cook fresh: your protein{s.recipe.goesWith ? ` + ${s.recipe.goesWith}` : ""}</p>}
                        {s.mine && s.source !== "freezer" && <p className="text-[11px] text-ink-muted mt-1 tabular-nums" title="Your portion">you {s.mine.netCarbs}g nc · {s.mine.protein}g P</p>}
                        {s.scores && s.source !== "freezer" && (
                          <p className="text-[11px] mt-0.5 tabular-nums" title={`Meal score 0–100 (${people.map((p) => p.name).join(" · ")})`}>
                            score{" "}
                            {people.map((p, k) => (
                              <span key={p.id}>{k > 0 && " · "}<span className={scoreClass(s.scores?.[p.id] ?? 0)}>{p.name.slice(0, 3)} {s.scores?.[p.id] ?? "–"}</span></span>
                            ))}
                          </p>
                        )}
                        {fails.map((i, k) => <p key={k} className="text-[11px] text-clay-deep flex gap-0.5"><XCircle size={11} className="mt-0.5 shrink-0" />{i.msg}</p>)}
                        {warns.map((i, k) => <p key={k} className="text-[11px] text-[#7a5f0e] flex gap-0.5"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{i.msg}</p>)}
                        <div className="mt-1.5 flex gap-1">
                          <button disabled={busy} onClick={() => act({ action: "lock", slotId: s.id, locked: !s.locked })} aria-label={s.locked ? "Unlock" : "Lock"} className="p-1 rounded hover:bg-ink/5">{s.locked ? <Lock size={14} className="text-clay-deep" /> : <LockOpen size={14} />}</button>
                          <button disabled={busy || s.locked} onClick={() => act({ action: "swap", slotId: s.id })} aria-label="Swap meal" className="p-1 rounded hover:bg-ink/5 disabled:opacity-30"><RefreshCw size={14} /></button>
                          <button disabled={busy || s.locked} onClick={() => setLeftFor(leftFor === s.id ? null : s.id)} aria-label="Use leftovers" className="p-1 rounded hover:bg-ink/5 disabled:opacity-30"><Recycle size={14} /></button>
                        </div>
                        {leftFor === s.id && (
                          <select className="input-field !py-1 !text-xs mt-1" defaultValue="" onChange={(e) => { if (e.target.value) { void act({ action: "leftover", slotId: s.id, fromSlotId: e.target.value }); setLeftFor(null); } }} aria-label="Leftovers from">
                            <option value="">leftovers from…</option>
                            {slots.filter((o) => o.day * 3 + MEALS.indexOf(o.meal as (typeof MEALS)[number]) < day * 3 + MEALS.indexOf(meal) && o.meal !== "breakfast").map((o) => <option key={o.id} value={o.id}>{DAYS[o.day]} {o.meal}: {o.recipe.title}</option>)}
                          </select>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {batches.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-semibold mb-2">Prep session (Sunday)</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {batches.map((b) => (
              <li key={b.id} className="glass-card p-3 text-sm">
                <Link href={`/recipes/${b.slug}`} className="font-semibold hover:underline">{b.title}</Link> — {b.portions} portions, {b.used} planned, <strong>{b.portions - b.used} left</strong>
              </li>
            ))}
          </ul>
          <Link href="/prep" className="mt-2 inline-block text-sm underline text-sea-deep">Open the prep-session timeline</Link>
        </section>
      )}

      {planId && (
        <details className="mt-6 text-sm">
          <summary className="cursor-pointer text-ink-soft">Set a slot by hand</summary>
          <SetSlot slots={slots} recipes={recipes} onSet={(slotId, recipeId) => act({ action: "set", slotId, recipeId })} />
        </details>
      )}
    </div>
  );
}

function SetSlot({ slots, recipes, onSet }: { slots: Slot[]; recipes: { id: string; title: string; mealTypes: string[] }[]; onSet: (slotId: string, recipeId: string) => void }) {
  const [slot, setSlot] = useState("");
  const [rec, setRec] = useState("");
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <select className="input-field !w-auto" value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="Slot">
        <option value="">slot…</option>
        {slots.map((s) => <option key={s.id} value={s.id}>{DAYS[s.day]} {s.meal}</option>)}
      </select>
      <select className="input-field !w-auto" value={rec} onChange={(e) => setRec(e.target.value)} aria-label="Recipe">
        <option value="">recipe…</option>
        {recipes.map((r) => <option key={r.id} value={r.id}>{r.title} ({r.mealTypes.join("/")})</option>)}
      </select>
      <button className="btn-secondary" disabled={!slot || !rec} onClick={() => onSet(slot, rec)}>Set</button>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Check, ChevronLeft, ChevronRight, Copy, History, Pencil, Search, Trash2, X } from "lucide-react";
import { macrosForGrams, MEALS, type RecentFood } from "@/lib/food-log";
import type { NutritionHit } from "@/lib/nutrition-search";
import type { PlanDayStatus } from "@/lib/plan-log";
import { addDays } from "@/lib/utils";

interface Entry { id: string; meal: string; label: string; portions: number; kcal: number; protein: number; netCarbs: number; fat: number }

/** Inline edit of one entry: meal, label, portions (macros scale), or move it to another day — PATCH /api/food-log. */
function EditEntry({ e, today, onDone }: { e: Entry; today: string; onDone: (changed: boolean) => void }) {
  const [meal, setMeal] = useState(e.meal);
  const [portions, setPortions] = useState(e.portions);
  const [label, setLabel] = useState(e.label.replace(/ × \d+(?:\.\d+)?$/, ""));
  const [date, setDate] = useState("");
  const [err, setErr] = useState("");
  async function save() {
    setErr("");
    const body: Record<string, unknown> = { id: e.id, meal, portions, label };
    if (date) body.date = date;
    const res = await fetch("/api/food-log", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(j.error ?? "Could not save");
    onDone(true);
  }
  return (
    <div className="flex flex-wrap items-center gap-2 w-full" data-testid="food-edit">
      <select value={meal} onChange={(x) => setMeal(x.target.value)} className="input-field !w-auto !py-1" aria-label="Meal">
        {MEALS.map((m) => <option key={m}>{m}</option>)}
      </select>
      <input value={label} onChange={(x) => setLabel(x.target.value)} className="input-field flex-1 min-w-[10rem] !py-1" aria-label="Label" maxLength={120} />
      <label className="text-xs text-ink-muted inline-flex items-center gap-1">portions
        <input type="number" step={0.25} min={0.25} max={6} value={portions} onChange={(x) => setPortions(Math.max(0.25, Math.min(6, +x.target.value || 1)))} className="input-field !w-20 !py-1" aria-label="Portions" />
      </label>
      <label className="text-xs text-ink-muted inline-flex items-center gap-1">move to
        <input type="date" value={date} max={today} onChange={(x) => setDate(x.target.value)} className="input-field !w-auto !py-1" aria-label="Move to day" />
      </label>
      <button onClick={save} className="btn-secondary !py-1 !px-2" aria-label="Save entry"><Check size={15} /></button>
      <button onClick={() => onDone(false)} className="!py-1 !px-2" aria-label="Cancel edit"><X size={15} /></button>
      {err && <p className="w-full text-xs text-clay-deep">{err}</p>}
    </div>
  );
}

function Bar({ label, v, t, unit }: { label: string; v: number; t: number | null; unit: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums">{Math.round(v)}{t ? ` / ${t}` : ""} {unit}</span></div>
      {t ? <div className="h-2 rounded-full bg-line overflow-hidden"><div className={v > t ? "h-full bg-clay" : "h-full bg-olive"} style={{ width: `${Math.min(100, (v / t) * 100)}%` }} /></div> : <p className="text-[11px] text-ink-muted">no target set</p>}
    </div>
  );
}

// stored values are unrounded — round only here
const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => Math.round(x * 10) / 10;

export function FoodLogClient({ day, today, entries, targets, recipes, ingredients, recent, planDay = null, switcher = null }: { switcher?: React.ReactNode; day: string; today: string; entries: Entry[]; targets: { kcal: number | null; protein: number | null; netCarbs: number | null }; recipes: { id: string; title: string }[]; ingredients: { id: string; nameEn: string }[]; recent: RecentFood[]; planDay?: PlanDayStatus | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [meal, setMeal] = useState("dinner");
  const [recipeId, setRecipeId] = useState("");
  const [portions, setPortions] = useState(1);
  const [ingredientId, setIngredientId] = useState("");
  const [grams, setGrams] = useState(100);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // per-meal copy: which meal from which day
  const [copyMeal, setCopyMeal] = useState("breakfast");
  const [copyFrom, setCopyFrom] = useState(addDays(day, -1));
  // USDA search by grams
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<NutritionHit[]>([]);
  const [hit, setHit] = useState<NutritionHit | null>(null);
  const [usdaGrams, setUsdaGrams] = useState(100);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null); // a slow earlier search must not overwrite the current one

  const total = entries.reduce((a, e) => ({ kcal: a.kcal + e.kcal, protein: a.protein + e.protein, netCarbs: a.netCarbs + e.netCarbs, fat: a.fat + e.fat }), { kcal: 0, protein: 0, netCarbs: 0, fat: 0 });
  const prev = addDays(day, -1);

  async function send(url: string, body: Record<string, unknown>) {
    setErr("");
    setNote("");
    setBusy(true);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(j.error ?? "Failed");
      return null;
    }
    router.refresh();
    return j as { copied?: number; skipped?: number; logged?: number; fromFreezer?: number };
  }
  const add = (body: Record<string, unknown>) => send("/api/food-log", { date: day, meal, ...body });
  async function copy(body: Record<string, unknown>) {
    const j = await send("/api/food-log/copy", { to: day, ...body });
    if (j && body.mode === "day") setNote(`Copied ${j.copied ?? 0}${j.skipped ? ` · ${j.skipped} already there` : ""}`);
  }
  async function atePlan() {
    const j = await send("/api/food-log/plan", { date: day });
    if (!j) return;
    const n = j.logged ?? 0;
    const f = j.fromFreezer ?? 0;
    setNote(n ? `Logged ${n} planned meal${n === 1 ? "" : "s"}${f ? ` · ${f} portion${f === 1 ? "" : "s"} taken off the freezer` : ""}` : "Already logged — nothing added");
  }
  async function del(id: string) {
    await fetch("/api/food-log", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    router.refresh();
  }

  function search(v: string) {
    setQ(v);
    setHit(null);
    if (timer.current) clearTimeout(timer.current);
    inflight.current?.abort();
    if (v.trim().length < 2) return setHits([]);
    timer.current = setTimeout(async () => {
      const ac = new AbortController();
      inflight.current = ac;
      try {
        const res = await fetch(`/api/nutrition/search?q=${encodeURIComponent(v)}`, { signal: ac.signal });
        const j = await res.json().catch(() => ({}));
        if (ac.signal.aborted) return;
        setHits(res.ok && Array.isArray(j.results) ? j.results : []);
      } catch {
        // aborted by a newer query (or offline) — the newer request sets the hits
      }
    }, 250);
  }
  const preview = hit ? macrosForGrams({ ...hit, satFat: null, sugar: null }, usdaGrams) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {switcher}
        <Link href={`/food-log?date=${prev}`} className="btn-secondary !px-3" aria-label="Previous day"><ChevronLeft size={18} /></Link>
        <span className="font-semibold">{day}{day === today ? " · today" : ""}</span>
        <Link href={`/food-log?date=${addDays(day, 1)}`} className="btn-secondary !px-3" aria-label="Next day"><ChevronRight size={18} /></Link>
        {day !== today && <Link href="/food-log" className="text-sm underline text-ink-muted">today</Link>}
      </div>
      <div className="glass-card p-4 grid gap-3 sm:grid-cols-3" data-testid="food-totals">
        <Bar label="kcal" v={total.kcal} t={targets.kcal} unit="" />
        <Bar label="Protein" v={total.protein} t={targets.protein} unit="g" />
        <Bar label="Net carbs" v={total.netCarbs} t={targets.netCarbs} unit="g" />
      </div>

      {planDay && (
        <div className="glass-card p-4 space-y-2" data-testid="food-plan">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || planDay.slots.every((s) => s.logged)} onClick={atePlan} className="btn-primary inline-flex items-center gap-1.5">
              <CalendarCheck size={15} /> {day === today ? "Ate today's plan" : `Ate the plan of ${day}`}
            </button>
            <span className="text-sm text-ink-muted">{planDay.slots.every((s) => s.logged) ? "every planned meal is logged" : "logs your own portion of each planned meal, once"}</span>
          </div>
          <ul className="text-sm flex flex-wrap gap-x-4 gap-y-1">
            {planDay.slots.map((s) => (
              <li key={s.meal} className={s.logged ? "text-olive" : "text-ink-soft"}>
                {s.logged ? "✓ " : ""}<span className="text-xs uppercase text-ink-muted">{s.meal}</span> {s.title}{s.source === "freezer" ? " (frozen sauce — 1 portion off the freezer)" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="glass-card p-4 space-y-3" data-testid="food-copy">
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={busy} onClick={() => copy({ mode: "day", from: prev })} className="btn-secondary inline-flex items-center gap-1.5"><Copy size={15} /> {day === today ? "Copy yesterday" : `Copy ${prev}`}</button>
          <span className="text-sm text-ink-muted">or copy</span>
          <select value={copyMeal} onChange={(e) => setCopyMeal(e.target.value)} className="input-field !w-auto !py-1" aria-label="Meal to copy">
            {MEALS.map((m) => <option key={m}>{m}</option>)}
          </select>
          <span className="text-sm text-ink-muted">from</span>
          <input type="date" value={copyFrom} max={today} onChange={(e) => setCopyFrom(e.target.value)} className="input-field !w-auto !py-1" aria-label="Copy from day" />
          <button disabled={busy || !copyFrom || copyFrom === day} onClick={() => copy({ mode: "day", from: copyFrom, meal: copyMeal })} className="btn-secondary !py-1">Copy</button>
        </div>
        <p className="text-xs text-ink-muted">Copies go onto {day === today ? "today" : day}; entries already there are not added twice.</p>
      </div>

      <div className="glass-card p-4 space-y-3">
        <select value={meal} onChange={(e) => setMeal(e.target.value)} className="input-field !w-auto" aria-label="Meal">
          {MEALS.map((m) => <option key={m}>{m}</option>)}
        </select>
        {recent.length > 0 && (
          <div data-testid="food-recent">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-clay-text mb-1 inline-flex items-center gap-1"><History size={13} /> Recent · tap to log as {meal}</h3>
            <div className="flex flex-wrap gap-1.5">
              {recent.map((f) => (
                <button key={f.entryId} disabled={busy} onClick={() => copy({ mode: "entry", entryId: f.entryId, meal })} className="rounded-full border border-line px-2.5 py-1 text-sm hover:bg-olive/10" title={`last ${f.lastDate} · ${f.uses}×`}>
                  {f.label} <span className="text-ink-muted tabular-nums">· {r0(f.kcal)} kcal</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)} className="input-field flex-1" aria-label="Recipe">
            <option value="">a recipe (my portion)…</option>
            {recipes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          <input type="number" step={0.25} min={0.25} value={portions} onChange={(e) => setPortions(+e.target.value || 1)} className="input-field !w-20" aria-label="Portions" />
          <button disabled={!recipeId || busy} onClick={() => add({ recipeId, portions })} className="btn-primary">Log</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={ingredientId} onChange={(e) => setIngredientId(e.target.value)} className="input-field flex-1" aria-label="Ingredient">
            <option value="">or a single food…</option>
            {ingredients.map((i) => <option key={i.id} value={i.id}>{i.nameEn}</option>)}
          </select>
          <input type="number" min={1} value={grams} onChange={(e) => setGrams(+e.target.value || 1)} className="input-field !w-24" aria-label="Grams" />
          <button disabled={!ingredientId || busy} onClick={() => add({ ingredientId, grams })} className="btn-secondary">Log g</button>
        </div>
        <div className="border-t border-line pt-3 space-y-2" data-testid="food-usda">
          <label className="flex items-center gap-2">
            <Search size={15} className="text-ink-muted" />
            <input value={q} onChange={(e) => search(e.target.value)} placeholder="or search the USDA table (e.g. feta, oats rolled)…" className="input-field flex-1" aria-label="Search USDA foods" />
          </label>
          {!hit && hits.length > 0 && (
            <ul className="max-h-56 overflow-y-auto divide-y divide-line rounded border border-line text-sm">
              {hits.map((h) => (
                <li key={h.fdcId}><button onClick={() => setHit(h)} className="w-full text-left px-3 py-1.5 hover:bg-olive/10">{h.name} <span className="text-ink-muted tabular-nums">· {r0(h.kcal)} kcal/100 g</span></button></li>
              ))}
            </ul>
          )}
          {hit && preview && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex-1 min-w-[12rem]">{hit.name}</span>
              <input type="number" min={1} max={3000} value={usdaGrams} onChange={(e) => setUsdaGrams(Math.max(1, Math.min(3000, +e.target.value || 1)))} className="input-field !w-24" aria-label="Grams of USDA food" />
              <span className="tabular-nums text-ink-soft">g → {r0(preview.kcal)} kcal · {r1(preview.protein)} P · {r1(preview.netCarbs)} nc · {r1(preview.fat)} F</span>
              <button disabled={busy} onClick={async () => { if (await add({ fdcId: hit.fdcId, grams: usdaGrams })) { setHit(null); setQ(""); setHits([]); } }} className="btn-secondary">Log</button>
            </div>
          )}
        </div>
        {err && <p className="text-sm text-clay-deep">{err}</p>}
        {note && <p className="text-sm text-olive">{note}</p>}
      </div>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.id} className="glass-card p-3 text-sm flex items-center gap-2">
            {editing === e.id ? (
              <EditEntry e={e} today={today} onDone={(changed) => { setEditing(null); if (changed) router.refresh(); }} />
            ) : (
              <>
                <span className="text-xs uppercase text-ink-muted w-16">{e.meal}</span>
                <span className="flex-1">{e.label}</span>
                <span className="tabular-nums text-ink-soft">{r0(e.kcal)} kcal · {r1(e.protein)} P · {r1(e.netCarbs)} nc</span>
                <button onClick={() => setEditing(e.id)} aria-label={`Edit ${e.meal}: ${e.label}`}><Pencil size={15} /></button>
                <button onClick={() => del(e.id)} aria-label={`Delete ${e.meal}: ${e.label}`}><Trash2 size={15} /></button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

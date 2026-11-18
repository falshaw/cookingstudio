"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChefHat, ClipboardList, Lightbulb, MessageCircle, Minus, Plus, Snowflake, Users, Wrench, XCircle } from "lucide-react";
import type { LineVM, RecipeVM } from "@/lib/recipe-view";
import { whatsappText, type ShareItem } from "@/lib/shopping";
import { clampServings, defaultServings, extraFactor, scaleLines } from "@/lib/scale";
import { possessive } from "@/lib/household";
import { fmtQty } from "@/lib/utils";
import { Chip, Pic } from "./ui";
import { StartTimerButton } from "./Timers";
import { CookedForm } from "./CookedForm";
import { MealOrderTips } from "./MealOrderTips";
import { MealScoreCard } from "./MealScoreCard";
import { SwapCard } from "./SwapCard";
import { SidesCard } from "./SidesCard";
import { StepText } from "./StepText";
import { amountsForSteps } from "@/lib/inline-amounts";
import { useTicks } from "@/lib/use-stored";

/** Cook-along split label per step skill. */
export const SKILL_LABEL: Record<string, string> = { skilled: "Skilled cook", beginner: "Beginner-safe", either: "Anyone" };
export const SKILL_TONE: Record<string, "clay" | "sea" | "neutral"> = { skilled: "clay", beginner: "sea", either: "neutral" };
/** Box colours for each person's extra, by household position. */
const EXTRA_TONES = [
  { box: "border-clay/25 bg-clay/5", text: "text-clay-deep" },
  { box: "border-sea/25 bg-sea/5", text: "text-sea-deep" },
  { box: "border-olive/25 bg-olive/5", text: "text-olive" },
  { box: "border-gold/30 bg-gold/10", text: "text-[#7a5f0e]" },
];

export function Qty({ l }: { l: LineVM }) {
  return (
    <span className="font-semibold tabular-nums">
      {fmtQty(l.qty)} {l.unit}
      {l.unit !== "g" && l.unit !== "ml" && l.grams > 0 && <span className="font-normal text-ink-muted"> ({fmtQty(l.grams)} g)</span>}
    </span>
  );
}

/** Ingredients with their own technique card (slug → technique slug). */
const HOW_TO: Record<string, string> = { garlic: "garlic" };
/** One-line reminder shown under that ingredient on every recipe. */
const HOW_TO_HINT: Record<string, string> = {
  garlic: "Pan: slice it thin. Whole cloves go soft only in the air fryer: 190 °C, 20 minutes, in oil.",
};

function LineRow({ l, ticked, onTick }: { l: LineVM; ticked: boolean; onTick: (id: string) => void }) {
  return (
    <li className={`flex items-start gap-3 py-2 border-b border-line last:border-0 ${ticked ? "opacity-45" : ""}`}>
      <input
        type="checkbox"
        aria-label={`Got ${l.ingredient.nameEn}`}
        checked={ticked}
        onChange={() => onTick(l.id)}
        className="mt-2.5 h-5 w-5 shrink-0 accent-[#bf5a36]"
        data-testid="ing-tick"
      />
      <Pic image={l.ingredient.image} alt={l.ingredient.nameEn} className="h-10 w-10 shrink-0" rounded="rounded-lg" />
      <div className={`min-w-0 ${ticked ? "line-through decoration-ink-muted/60" : ""}`}>
        <Qty l={l} />{" "}
        <Link href={`/ingredients/${l.ingredient.slug}`} className="text-ink underline decoration-clay/40 underline-offset-2 hover:decoration-clay">
          {l.ingredient.nameEn}
        </Link>
        {l.prep && <div className="text-sm text-ink-muted">{l.prep}</div>}
        {HOW_TO[l.ingredient.slug] && (
          <Link href={`/techniques/${HOW_TO[l.ingredient.slug]}`} className="text-xs underline text-sea-deep" data-testid="how-to-cut">
            how to cut it
          </Link>
        )}
        {HOW_TO_HINT[l.ingredient.slug] && <div className="text-xs text-ink-muted" data-testid="how-to-hint">{HOW_TO_HINT[l.ingredient.slug]}</div>}
      </div>
    </li>
  );
}

export function RecipeBody({ r, initialServings }: { r: RecipeVM; initialServings?: number }) {
  // ?servings= comes from a freezer-sauce batch on /prep (e.g. 4 dinners = 8 servings)
  const eaters = useMemo(() => r.people.map((p) => ({ id: p.id, portionFactor: p.portionFactor })), [r.people]);
  // opens at one meal for the whole household when that is more than the recipe's own servings
  const [servings, setServings] = useState(() => initialServings ?? defaultServings(r.servings, eaters));
  const lines = useMemo(() => scaleLines(r.lines, r.servings, servings, eaters), [r.lines, r.servings, servings, eaters]);
  const byId = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);
  const stepSegs = useMemo(() => amountsForSteps(r.steps, lines.map((l) => ({ id: l.id, qty: l.qty, unit: l.unit, name: l.ingredient.nameEn })), fmtQty), [r.steps, lines]);
  const base = lines.filter((l) => l.forUserId == null);
  // each person's own extra, cooked separately, in household order
  const extras = r.people.map((p, i) => ({ p, tone: EXTRA_TONES[i % EXTRA_TONES.length], lines: lines.filter((l) => l.forUserId === p.id), portions: extraFactor(servings, eaters, p.id) })).filter((x) => x.lines.length > 0);
  const hasSplit = r.lines.some((l) => l.forUserId != null);
  const plate = (id: string) => r.macros.byUser[id] ?? r.macros.generic;
  const [sending, setSending] = useState(false);
  const [shareErr, setShareErr] = useState("");
  const { ticks, toggle, clear } = useTicks(r.slug);
  const row = (l: LineVM) => <LineRow key={l.id} l={l} ticked={ticks.has(l.id)} onTick={toggle} />;

  // Builds the list server-side (aisles, avoid-list guard) and opens WhatsApp with it.
  // The tab is opened before the await so the browser does not block it as a popup.
  async function sendWhatsApp() {
    setSending(true);
    setShareErr("");
    const tab = window.open("", "_blank");
    const res = await fetch("/api/shopping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: "recipes", name: `${r.title} · ${servings} servings`, recipes: [{ recipeId: r.id, servings }] }) });
    const j = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok || !Array.isArray(j.items)) {
      tab?.close();
      return setShareErr(j.error ?? "Could not build the list");
    }
    const url = `https://wa.me/?text=${encodeURIComponent(whatsappText(j.name, j.items.map((i: ShareItem) => ({ ...i, checked: false })), { hidePantry: true, fmt: fmtQty }))}`;
    if (tab) tab.location.href = url;
    else window.location.href = url;
  }

  return (
    <div className="pb-24">
      {r.lastTweak && (
        <div className="mb-4 rounded-xl border border-gold/40 bg-gold/10 p-3 text-sm">
          <strong className="text-[#7a5f0e]">Your tweak from last time:</strong> {r.lastTweak}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-6">
        <Link href={`/cook/${r.slug}`} className="btn-primary inline-flex items-center gap-2"><ChefHat size={18} /> Cook-along mode</Link>
        <Link href={`/cook/${r.slug}?view=mise`} className="btn-secondary inline-flex items-center gap-2"><ClipboardList size={18} /> Mise en place</Link>
        <Link href={`/cook/${r.slug}?view=together`} className="btn-secondary inline-flex items-center gap-2"><Users size={18} /> Cook together</Link>
        <button disabled={sending} onClick={sendWhatsApp} className="btn-secondary inline-flex items-center gap-2"><MessageCircle size={18} /> {sending ? "Building…" : "Send via WhatsApp"}</button>
      </div>
      {shareErr && <p className="-mt-4 mb-4 text-sm text-clay-deep">{shareErr}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section className="space-y-4">
          <div className="glass-card p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h2 className="font-display text-lg font-semibold">Ingredients</h2>
              <div className="flex items-center gap-2" aria-label="Servings">
                <button aria-label="Fewer servings" onClick={() => setServings((s) => clampServings(s - 1))} className="h-9 w-9 rounded-full border border-line grid place-items-center"><Minus size={16} /></button>
                <span className="min-w-[5.5rem] text-center font-semibold tabular-nums" data-testid="servings">{servings} serving{servings === 1 ? "" : "s"}</span>
                <button aria-label="More servings" onClick={() => setServings((s) => clampServings(s + 1))} className="h-9 w-9 rounded-full border border-line grid place-items-center"><Plus size={16} /></button>
              </div>
            </div>
            {extras.length > 0 && <p className="text-xs font-semibold uppercase tracking-wide text-olive mt-3">Base — cooked once, for everyone</p>}
            <p className="text-xs text-ink-muted mt-1">
              Tick what is out on the counter{ticks.size > 0 && <> · {ticks.size} of {lines.length} ready · <button onClick={clear} className="underline">clear</button></>}
            </p>
            <ul data-testid="ingredients">{base.map(row)}</ul>
            {extras.map((x) => (
              <div key={x.p.id} className={`mt-4 rounded-xl border p-3 ${x.tone.box}`} data-testid="extra">
                <p className={`text-xs font-semibold uppercase tracking-wide ${x.tone.text}`}>{possessive(x.p.name)} extra — cooked separately ({fmtQty(x.portions)} portion{x.portions === 1 ? "" : "s"})</p>
                <ul>{x.lines.map(row)}</ul>
              </div>
            ))}
            <div className={`mt-4 rounded-xl p-3 text-sm ${r.missing.length ? "bg-clay/5 border border-clay/20" : "bg-olive/10 border border-olive/25"}`}>
              {r.missing.length ? (
                <>
                  <strong>Missing from your stock:</strong> {r.missing.join(", ")}{" "}
                  <Link href="/kitchen" className="underline text-clay-deep">update stock</Link>
                </>
              ) : (
                <span className="inline-flex items-center gap-1 text-olive"><CheckCircle2 size={16} /> You have everything in stock.</span>
              )}
            </div>
          </div>

          <div className="glass-card p-4">
            <h2 className="font-display text-lg font-semibold mb-1">Per portion (USDA data)</h2>
            <p className="text-xs text-ink-muted mb-3">Computed from USDA FoodData Central per-100 g values × the grams above.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-ink-muted">
                    <th className="py-1 pr-2 font-medium"></th>
                    <th className="py-1 px-2 font-medium">kcal</th>
                    <th className="py-1 px-2 font-medium">protein</th>
                    <th className="py-1 px-2 font-medium">net carbs</th>
                    <th className="py-1 px-2 font-medium">carbs</th>
                    <th className="py-1 px-2 font-medium">fat</th>
                    <th className="py-1 px-2 font-medium">sat</th>
                    <th className="py-1 px-2 font-medium">fibre</th>
                    <th className="py-1 px-2 font-medium">sugar</th>
                  </tr>
                </thead>
                <tbody>
                  {(hasSplit ? r.people.map((p) => ({ k: p.id, label: p.name, m: plate(p.id) })) : [{ k: "generic", label: "1 portion", m: r.macros.generic }]).map(({ k, label, m }) => {
                    return (
                      <tr key={k} className="border-t border-line">
                        <td className="py-1.5 pr-2 font-medium">{label}</td>
                        <td className="px-2">{Math.round(m.kcal)}</td>
                        <td className="px-2">{m.protein} g</td>
                        <td className="px-2 font-semibold">{m.netCarbs} g</td>
                        <td className="px-2">{m.carbs} g</td>
                        <td className="px-2">{m.fat} g</td>
                        <td className="px-2">{m.satFat} g</td>
                        <td className="px-2">{m.fibre} g</td>
                        <td className="px-2">{m.sugar} g</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 space-y-1.5" data-testid="rule-check">
              {r.people.map((p) => {
                const fails = p.issues.filter((i) => i.level === "fail");
                const warns = p.issues.filter((i) => i.level === "warn");
                if (!fails.length && !warns.length) return <p key={p.id} className="text-sm text-olive inline-flex items-center gap-1 mr-3"><CheckCircle2 size={15} /> {p.name}: fits the profile</p>;
                return (
                  <div key={p.id} className="text-sm">
                    {fails.map((i, k) => <p key={k} className="text-clay-deep flex gap-1"><XCircle size={15} className="mt-0.5 shrink-0" />{i.msg}</p>)}
                    {warns.map((i, k) => <p key={k} className="text-[#7a5f0e] flex gap-1"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{i.msg}</p>)}
                  </div>
                );
              })}
              {r.kind !== "plan" && <p className="text-xs text-ink-muted">Lesson / prep recipe: the 30-min limit does not apply; the planner only uses recipes that pass.</p>}
            </div>
          </div>

          <MealScoreCard people={hasSplit ? r.people.map((p) => ({ name: p.name, score: p.score, macros: plate(p.id) })) : [{ name: "1 portion", score: r.genericScore, macros: r.macros.generic }]} />
          <SidesCard sides={r.sides} limit={r.sidesLimit} />
          <SwapCard swaps={r.swaps} />
          {r.kind !== "lesson" && <MealOrderTips />}
          {(r.sauceFamily || r.troubleshoot.length > 0) && (
            <div className="glass-card p-4">
              <h2 className="font-display text-lg font-semibold mb-2 flex items-center gap-2"><Wrench size={18} /> Troubleshooting</h2>
              <ul className="space-y-2 text-sm">
                {r.troubleshoot.map((t, i) => (
                  <li key={i}><strong className="text-clay-deep">{t.problem}:</strong> {t.fix}</li>
                ))}
              </ul>
              {r.goesWith && <p className="mt-3 text-sm"><strong>Goes with:</strong> {r.goesWith}</p>}
            </div>
          )}

          <div className="glass-card p-4 text-sm space-y-1">
            <h2 className="font-display text-lg font-semibold mb-1 flex items-center gap-2"><Snowflake size={18} /> Leftovers & storage</h2>
            {r.fridgeDays != null && <p>Fridge: <strong>{r.fridgeDays} day{r.fridgeDays === 1 ? "" : "s"}</strong> in a closed container.</p>}
            <p>Freezer: <strong>{r.freezerDays ? `up to ${Math.round(r.freezerDays / 30) || 1} month(s)` : "does not freeze well"}</strong></p>
            {r.reheat && <p>Reheat: {r.reheat}</p>}
            {r.leftoverIdeas && <p>Turn leftovers into: {r.leftoverIdeas}</p>}
            {r.variantNote && <p className="pt-1"><Chip tone="sea">Variant</Chip> {r.variantNote}</p>}
          </div>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold mb-3">Steps</h2>
          <ol className="space-y-5" data-testid="steps">
            {r.steps.map((s, idx) => (
              <li key={s.n} className="glass-card overflow-hidden">
                <Pic image={s.image} alt={`Step ${s.n}`} className="aspect-[16/9] w-full" rounded="rounded-none" />
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-clay-deep text-white font-bold">{s.n}</span>
                    <Chip tone={SKILL_TONE[s.skill] ?? "neutral"}>{SKILL_LABEL[s.skill] ?? s.skill}</Chip>
                    <span className="text-xs text-ink-muted">~{s.minutes} min</span>
                    {s.technique && <Link href={`/techniques/${s.technique}`} className="text-xs underline text-sea-deep">technique: {s.techniqueTitle ?? s.technique}</Link>}
                  </div>
                  <p className="text-[1.05rem] leading-relaxed" data-testid="step-text">
                    <StepText segs={stepSegs[idx]} />
                  </p>
                  {s.lineIds.length > 0 && (
                    <p className="text-sm text-ink-soft">
                      <span className="text-ink-muted">Uses: </span>
                      {s.lineIds.map((id) => byId.get(id)).filter(Boolean).map((l, i) => (
                        <span key={l!.id}>{i > 0 && " · "}<Qty l={l!} /> {l!.ingredient.nameEn}</span>
                      ))}
                    </p>
                  )}
                  {s.cue && <p className="text-sm rounded-lg bg-olive/10 px-3 py-2"><strong className="text-olive">Look for:</strong> {s.cue}</p>}
                  {s.mistake && <p className="text-sm rounded-lg bg-clay/5 px-3 py-2"><strong className="text-clay-deep">Common mistake:</strong> {s.mistake}</p>}
                  {s.why && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-sea-deep inline-flex items-center gap-1"><Lightbulb size={15} /> Why this works</summary>
                      <p className="mt-1 text-ink-soft">{s.why}</p>
                    </details>
                  )}
                  {s.timers.length > 0 && <div className="flex flex-wrap gap-2">{s.timers.map((t, i) => <StartTimerButton key={i} label={t.label} seconds={t.seconds} />)}</div>}
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-6">
            <CookedForm recipeId={r.id} practice={r.practice} sauceLesson={r.sauceLesson && r.sauceLessonTitle ? { slug: r.sauceLesson, title: r.sauceLessonTitle } : null} />
          </div>
        </section>
      </div>
    </div>
  );
}

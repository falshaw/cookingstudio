"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarDays, MessageCircle, Plus, Trash2, X } from "lucide-react";
import { SECTIONS, whatsappText } from "@/lib/shopping";
import { fmtQty, cn } from "@/lib/utils";
import { possessive } from "@/lib/household";

/** forName = whose own extra it is ("" = household), forTone = their household position (chip colour). */
interface Item { id: string; name: string; qty: number; unit: string; section: string; forName: string; forTone: number; inPantry: boolean; packNote: string; avoidNote: string; checked: boolean; ingredientId: string | null; stockAdded: boolean; stockUntil: string | null }
interface List { id: string; name: string; createdAt: string; items: Item[] }
/** What a tick put into stock: the best-before day (YYYY-MM-DD) when one was set, else null. */
type Stocked = { until: string | null };

/** YYYY-MM-DD → DD.MM for the stock hint. */
const dayMonth = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
const TONES = ["bg-clay/10 text-clay-deep", "bg-sea/10 text-sea-deep", "bg-olive/10 text-olive", "bg-gold/15 text-[#7a5f0e]"];

export function ShoppingClient({ recipes, preselect, planId, lists, initialListId }: { recipes: { id: string; slug: string; title: string; servings: number }[]; preselect: { recipeId: string; servings: number } | null; planId: string | null; lists: List[]; initialListId: string | null }) {
  const router = useRouter();
  const [sel, setSel] = useState<{ recipeId: string; servings: number }[]>(preselect ? [preselect] : []);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [active, setActive] = useState(preselect ? null : initialListId);
  const [checked, setChecked] = useState<Record<string, boolean>>(() => Object.fromEntries(lists.flatMap((l) => l.items.map((i) => [i.id, i.checked]))));
  // ticked items whose ingredient the tick put into Kitchen stock (server decides; free-text items never)
  const [stocked, setStocked] = useState<Record<string, Stocked | null>>(() => Object.fromEntries(lists.flatMap((l) => l.items.map((i) => [i.id, i.stockAdded ? { until: i.stockUntil } : null]))));
  const [hidePantry, setHidePantry] = useState(true);
  // plan days for the list (0 = Mon); all ticked = the whole week
  const [planDays, setPlanDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  // own extras the avoid-list guard left out of a freshly built list (per list id)
  const [leftOut, setLeftOut] = useState<Record<string, string[]>>({});
  const list = lists.find((l) => l.id === active) ?? null;

  async function create(body: unknown) {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/shopping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(j.error ?? "Could not build the list");
    setSel([]);
    if (Array.isArray(j.leftOut) && j.leftOut.length) setLeftOut((l) => ({ ...l, [j.id]: j.leftOut }));
    router.push(`/shopping?list=${j.id}`);
    router.refresh();
    setActive(j.id);
  }

  async function tick(id: string, v: boolean) {
    setChecked((c) => ({ ...c, [id]: v }));
    const res = await fetch("/api/shopping/items", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, checked: v }) });
    if (!res.ok) return setChecked((c) => ({ ...c, [id]: !v }));
    const j = await res.json().catch(() => ({}));
    setStocked((s) => ({ ...s, [id]: v && (j.stock === "added" || (j.stock === "kept" && s[id])) ? { until: typeof j.bestBefore === "string" ? j.bestBefore : null } : null }));
  }

  async function remove(id: string) {
    await fetch("/api/shopping", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setActive(null);
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <section className="glass-card p-4 h-fit">
        <h2 className="font-display font-semibold mb-2">New list</h2>
        <div className="flex gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="input-field" aria-label="Recipe">
            <option value="">Choose a recipe…</option>
            {recipes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          <button aria-label="Add recipe" className="btn-secondary !px-3" onClick={() => { const r = recipes.find((x) => x.id === pick); if (r && !sel.some((s) => s.recipeId === r.id)) setSel([...sel, { recipeId: r.id, servings: r.servings }]); setPick(""); }}><Plus size={18} /></button>
        </div>
        <ul className="mt-3 space-y-2">
          {sel.map((s) => (
            <li key={s.recipeId} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{recipes.find((r) => r.id === s.recipeId)?.title}</span>
              <input type="number" min={1} max={24} value={s.servings} aria-label="Servings" onChange={(e) => setSel(sel.map((x) => (x.recipeId === s.recipeId ? { ...x, servings: Math.max(1, Math.min(24, +e.target.value || 1)) } : x)))} className="input-field !w-16 !py-1" />
              <button aria-label="Remove" onClick={() => setSel(sel.filter((x) => x.recipeId !== s.recipeId))}><X size={16} /></button>
            </li>
          ))}
        </ul>
        <button disabled={!sel.length || busy} onClick={() => create({ from: "recipes", recipes: sel })} className="btn-primary w-full mt-3">{busy ? "Building…" : "Build merged list"}</button>
        <div className="mt-4 border-t border-line pt-3">
          {planId ? (
            <div data-testid="plan-days">
              <p className="text-sm mb-1">From this week&apos;s plan — days:</p>
              <div className="flex flex-wrap gap-1 mb-2">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
                  <label key={d} className={cn("rounded-full border px-2.5 py-1 text-sm cursor-pointer select-none", planDays.includes(i) ? "border-olive bg-olive/10" : "border-line text-ink-muted")}>
                    <input type="checkbox" className="sr-only" checked={planDays.includes(i)} onChange={(e) => setPlanDays(e.target.checked ? [...planDays, i].sort((a, b) => a - b) : planDays.filter((x) => x !== i))} aria-label={`Plan day ${d}`} />
                    {d}
                  </label>
                ))}
              </div>
              <button disabled={busy || !planDays.length} onClick={() => create(planDays.length === 7 ? { from: "plan", planId } : { from: "plan", planId, days: planDays })} className="btn-secondary w-full inline-flex items-center justify-center gap-2"><CalendarDays size={16} /> {planDays.length === 7 ? "From this week's plan" : `From the plan: ${planDays.length} day${planDays.length === 1 ? "" : "s"}`}</button>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">No plan this week yet — <Link href="/plan" className="underline">make one</Link>.</p>
          )}
        </div>
        {err && <p className="mt-2 text-sm text-clay-deep">{err}</p>}
        {lists.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="text-sm font-semibold mb-1">Saved lists</h3>
            <ul className="space-y-1 text-sm">
              {lists.map((l) => (
                <li key={l.id} className="flex items-center gap-1">
                  <button onClick={() => setActive(l.id)} className={cn("underline-offset-2 text-left", active === l.id ? "font-semibold text-clay-deep" : "hover:underline")}>{l.name}</button>
                  <span className="text-ink-muted">· {l.items.length}</span>
                  <button onClick={() => remove(l.id)} aria-label={`Delete list ${l.name}`} className="ml-auto p-1 text-ink-muted hover:text-clay-deep"><Trash2 size={13} /></button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section>
        {list ? (
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <h2 className="font-display text-xl font-semibold flex-1">{list.name}</h2>
              <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={hidePantry} onChange={(e) => setHidePantry(e.target.checked)} /> hide what we have</label>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(whatsappText(list.name, list.items.map((i) => ({ ...i, checked: !!checked[i.id] })), { hidePantry, fmt: fmtQty }))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"
              >
                <MessageCircle size={15} /> Send via WhatsApp
              </a>
              <button onClick={() => remove(list.id)} className="text-sm text-ink-muted inline-flex items-center gap-1"><Trash2 size={15} /> delete</button>
            </div>
            {!!leftOut[list.id]?.length && <p className="text-sm text-clay-deep mb-1">Left out: {leftOut[list.id].join(", ")}</p>}
            <p className="text-sm text-ink-muted mb-3">{list.items.filter((i) => checked[i.id]).length} of {list.items.length} ticked</p>
            {SECTIONS.map((sec) => {
              const items = list.items.filter((i) => i.section === sec.key && !(hidePantry && i.inPantry));
              if (!items.length) return null;
              return (
                <div key={sec.key} className="mb-5">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-clay-text mb-1">{sec.label}</h3>
                  <ul className="glass-card divide-y divide-line">
                    {items.map((i) => (
                      <li key={i.id}>
                        <label className={cn("flex items-start gap-3 p-3 cursor-pointer", checked[i.id] && "opacity-50")}>
                          <input type="checkbox" checked={!!checked[i.id]} onChange={(e) => tick(i.id, e.target.checked)} className="mt-1 h-6 w-6 accent-[#5e6b4f]" aria-label={i.name} />
                          <span className="flex-1">
                            <span className={cn("font-medium", checked[i.id] && "line-through")}>{i.name}</span>
                            {i.forName && <span className={cn("ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold", TONES[i.forTone % TONES.length])} data-testid="extra-chip">{possessive(i.forName)} extra</span>}
                            {i.avoidNote && <span className="ml-2 rounded bg-clay/15 px-1.5 py-0.5 text-[11px] font-semibold text-clay-deep">⚠ {i.avoidNote}</span>}
                            {i.inPantry && <span className="ml-2 rounded bg-olive/10 px-1.5 py-0.5 text-[11px] text-olive">in stock</span>}
                            {checked[i.id] && stocked[i.id] && <span className="ml-2 rounded bg-olive/10 px-1.5 py-0.5 text-[11px] font-semibold text-olive" data-testid="stock-hint">{stocked[i.id]?.until ? `✓ in stock until ${dayMonth(stocked[i.id]?.until ?? "")}` : "✓ added to stock"}</span>}
                            {i.packNote && <span className="block text-xs text-ink-muted">{i.packNote}</span>}
                          </span>
                          <span className="font-semibold tabular-nums whitespace-nowrap">{fmtQty(i.qty)} {i.unit}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="glass-card p-6 text-ink-muted">Build a list on the left, or open a saved one.</div>
        )}
      </section>
    </div>
  );
}

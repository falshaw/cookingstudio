"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, Plus, Snowflake, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Equip { slug: string; name: string; category: string; why: string; priceEur: string; whereToBuy: string; have: boolean }
interface Stock { status: string; location: string; qty: string; bestBefore: string | null; frozenAt: string | null }
interface Ing { id: string; slug: string; nameEn: string; kind: string; buyTips: string; tastesLike: string; keepsDays: number | null; freezerMonths: number | null; stock: Stock | null }
interface Batch { id: string; title: string; slug: string; location: string; portionsLeft: number; cookedAt: string; keepsDays: number }

const TABS = [
  ["equipment", "Equipment"],
  ["spices", "Spices & Herbs"],
  ["pantry", "Pantry"],
  ["fridge", "Fridge / Freezer"],
] as const;

const NEXT: Record<string, string> = { in: "low", low: "out", out: "in" };
const TONE: Record<string, string> = { in: "bg-olive text-white", low: "bg-gold text-ink", out: "bg-clay-deep text-white" };

function daysBetween(a: string, b: Date) {
  return Math.floor((b.getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

export function KitchenStock({ initialTab, equipment, ingredients, batches }: { initialTab: string; equipment: Equip[]; ingredients: Ing[]; batches: Batch[] }) {
  const [tab, setTab] = useState(initialTab);
  const [eq, setEq] = useState(equipment);
  const [ings, setIngs] = useState(ingredients);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");

  async function post(url: string, body: unknown) {
    setErr("");
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) setErr((await res.json().catch(() => ({}))).error ?? "Save failed");
    return res.ok;
  }

  async function toggleEq(slug: string, have: boolean) {
    setEq((list) => list.map((e) => (e.slug === slug ? { ...e, have } : e)));
    await post("/api/equipment", { slug, have });
  }

  async function setStock(id: string, patch: Partial<Stock> & { remove?: boolean }) {
    setIngs((list) =>
      list.map((i) => {
        if (i.id !== id) return i;
        if (patch.remove) return { ...i, stock: null };
        const base: Stock = i.stock ?? { status: "in", location: i.kind === "spice" || i.kind === "herb" ? "spices" : "pantry", qty: "", bestBefore: null, frozenAt: null };
        const merged = { ...base, ...patch } as Stock;
        if (patch.location === "freezer" && !merged.frozenAt) merged.frozenAt = new Date().toISOString().slice(0, 10);
        return { ...i, stock: merged };
      }),
    );
    await post("/api/stock", { ingredientId: id, ...patch });
  }

  const lower = q.trim().toLowerCase();
  const match = (i: Ing) => !lower || i.nameEn.toLowerCase().includes(lower);
  const spices = ings.filter((i) => (i.kind === "spice" || i.kind === "herb") && match(i));
  const pantry = ings.filter((i) => i.kind === "pantry" && match(i));
  const cold = ings.filter((i) => i.stock && (i.stock.location === "fridge" || i.stock.location === "freezer"));
  const addable = useMemo(() => (lower ? ings.filter((i) => match(i) && !(i.stock && (i.stock.location === "fridge" || i.stock.location === "freezer"))).slice(0, 8) : []), [ings, lower]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = new Date();

  const StockRow = ({ i }: { i: Ing }) => {
    const st = i.stock?.status ?? "untracked";
    return (
      <li className="glass-card p-3 flex items-start gap-3" data-testid={`stock-${i.slug}`}>
        <button
          onClick={() => setStock(i.id, { status: i.stock ? NEXT[i.stock.status] : "in" })}
          className={cn("shrink-0 rounded-full px-3 py-1.5 text-xs font-bold min-w-[4.5rem]", i.stock ? TONE[i.stock.status] : "border border-line text-ink-muted")}
          aria-label={`${i.nameEn}: ${st}, tap to change`}
        >
          {i.stock ? i.stock.status.toUpperCase() : "add"}
        </button>
        <div className="min-w-0 flex-1">
          <Link href={`/ingredients/${i.slug}`} className="font-semibold hover:underline">{i.nameEn}</Link>{" "}
          {i.tastesLike && <p className="text-sm text-ink-soft">{i.tastesLike}</p>}
          {i.buyTips && <p className="text-xs text-ink-muted mt-0.5">{i.buyTips}</p>}
        </div>
        {i.stock && (
          <button onClick={() => setStock(i.id, { remove: true })} aria-label={`Stop tracking ${i.nameEn}`} title="Stop tracking" className="shrink-0 p-1 text-ink-muted hover:text-clay-deep">
            <Trash2 size={16} />
          </button>
        )}
      </li>
    );
  };

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto mb-4 border-b border-line" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("px-4 py-2 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap", tab === k ? "border-clay-deep text-clay-deep" : "border-transparent text-ink-soft")}>
            {l}
          </button>
        ))}
      </div>
      {err && <p className="mb-3 text-sm text-clay-deep">{err}</p>}

      {tab === "equipment" && (
        <div className="space-y-6">
          {["appliances", "pans", "tools"].map((cat) => (
            <section key={cat}>
              <h2 className="font-display text-lg font-semibold capitalize mb-2">{cat}</h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {eq.filter((e) => e.category === cat).map((e) => (
                  <li key={e.slug} className="glass-card p-3">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" checked={e.have} onChange={(ev) => toggleEq(e.slug, ev.target.checked)} className="mt-1 h-5 w-5 accent-[#5e6b4f]" />
                      <span>
                        <span className="font-semibold">{e.name}</span>
                        {e.why && <span className="block text-sm text-ink-soft">{e.why}</span>}
                        <span className="block text-xs text-ink-muted mt-0.5">{e.priceEur && `≈ ${e.priceEur}`}{e.whereToBuy && ` · ${e.whereToBuy}`}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {(tab === "spices" || tab === "pantry") && (
        <div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" className="input-field max-w-md mb-3" aria-label="Filter" />
          <p className="text-xs text-ink-muted mb-3">Tap the badge: IN → LOW → OUT. LOW and OUT go onto the next shopping list.</p>
          <ul className="grid gap-2 lg:grid-cols-2">{(tab === "spices" ? spices : pantry).map((i) => <StockRow key={i.id} i={i} />)}</ul>
        </div>
      )}

      {tab === "fridge" && (
        <div className="space-y-6">
          <section>
            <h2 className="font-display text-lg font-semibold mb-2">Meal-prep portions</h2>
            {batches.length === 0 ? (
              <p className="text-sm text-ink-muted">No prepped batches yet — mark a batch as cooked on <Link href="/prep" className="underline">Meal prep</Link>.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {batches.map((b) => {
                  const left = b.keepsDays - daysBetween(b.cookedAt, today);
                  return (
                    <li key={b.id} className="glass-card p-3">
                      <Link href={`/recipes/${b.slug}`} className="font-semibold hover:underline">{b.title}</Link>
                      <p className="text-sm">{b.location === "freezer" ? "Freezer" : "Fridge"} · {b.portionsLeft} portion{b.portionsLeft === 1 ? "" : "s"} left · cooked {b.cookedAt}</p>
                      <p className={cn("text-sm font-semibold", left <= 1 ? "text-clay-deep" : "text-olive")}>{left < 0 ? `past its ${b.keepsDays}-day limit — throw away` : `${left} day${left === 1 ? "" : "s"} left`}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold mb-2">Fridge & freezer items</h2>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add an item: cream, coriander…" className="input-field max-w-md mb-2" aria-label="Add item" />
            {addable.length > 0 && (
              <ul className="mb-3 flex flex-wrap gap-2">
                {addable.map((i) => (
                  <li key={i.id} className="flex gap-1">
                    <button onClick={() => setStock(i.id, { location: "fridge", status: "in" })} className="rounded-full border border-line px-3 py-1 text-sm inline-flex items-center gap-1"><Plus size={14} /> {i.nameEn} → fridge</button>
                    <button onClick={() => setStock(i.id, { location: "freezer", status: "in" })} className="rounded-full border border-line px-2 py-1 text-sm" aria-label={`${i.nameEn} to freezer`}><Snowflake size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
            <ul className="space-y-2">
              {cold.map((i) => {
                const s = i.stock!;
                const limit = s.location === "freezer" && s.frozenAt && i.freezerMonths ? new Date(new Date(`${s.frozenAt}T00:00:00Z`).getTime() + i.freezerMonths * 30 * 86_400_000).toISOString().slice(0, 10) : null;
                const daysLeft = s.bestBefore ? -daysBetween(s.bestBefore, today) : null;
                return (
                  <li key={i.id} className="glass-card p-3 flex flex-wrap items-center gap-3">
                    <button onClick={() => setStock(i.id, { status: NEXT[s.status] })} className={cn("rounded-full px-3 py-1.5 text-xs font-bold min-w-[4.5rem]", TONE[s.status])}>{s.status.toUpperCase()}</button>
                    <span className="font-semibold">{i.nameEn}</span>
                    <select value={s.location} onChange={(e) => setStock(i.id, { location: e.target.value })} className="input-field !w-auto !py-1" aria-label="Location">
                      <option value="fridge">fridge</option>
                      <option value="freezer">freezer</option>
                    </select>
                    <label className="text-sm flex items-center gap-1">best before
                      <input type="date" value={s.bestBefore ?? ""} onChange={(e) => setStock(i.id, { bestBefore: e.target.value || null })} className="input-field !w-auto !py-1" />
                    </label>
                    {daysLeft != null && <span className={cn("text-sm font-semibold", daysLeft <= 2 ? "text-clay-deep" : "text-olive")}>{daysLeft < 0 ? "expired" : `use in ${daysLeft} d`}</span>}
                    {s.location === "freezer" && <span className="text-sm text-sea-deep">frozen {s.frozenAt}{limit && ` · use by ${limit}`}</span>}
                    <button onClick={() => setStock(i.id, { remove: true })} aria-label={`Remove ${i.nameEn}`} className="ml-auto p-1 text-ink-muted"><Trash2 size={16} /></button>
                  </li>
                );
              })}
              {cold.length === 0 && <li className="text-sm text-ink-muted">Nothing tracked in the fridge or freezer yet.</li>}
            </ul>
            <p className="mt-3 text-xs text-ink-muted inline-flex items-center gap-1"><Check size={13} /> Items with a best-before in the next 2 days show on Home as “use it up”.</p>
          </section>
        </div>
      )}
    </div>
  );
}

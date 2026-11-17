"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, ShoppingCart, Snowflake } from "lucide-react";
import { BATCH_PRESET } from "@/lib/sauce-ladder";

function PrepClient({ recipes }: { recipes: { id: string; title: string; servings: number }[]; planId: string | null }) {
  const router = useRouter();
  const [rid, setRid] = useState("");
  const [portions, setPortions] = useState(6);
  const [err, setErr] = useState("");
  async function add() {
    setErr("");
    const res = await fetch("/api/prep", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", recipeId: rid, portions }) });
    if (!res.ok) return setErr((await res.json().catch(() => ({}))).error ?? "Failed");
    setRid("");
    router.refresh();
  }
  return (
    <div className="glass-card p-4 flex flex-wrap items-center gap-2">
      <span className="font-semibold">Add to the next prep session:</span>
      <select value={rid} onChange={(e) => { setRid(e.target.value); const r = recipes.find((x) => x.id === e.target.value); if (r) setPortions(r.servings); }} className="input-field !w-auto" aria-label="Prep recipe">
        <option value="">choose…</option>
        {recipes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
      </select>
      <input type="number" min={1} max={24} value={portions} onChange={(e) => setPortions(Math.max(1, Math.min(24, +e.target.value || 1)))} className="input-field !w-20" aria-label="Portions" />
      <span className="text-sm text-ink-muted">portions</span>
      <button disabled={!rid} onClick={add} className="btn-primary inline-flex items-center gap-1"><Plus size={16} /> Add</button>
      {err && <span className="text-sm text-clay-deep">{err}</span>}
    </div>
  );
}

/** Freezer batch: cook one sauce for e.g. 6, eat 2 fresh tonight, freeze 4 single portions. */
function SauceBatchClient({ sauces }: { sauces: { id: string; slug: string; title: string }[] }) {
  const router = useRouter();
  const [rid, setRid] = useState("");
  const [total, setTotal] = useState<number>(BATCH_PRESET.cook);
  const [tonight, setTonight] = useState<number>(BATCH_PRESET.tonight);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const freeze = total - tonight;
  const sauce = sauces.find((s) => s.id === rid);
  async function add(portions = total, fresh = tonight) {
    setErr("");
    setMsg("");
    const res = await fetch("/api/prep", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", recipeId: rid, portions, freshTonight: fresh }) });
    if (!res.ok) return setErr((await res.json().catch(() => ({}))).error ?? "Failed");
    setMsg(`${sauce?.title ?? "Sauce"}: cook ${portions}, eat ${fresh}, freeze ${portions - fresh} — added below.`);
    router.refresh();
  }
  /** one click: the 6 / 2 / 4 batch */
  async function preset() {
    setTotal(BATCH_PRESET.cook);
    setTonight(BATCH_PRESET.tonight);
    await add(BATCH_PRESET.cook, BATCH_PRESET.tonight);
  }
  /** the sauce's ingredients scaled to the batch → a new shopping list (same builder as the recipe page) */
  async function shop() {
    if (!sauce) return;
    setErr("");
    setMsg("");
    const res = await fetch("/api/shopping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: "recipes", name: `${sauce.title} · batch of ${total}`, recipes: [{ recipeId: sauce.id, servings: total }] }) });
    if (!res.ok) return setErr((await res.json().catch(() => ({}))).error ?? "Failed");
    const j = (await res.json().catch(() => ({}))) as { name?: string; leftOut?: string[] };
    setMsg(`Shopping list "${j.name ?? sauce.title}" saved${j.leftOut?.length ? ` · left out: ${j.leftOut.join(", ")}` : ""}.`);
  }
  return (
    <div className="glass-card p-4 flex flex-wrap items-center gap-2">
      <select value={rid} onChange={(e) => setRid(e.target.value)} className="input-field !w-auto" aria-label="Sauce">
        <option value="">choose a sauce…</option>
        {sauces.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
      </select>
      <span className="text-sm">cook</span>
      <input type="number" min={2} max={24} value={total} onChange={(e) => { const t = Math.max(2, Math.min(24, +e.target.value || 2)); setTotal(t); setTonight((n) => Math.min(n, t - 1)); }} className="input-field !w-20" aria-label="Portions to cook" />
      <span className="text-sm">· eat tonight</span>
      <input type="number" min={0} max={total - 1} value={tonight} onChange={(e) => setTonight(Math.max(0, Math.min(total - 1, +e.target.value || 0)))} className="input-field !w-20" aria-label="Portions eaten tonight" />
      <span className="text-sm">· freeze <strong>{freeze}</strong></span>
      <button disabled={!rid} onClick={() => add()} className="btn-secondary inline-flex items-center gap-1"><Plus size={16} /> Add</button>
      <button disabled={!rid} onClick={preset} className="btn-primary inline-flex items-center gap-1" data-testid="batch-preset"><Snowflake size={16} /> Cook {BATCH_PRESET.cook}, eat {BATCH_PRESET.tonight}, freeze {BATCH_PRESET.cook - BATCH_PRESET.tonight}</button>
      <button disabled={!rid} onClick={shop} className="btn-secondary inline-flex items-center gap-1" data-testid="batch-shop"><ShoppingCart size={16} /> Shopping list for {total}</button>
      {sauce && <Link href={`/recipes/${sauce.slug}?servings=${total}`} className="text-sm underline text-sea-deep">recipe scaled to {total}</Link>}
      {msg && <span className="w-full text-sm text-olive">{msg}</span>}
      {err && <span className="text-sm text-clay-deep">{err}</span>}
    </div>
  );
}

function Action({ id, action, label }: { id: string; action: "cooked" | "cooked-freezer" | "eat" | "eat-2" | "move-freezer" | "delete"; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const body =
    action === "cooked" ? { action: "cooked", id, location: "fridge" } :
    action === "cooked-freezer" ? { action: "cooked", id, location: "freezer" } :
    action === "move-freezer" ? { action: "move", id, location: "freezer" } :
    action === "eat" ? { action: "eat", id, portions: 1 } :
    action === "eat-2" ? { action: "eat", id, portions: 2 } : { action: "delete", id };
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/prep", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        setBusy(false);
        router.refresh();
      }}
      className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:border-clay"
    >
      {label}
    </button>
  );
}


export { PrepClient, SauceBatchClient, Action as PrepAction };

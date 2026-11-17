"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

interface W { id: string; date: string; kg: number; trend: number }

export function WeightChart({ rows }: { rows: W[] }) {
  if (rows.length < 2) return <p className="text-sm text-ink-muted">Add at least two weigh-ins to see the trend.</p>;
  const W0 = 520, H = 160, P = 30;
  const xs = rows.map((r) => new Date(r.date).getTime());
  const vals = rows.flatMap((r) => [r.kg, r.trend]);
  const lo = Math.min(...vals) - 0.5, hi = Math.max(...vals) + 0.5;
  const x = (t: number) => P + ((t - xs[0]) / (xs[xs.length - 1] - xs[0] || 1)) * (W0 - 2 * P);
  const y = (v: number) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const line = rows.map((r, i) => `${i ? "L" : "M"}${x(xs[i]).toFixed(1)},${y(r.trend).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W0} ${H}`} className="w-full max-w-xl" role="img" aria-label={`Weight: ${rows.map((r) => `${r.date} ${r.kg} kg (7-day trend ${r.trend})`).join(", ")}`}>
      {rows.map((r, i) => <circle key={r.id} cx={x(xs[i])} cy={y(r.kg)} r="3" fill="#ffb03d" opacity="0.7" />)}
      <path d={line} fill="none" stroke="#ff4fd8" strokeWidth="2.5" />
      <text x={P} y={12} fontSize="10" fill="#a39dbd">{hi.toFixed(1)} kg</text>
      <text x={P} y={H - 8} fontSize="10" fill="#a39dbd">{rows[0].date} → {rows[rows.length - 1].date} · dots = weigh-ins, line = 7-day average</text>
    </svg>
  );
}

export function WeightClient({ rows }: { rows: W[] }) {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [kg, setKg] = useState("");
  const [err, setErr] = useState("");
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(String(kg).replace(",", "."));
    if (!Number.isFinite(value) || value < 25 || value > 400) return setErr("Enter your weight in kg, e.g. 70.0");
    setErr("");
    const res = await fetch("/api/weight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, kg: value }) });
    if (!res.ok) return setErr("Could not save that weigh-in — check the date and weight.");
    setKg("");
    router.refresh();
  }
  async function del(id: string) {
    await fetch("/api/weight", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    router.refresh();
  }
  const last = rows[rows.length - 1];
  return (
    <section className="glass-card p-4 mb-6" data-testid="weight">
      <h2 className="font-display text-lg font-semibold mb-1">Weight trend</h2>
      {last && <p className="text-sm mb-2">Latest {last.kg} kg · 7-day average <strong>{last.trend} kg</strong>{rows.length > 1 && ` · ${(last.trend - rows[0].trend).toFixed(1)} kg since ${rows[0].date}`}</p>}
      <WeightChart rows={rows} />
      <form onSubmit={add} className="mt-3 flex flex-wrap gap-2 items-center">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-field !w-auto" aria-label="Date" />
        <input required type="number" inputMode="decimal" min={25} max={400} step={0.1} placeholder="kg" value={kg} onChange={(e) => setKg(e.target.value)} className="input-field !w-24" aria-label="Weight in kg" />
        <button className="btn-primary !py-2">Add weigh-in</button>
        {err && <span className="text-sm text-clay-deep">{err}</span>}
      </form>
      {rows.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-ink-muted">All weigh-ins</summary>
          <ul className="mt-1">{[...rows].reverse().map((r) => <li key={r.id} className="flex gap-3">{r.date} · {r.kg} kg <button onClick={() => del(r.id)} aria-label={`Delete ${r.date}`}><Trash2 size={13} /></button></li>)}</ul>
        </details>
      )}
    </section>
  );
}

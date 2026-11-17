"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Replace } from "lucide-react";
import type { RecipeVM } from "@/lib/recipe-view";

/** Swap-this-for-that where a recipe breaks a person's rule, with a one-click per-person variant. */
export function SwapCard({ swaps }: { swaps: RecipeVM["swaps"] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  if (!swaps.length) return null;
  async function apply(lineId: string, who: string) {
    setBusy(lineId + who);
    setErr("");
    const res = await fetch("/api/recipes/variant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lineId, who }) });
    setBusy(null);
    if (!res.ok) return setErr((await res.json().catch(() => ({}))).error ?? "Could not apply");
    router.refresh();
  }
  return (
    <div className="glass-card p-4" data-testid="swaps">
      <h2 className="font-display text-lg font-semibold mb-2 flex items-center gap-2"><Replace size={18} /> Swap this for that</h2>
      <ul className="space-y-2 text-sm">
        {swaps.map((s) => (
          <li key={s.lineId + s.who} className="rounded-lg border border-line p-2">
            <p><strong>{s.who === "alex" ? "Alex" : "Sam"}:</strong> {s.fromName} — {s.reason}. {s.swap.note}.</p>
            <button disabled={busy === s.lineId + s.who} onClick={() => apply(s.lineId, s.who)} className="btn-secondary !py-1 mt-1 text-xs">
              {s.toName ? `Make ${s.who === "alex" ? "Alex's" : "Sam's"} portion with ${s.toName}` : `Leave it out of ${s.who === "alex" ? "Alex's" : "Sam's"} portion`}
            </button>
          </li>
        ))}
      </ul>
      {err && <p className="mt-2 text-sm text-clay-deep">{err}</p>}
      <p className="mt-2 text-xs text-ink-muted">Changes only that person&apos;s portion; the other keeps the original.</p>
    </div>
  );
}

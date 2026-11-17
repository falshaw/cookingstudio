"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ProfileData {
  vegetarian: boolean;
  vegBreakfastAllowed: string[];
  avoidFoods: string[];
  likedFoods: string[];
  healthTargets: string;
  goals: string;
  maxCookMinutes: number | null;
  maxLunchMinutes: number | null;
  maxNetCarbsPerMeal: number | null;
  minProteinPerMeal: number | null;
  noAddedSugar: boolean;
  noRefinedStarch: boolean;
  noAlcohol: boolean;
  omega3MinPerWeek: number | null;
  omega3MaxPerWeek: number | null;
  redMeatMaxPerWeek: number | null;
  dailyKcal: number | null;
  dailyProtein: number | null;
  dailyNetCarbs: number | null;
  portionFactor: number;
  practiceGoalPerWeek: number;
  referenceGroup: string;
  weightLostKg: number | null;
  nextLabDate: string | null;
  tasteOverrides: { likes: string[]; dislikes: string[] };
}

const csv = (a: string[]) => a.join(", ");
const parseCsv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function ProfileForm({ name, initial, feedPerWeek }: { name: string; initial: ProfileData; feedPerWeek: number }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [lists, setLists] = useState({ veg: csv(initial.vegBreakfastAllowed), avoid: csv(initial.avoidFoods), liked: csv(initial.likedFoods), tl: csv(initial.tasteOverrides.likes), td: csv(initial.tasteOverrides.dislikes) });
  const [feed, setFeed] = useState(feedPerWeek);
  const [msg, setMsg] = useState("");
  const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const body = { ...p, vegBreakfastAllowed: parseCsv(lists.veg), avoidFoods: parseCsv(lists.avoid), likedFoods: parseCsv(lists.liked), tasteOverrides: { likes: parseCsv(lists.tl), dislikes: parseCsv(lists.td) } };
    const res = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const r2 = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedPerWeek: feed }) });
    if (!res.ok || !r2.ok) return setMsg((await res.json().catch(() => ({}))).error ?? "Save failed");
    setMsg("Saved.");
    router.refresh();
  }

  const N = ({ k, label, step = 1 }: { k: keyof ProfileData; label: string; step?: number }) => (
    <label className="text-sm">{label}
      <input type="number" step={step} className="input-field mt-1" value={(p[k] as number | null) ?? ""} onChange={(e) => setP({ ...p, [k]: numOrNull(e.target.value) })} />
    </label>
  );
  const B = ({ k, label }: { k: keyof ProfileData; label: string }) => (
    <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={p[k] as boolean} onChange={(e) => setP({ ...p, [k]: e.target.checked })} className="h-5 w-5 accent-[#5e6b4f]" /> {label}</label>
  );

  return (
    <form onSubmit={save} className="space-y-5" data-testid="profile-form">
      <section className="glass-card p-4 space-y-3">
        <h2 className="font-display text-lg font-semibold">{name} — food rules</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {B({ k: "vegetarian", label: "Vegetarian (no meat or fish in my portion)" })}
          <label className="text-sm">Exceptions at breakfast (comma-separated ingredient slugs, e.g. pancetta)
            <input className="input-field mt-1" value={lists.veg} onChange={(e) => setLists({ ...lists, veg: e.target.value })} />
          </label>
          <label className="text-sm sm:col-span-2">Never give me (comma-separated)
            <input className="input-field mt-1" value={lists.avoid} onChange={(e) => setLists({ ...lists, avoid: e.target.value })} placeholder="e.g. celery, okra" />
          </label>
          <label className="text-sm sm:col-span-2">I love (cuisines / dishes)
            <input className="input-field mt-1" value={lists.liked} onChange={(e) => setLists({ ...lists, liked: e.target.value })} />
          </label>
          {B({ k: "noAlcohol", label: "No alcohol (also in cooking)" })}
          {B({ k: "noAddedSugar", label: "No added sugar" })}
          {B({ k: "noRefinedStarch", label: "Flag white rice / bread / pasta" })}
          {N({ k: "maxCookMinutes", label: "Max minutes per weeknight dish" })}
          {N({ k: "maxLunchMinutes", label: "Max minutes for a fresh lunch" })}
          {N({ k: "maxNetCarbsPerMeal", label: "Max net carbs per meal (g)" })}
          {N({ k: "minProteinPerMeal", label: "Min protein per meal (g)" })}
          {N({ k: "omega3MinPerWeek", label: "Oily fish meals per week — min" })}
          {N({ k: "omega3MaxPerWeek", label: "Oily fish meals per week — max" })}
          {N({ k: "redMeatMaxPerWeek", label: "Red-meat meals per week — max (beef, pork, lamb, bacon/ham; empty = no limit)" })}
          {N({ k: "portionFactor", label: "Portion size (1 = standard)", step: 0.05 })}
        </div>
      </section>
      <section className="glass-card p-4 space-y-3">
        <h2 className="font-display text-lg font-semibold">Targets & goals (private)</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {N({ k: "dailyKcal", label: "Daily kcal" })}
          {N({ k: "dailyProtein", label: "Daily protein (g)" })}
          {N({ k: "dailyNetCarbs", label: "Daily net carbs (g)" })}
          {N({ k: "weightLostKg", label: "Weight lost so far (kg)", step: 0.1 })}
          <label className="text-sm">Next blood test
            <input type="date" className="input-field mt-1" value={p.nextLabDate ?? ""} onChange={(e) => setP({ ...p, nextLabDate: e.target.value || null })} />
          </label>
          {N({ k: "practiceGoalPerWeek", label: "Cooks per week (practice goal)" })}
          <label className="text-sm">Nutrient reference values
            <select className="input-field mt-1" value={p.referenceGroup} onChange={(e) => setP({ ...p, referenceGroup: e.target.value })}>
              <option value="general">General adult (higher of the two values)</option>
              <option value="male">Adult male reference values</option>
              <option value="female">Adult female reference values</option>
            </select>
          </label>
        </div>
        <label className="text-sm block">Goals
          <textarea rows={3} className="input-field mt-1" value={p.goals} onChange={(e) => setP({ ...p, goals: e.target.value })} />
        </label>
        <label className="text-sm block">Health targets (notes)
          <textarea rows={2} className="input-field mt-1" value={p.healthTargets} onChange={(e) => setP({ ...p, healthTargets: e.target.value })} />
        </label>
      </section>
      <section className="glass-card p-4 space-y-3">
        <h2 className="font-display text-lg font-semibold">Taste overrides & new-recipes feed</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Always count as liked
            <input className="input-field mt-1" value={lists.tl} onChange={(e) => setLists({ ...lists, tl: e.target.value })} />
          </label>
          <label className="text-sm">Always count as disliked
            <input className="input-field mt-1" value={lists.td} onChange={(e) => setLists({ ...lists, td: e.target.value })} />
          </label>
          <label className="text-sm">New recipes per week (household, 0 = off)
            <input type="number" min={0} max={14} className="input-field mt-1" value={feed} onChange={(e) => setFeed(Math.max(0, Math.min(14, +e.target.value || 0)))} />
          </label>
        </div>
      </section>
      <div className="flex items-center gap-3">
        <button className="btn-primary">Save profile</button>
        {msg && <span className="text-sm text-olive">{msg}</span>}
      </div>
    </form>
  );
}

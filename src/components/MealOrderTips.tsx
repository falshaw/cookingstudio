import { Footprints } from "lucide-react";

/** General eating-order tips (no medical claims). Shown on recipe pages and in cook-along. */
export function MealOrderTips({ dark = false }: { dark?: boolean }) {
  return (
    <aside className={`rounded-xl border p-3 text-sm ${dark ? "border-white/15 bg-white/5 text-white/85" : "border-line bg-sand"}`} data-testid="meal-order-tips">
      <p className="font-semibold mb-1 inline-flex items-center gap-1"><Footprints size={15} /> Eating order — general tips</p>
      <ol className="list-decimal pl-5 space-y-0.5">
        <li>Vegetables or salad first.</li>
        <li>Then the protein (meat, fish, eggs, cheese, beans).</li>
        <li>Rice, bread, pasta or potatoes last.</li>
        <li>A 10–15 minute walk after the meal.</li>
      </ol>
      <p className={`mt-1 text-xs ${dark ? "text-white/50" : "text-ink-muted"}`}>General habits, not medical advice — check with your doctor.</p>
    </aside>
  );
}

import { Clock, Salad } from "lucide-react";
import type { SidePick } from "@/lib/sides";

const TYPE_LABEL: Record<SidePick["type"], string> = { green: "Green veg", salad: "Salad", roast: "Roasted veg", starch: "Small starch, eat it last" };

export function SidesCard({ sides, limit }: { sides: SidePick[]; limit?: number | null }) {
  if (!sides.length) return null;
  const used = sides[0].plate.netCarbs - sides[0].macros.netCarbs;
  return (
    <div className="glass-card p-4" data-testid="sides-card">
      <h2 className="font-display text-lg font-semibold mb-1 flex items-center gap-2">
        <Salad size={18} /> Healthy sides
      </h2>
      <p className="text-xs text-ink-muted mb-3">Picked for your rules: they fit your carb limit and avoid list, and none repeats a vegetable already in the dish. One portion each.</p>
      {sides.length === 1 && limit != null && (
        <p className="text-sm text-ink-soft mb-3" data-testid="sides-tight">
          Only one side fits: this dish already has {Math.round(used)} g of your {limit} g net carbs, so a cooked vegetable would take you over.
        </p>
      )}
      <ul className="space-y-4">
        {sides.map((s) => (
          <li key={s.key} className="border-t border-line pt-3 first:border-0 first:pt-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-clay-text">{TYPE_LABEL[s.type]}</p>
            <p className="font-semibold">{s.name}</p>
            <p className="text-sm text-ink-soft">{s.lines.map((l) => `${l.measure} ${l.name.toLowerCase()}`).join(" · ")}</p>
            <p className="mt-1 text-sm">{s.how}</p>
            <p className="mt-1 text-xs text-ink-muted flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1"><Clock size={12} /> {s.minutes} min</span>
              <span>+{Math.round(s.macros.kcal)} kcal · +{s.macros.protein} g protein · +{s.macros.netCarbs} g net carbs</span>
              <span className="font-medium text-ink-soft">Plate: {Math.round(s.plate.kcal)} kcal · {s.plate.netCarbs} g net carbs</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

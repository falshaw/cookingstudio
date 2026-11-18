"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { nameList } from "@/lib/household";

/** `others` = how many other household members there are, `lovedBy` = the names of those who hearted it. */
export function FavButton({ recipeId, initial, others = 0, lovedBy = [] }: { recipeId: string; initial: boolean; others?: number; lovedBy?: string[] }) {
  const all = others > 0 && lovedBy.length === others;
  const [on, setOn] = useState(initial);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={async () => {
          setOn(!on);
          const res = await fetch("/api/favourite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipeId, on: !on }) });
          if (!res.ok) setOn(on);
        }}
        aria-pressed={on}
        aria-label={on ? "Remove from favourites" : "Add to favourites"}
        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm ${on ? "border-clay/40 bg-clay/10 text-clay-deep" : "border-line"}`}
      >
        <Heart size={16} className={on ? "fill-clay text-clay" : ""} /> {on ? "Favourite" : "Favourite?"}
      </button>
      {on && all && <span className="rounded-full bg-gold/15 border border-gold/30 px-2 py-0.5 text-xs text-[#7a5f0e]">♥ {others === 1 ? "both love it" : "everyone loves it"}</span>}
      {!(on && all) && lovedBy.length > 0 && <span className="text-xs text-ink-muted">{nameList(lovedBy)} {lovedBy.length === 1 ? "loves" : "love"} it</span>}
    </span>
  );
}

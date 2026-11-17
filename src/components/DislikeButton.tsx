"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ThumbsDown } from "lucide-react";

const REASONS = [
  ["taste", "taste"],
  ["too long", "too long"],
  ["too hard", "too hard"],
  ["ingredient", "an ingredient"],
] as const;

/** Per-user 👎 with an optional reason; tap "undo" to take it back. */
export function DislikeButton({ recipeId, ingredientId, initial, compact = false }: { recipeId?: string; ingredientId?: string; initial: { on: boolean; reason: string }; compact?: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial.on);
  const [reason, setReason] = useState(initial.reason);
  const [asking, setAsking] = useState(false);
  async function send(next: boolean, why = "") {
    const res = await fetch("/api/dislike", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipeId, ingredientId, on: next, reason: why }) });
    if (res.ok) {
      setOn(next);
      setReason(why);
      setAsking(false);
      router.refresh();
    }
  }
  if (on) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm" data-testid="disliked">
        <span className="inline-flex items-center gap-1 rounded-full border border-clay-deep/30 bg-clay-deep/10 px-3 py-1 text-clay-deep">
          <ThumbsDown size={15} className="fill-current" /> you disliked{reason ? ` (${reason})` : ""}
        </span>
        <button onClick={() => send(false)} className="text-xs underline text-ink-muted" aria-label="Undo dislike">undo</button>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button onClick={() => setAsking((a) => !a)} aria-expanded={asking} aria-label="Don't like" className={`inline-flex items-center gap-1 rounded-full border border-line ${compact ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"}`}>
        <ThumbsDown size={compact ? 13 : 16} /> {compact ? "" : "Don't like"}
      </button>
      {asking && (
        <span className="inline-flex flex-wrap items-center gap-1 text-xs" role="group" aria-label="Why?">
          <span className="text-ink-muted">why?</span>
          {REASONS.map(([v, l]) => (
            <button key={v} onClick={() => send(true, v)} className="rounded-full border border-line px-2 py-0.5 hover:border-clay">{l}</button>
          ))}
          <button onClick={() => send(true, "")} className="rounded-full border border-line px-2 py-0.5 hover:border-clay">just no</button>
        </span>
      )}
    </span>
  );
}

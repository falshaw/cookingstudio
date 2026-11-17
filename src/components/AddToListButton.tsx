"use client";

import { useState } from "react";
import { Check, Plus } from "lucide-react";

export function AddToListButton({ ingredientId, name }: { ingredientId: string; name: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "err">("idle");
  return (
    <button
      disabled={state === "busy" || state === "done"}
      aria-label={`Add ${name} to the shopping list`}
      onClick={async () => {
        setState("busy");
        const res = await fetch("/api/shopping/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ingredientId }) });
        setState(res.ok ? "done" : "err");
      }}
      className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs hover:border-clay disabled:opacity-60"
    >
      {state === "done" ? <Check size={12} /> : <Plus size={12} />} {state === "done" ? "on the list" : state === "err" ? "failed — retry" : "shopping list"}
    </button>
  );
}

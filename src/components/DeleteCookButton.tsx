"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

export function DeleteCookButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  return (
    <button
      aria-label={`Delete cook: ${label}`}
      className="p-1 text-ink-muted hover:text-clay-deep"
      onClick={async () => {
        if (!confirm(`Delete this cook of ${label}?`)) return;
        const res = await fetch("/api/cook", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
        if (res.ok) router.refresh();
      }}
    >
      <Trash2 size={15} />
    </button>
  );
}

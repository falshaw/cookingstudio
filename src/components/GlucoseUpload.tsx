"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Trash2 } from "lucide-react";

export function GlucoseUpload({ count }: { count: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  async function upload(f: File) {
    setMsg("Importing…");
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch("/api/glucose", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg(j.error ?? "Import failed");
    setMsg(`${j.source === "libre" ? "FreeStyle Libre" : "Dexcom"}: ${j.read} readings read, ${j.added} new${j.skipped ? `, ${j.skipped} skipped` : ""}.`);
    router.refresh();
  }
  async function clear() {
    if (!confirm("Delete all your imported glucose readings?")) return;
    await fetch("/api/glucose", { method: "DELETE" });
    router.refresh();
  }
  return (
    <div className="glass-card p-4 flex flex-wrap items-center gap-3">
      <label className="btn-secondary inline-flex items-center gap-2 cursor-pointer">
        <FileUp size={16} /> Import CSV
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </label>
      <span className="text-sm text-ink-muted">{count} readings stored</span>
      {count > 0 && <button onClick={clear} className="text-sm text-ink-muted inline-flex items-center gap-1"><Trash2 size={14} /> delete all</button>}
      {msg && <span className="text-sm w-full">{msg}</span>}
    </div>
  );
}

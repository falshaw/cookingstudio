"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { JobPanel, useJob } from "./JobWatcher";

interface Item { name: string; grams: number; ingredientId: string | null; nameEn: string | null }

/** Resize to ≤1024 px JPEG and return base64 (no data: prefix) — keeps the upload small. */
async function toJpegB64(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82).split(",")[1];
}

export function PhotoLog({ enabled, day, meal, ingredients }: { enabled: boolean; day: string; meal: string; ingredients: { id: string; nameEn: string }[] }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);
  const [rows, setRows] = useState<(Item & { keep: boolean })[] | null>(null);
  const [err, setErr] = useState("");
  const job = useJob(jobId);

  useEffect(() => {
    if (job?.status !== "done" || rows) return;
    const items = ((job.result as { items?: Item[] } | null)?.items ?? []).map((i) => ({ ...i, keep: !!i.ingredientId }));
    void Promise.resolve().then(() => setRows(items));
  }, [job, rows]);

  if (!enabled) {
    return <p className="glass-card p-3 text-sm text-ink-muted inline-flex items-center gap-2"><Camera size={16} /> Photo logging needs the local AI (Ollama with qwen2.5vl). It is not running right now — log by hand below.</p>;
  }

  async function pick(f: File) {
    setErr("");
    setRows(null);
    try {
      const image = await toJpegB64(f);
      const res = await fetch("/api/food-log/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(j.error ?? "Upload failed");
      setJobId(j.id);
    } catch {
      setErr("Could not read that image.");
    }
  }

  async function save() {
    if (!rows) return;
    for (const r of rows.filter((x) => x.keep && x.ingredientId)) {
      const res = await fetch("/api/food-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: day, meal, ingredientId: r.ingredientId, grams: r.grams }) });
      if (!res.ok) return setErr((await res.json().catch(() => ({}))).error ?? "Save failed");
    }
    setRows(null);
    setJobId(null);
    router.refresh();
  }

  return (
    <div className="glass-card p-4 space-y-3" data-testid="photo-log">
      <label className="btn-secondary inline-flex items-center gap-2 cursor-pointer">
        <Camera size={16} /> Log from a photo
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      </label>
      <p className="text-xs text-ink-muted">The photo is read by the local vision model on this PC and deleted right after. Portions are rough estimates — check every line.</p>
      {err && <p className="text-sm text-clay-deep">{err}</p>}
      {jobId && !rows && <JobPanel job={job} />}
      {rows && (
        <div>
          <p className="text-sm font-semibold mb-1">Confirm what to log ({meal}):</p>
          <ul className="space-y-2">
            {rows.map((r, k) => (
              <li key={k} className="flex flex-wrap items-center gap-2 text-sm">
                <input type="checkbox" checked={r.keep} onChange={(e) => setRows(rows.map((x, j) => (j === k ? { ...x, keep: e.target.checked } : x)))} aria-label={`log ${r.name}`} />
                <span className="w-28 truncate text-ink-muted" title={r.name}>{r.name}</span>
                <select value={r.ingredientId ?? ""} onChange={(e) => setRows(rows.map((x, j) => (j === k ? { ...x, ingredientId: e.target.value || null, keep: !!e.target.value } : x)))} className="input-field !w-auto !py-1" aria-label="Ingredient">
                  <option value="">— pick a food —</option>
                  {ingredients.map((i) => <option key={i.id} value={i.id}>{i.nameEn}</option>)}
                </select>
                <input type="number" min={1} value={r.grams} onChange={(e) => setRows(rows.map((x, j) => (j === k ? { ...x, grams: Math.max(1, +e.target.value || 1) } : x)))} className="input-field !w-20 !py-1" aria-label="Grams" /> g
              </li>
            ))}
          </ul>
          <button onClick={save} className="btn-primary mt-3">Log {rows.filter((r) => r.keep && r.ingredientId).length} item(s)</button>
        </div>
      )}
    </div>
  );
}

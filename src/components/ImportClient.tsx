"use client";

import Link from "next/link";
import { useState } from "react";
import { Link2, Plus, Trash2, Upload } from "lucide-react";
import type { RecipeDraft } from "@/lib/llm-schema";
import { JobPanel, useJob } from "./JobWatcher";

export function ImportClient() {
  const [url, setUrl] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [edited, setEdited] = useState<RecipeDraft | null>(null);
  const [level, setLevel] = useState(5);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const job = useJob(jobId);

  // The model's draft comes from the finished job; the user's edits (if any) take over from there.
  const result = job?.status === "done" ? (job.result as { draft: RecipeDraft; ruleIssues: string | null; url: string } | null) : null;
  const draft = edited ?? result?.draft ?? null;
  const ruleIssues = result?.ruleIssues ?? null;
  const sourceUrl = result?.url;
  const setDraft = setEdited;

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setDraft(null);
    setSaved(null);
    const res = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "import-url", url }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(j.error ?? "Could not start");
    setJobId(j.id);
  }

  async function save() {
    if (!draft) return;
    setErr("");
    const res = await fetch("/api/import/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft, level, sourceUrl }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(j.error ?? "Save failed");
    setSaved(j.slug);
  }

  async function importFile(f: File) {
    setErr("");
    try {
      const data = JSON.parse(await f.text());
      const recipes = (Array.isArray(data?.recipes) ? data.recipes : [data]) as { draft?: RecipeDraft; level?: number; kind?: string }[];
      let n = 0;
      for (const r of recipes) {
        const res = await fetch("/api/import/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: r.draft ?? r, level: r.level ?? 5, kind: r.kind ?? "lesson" }) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "save failed");
        n++;
      }
      setErr(`Imported ${n} recipe${n === 1 ? "" : "s"}.`);
    } catch (e) {
      setErr(`Import failed: ${(e as Error).message}`);
    }
  }

  const upd = (patch: Partial<RecipeDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <div className="space-y-5">
      <form onSubmit={start} className="glass-card p-4 flex flex-col sm:flex-row gap-3">
        <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="input-field flex-1" aria-label="Recipe URL" />
        <button className="btn-primary inline-flex items-center justify-center gap-2"><Link2 size={18} /> Fetch & parse</button>
      </form>
      <label className="glass-card p-4 flex items-center gap-3 cursor-pointer text-sm">
        <Upload size={18} /> Import JSON (exported from CookingStudio)
        <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
      </label>
      {err && <p className="text-sm text-clay-deep">{err}</p>}
      {jobId && !draft && <JobPanel job={job} />}
      {saved && <Link href={`/recipes/${saved}`} className="btn-primary inline-block">Saved — open it</Link>}

      {draft && !saved && (
        <div className="glass-card p-4 space-y-4" data-testid="import-preview">
          <h2 className="font-display text-xl font-semibold">Edit before saving</h2>
          {ruleIssues && <p className="rounded-lg bg-clay/10 p-3 text-sm text-clay-deep"><strong>Rule check:</strong> {ruleIssues} — fix the ingredients below or saving will be refused.</p>}
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm">Title<input className="input-field mt-1" value={draft.title} onChange={(e) => upd({ title: e.target.value })} /></label>
            <label className="text-sm">Servings<input type="number" className="input-field mt-1" value={draft.servings} onChange={(e) => upd({ servings: Math.max(1, +e.target.value || 1) })} /></label>
            <label className="text-sm">Level<input type="number" min={1} max={8} className="input-field mt-1" value={level} onChange={(e) => setLevel(Math.max(1, Math.min(8, +e.target.value || 5)))} /></label>
          </div>
          <div>
            <h3 className="font-semibold mb-1">Ingredients</h3>
            <ul className="space-y-2">
              {draft.ingredients.map((ing, k) => (
                <li key={k} className="grid grid-cols-[1fr_4.5rem_4rem_4.5rem_auto] gap-2 items-center">
                  <input aria-label="Name" className="input-field" value={ing.name} onChange={(e) => upd({ ingredients: draft.ingredients.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} />
                  <input aria-label="Qty" type="number" className="input-field" value={ing.qty} onChange={(e) => upd({ ingredients: draft.ingredients.map((x, j) => (j === k ? { ...x, qty: +e.target.value } : x)) })} />
                  <input aria-label="Unit" className="input-field" value={ing.unit} onChange={(e) => upd({ ingredients: draft.ingredients.map((x, j) => (j === k ? { ...x, unit: e.target.value } : x)) })} />
                  <input aria-label="Grams" type="number" className="input-field" value={ing.grams} onChange={(e) => upd({ ingredients: draft.ingredients.map((x, j) => (j === k ? { ...x, grams: +e.target.value } : x)) })} />
                  <button aria-label="Remove ingredient" onClick={() => upd({ ingredients: draft.ingredients.filter((_, j) => j !== k) })}><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
            <button className="mt-2 text-sm inline-flex items-center gap-1 text-sea-deep" onClick={() => upd({ ingredients: [...draft.ingredients, { name: "", grams: 0, qty: 0, unit: "g", prep: "", component: "both" }] })}><Plus size={14} /> add ingredient</button>
          </div>
          <div>
            <h3 className="font-semibold mb-1">Steps</h3>
            <ol className="space-y-2">
              {draft.steps.map((s, k) => (
                <li key={k}><textarea aria-label={`Step ${k + 1}`} rows={2} className="input-field" value={s.text} onChange={(e) => upd({ steps: draft.steps.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })} /></li>
              ))}
            </ol>
          </div>
          <button onClick={save} className="btn-primary">Save to the library</button>
        </div>
      )}
    </div>
  );
}

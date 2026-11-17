"use client";

import Link from "next/link";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { JobPanel, useJob } from "./JobWatcher";

export function TeachForm({ initialDish = "" }: { initialDish?: string }) {
  const [dish, setDish] = useState(initialDish);
  const [level, setLevel] = useState(4);
  const [jobId, setJobId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const job = useJob(jobId);
  const slug = (job?.result as { slug?: string } | null)?.slug;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const res = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "teach", dish, level }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(j.error ?? "Could not start");
    setJobId(j.id);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="glass-card p-4 flex flex-col sm:flex-row gap-3">
        <input value={dish} onChange={(e) => setDish(e.target.value)} required minLength={2} maxLength={200} placeholder="e.g. chicken curry, beef stew, shakshuka" className="input-field flex-1" aria-label="Dish" />
        <select value={level} onChange={(e) => setLevel(+e.target.value)} className="input-field sm:!w-32" aria-label="Level">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((l) => <option key={l} value={l}>Level {l}</option>)}
        </select>
        <button className="btn-primary inline-flex items-center justify-center gap-2" disabled={!!jobId && job?.status !== "done" && job?.status !== "failed"}><Sparkles size={18} /> Teach me</button>
      </form>
      {err && <p className="text-sm text-clay-deep">{err}</p>}
      {jobId && <JobPanel job={job} />}
      {slug && <Link href={`/recipes/${slug}`} className="btn-primary inline-block">Open the new recipe</Link>}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export interface JobState {
  id: string;
  type: string;
  status: string;
  log: string;
  result: Record<string, unknown> | null;
  error: string | null;
  ahead: number;
}

/** Polls /api/jobs/[id] every 3 s until done/failed. A local model can take 1–3+ min per job. */
export function useJob(id: string | null) {
  const [job, setJob] = useState<JobState | null>(null);
  useEffect(() => {
    if (!id) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
        if (res.ok) {
          const j = (await res.json()) as JobState;
          if (!stop) setJob(j);
          if (j.status === "done" || j.status === "failed") return;
        }
      } catch {
        /* retry */
      }
      if (!stop) setTimeout(tick, 3000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [id]);
  return job;
}

export function JobPanel({ job }: { job: JobState | null }) {
  if (!job) return <p className="text-sm text-ink-muted inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> queued…</p>;
  return (
    <div className="glass-card p-4" data-testid="job-panel">
      <p className="font-semibold inline-flex items-center gap-2">
        {job.status === "done" ? <CheckCircle2 className="text-olive" size={18} /> : job.status === "failed" ? <XCircle className="text-clay-deep" size={18} /> : <Loader2 className="animate-spin" size={18} />}
        {job.status === "queued" ? `Queued${job.ahead ? ` (${job.ahead} ahead)` : ""}` : job.status === "running" ? "Working — the local model takes a few minutes" : job.status === "done" ? "Done" : "Failed"}
      </p>
      {job.error && <p className="mt-1 text-sm text-clay-deep">{job.error}</p>}
      {job.log && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-sand p-2 text-xs text-ink-soft">{job.log}</pre>}
    </div>
  );
}

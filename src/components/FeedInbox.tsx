"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles, X } from "lucide-react";
import { Pic } from "./ui";
import { JobPanel, useJob } from "./JobWatcher";

export function FeedInbox({ drafts }: { drafts: { id: string; slug: string; title: string; kind: string; hero: { id: string; status: string; video?: string | null } | null }[] }) {
  const router = useRouter();
  const [reason, setReason] = useState<Record<string, string>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);

  async function decide(id: string, decision: "approve" | "reject") {
    await fetch("/api/feed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipeId: id, decision, reason: reason[id] }) });
    router.refresh();
  }
  async function generate() {
    const res = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "feed" }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok) setJobId(j.id);
  }

  return (
    <section className="glass-card p-4" data-testid="feed-inbox">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-display text-lg font-semibold flex-1">New this week</h2>
        <button onClick={generate} disabled={!!jobId && job?.status !== "done" && job?.status !== "failed"} className="btn-secondary !py-1.5 inline-flex items-center gap-1 text-sm"><Sparkles size={15} /> Generate now</button>
      </div>
      {jobId && <div className="mb-3"><JobPanel job={job} /></div>}
      {drafts.length === 0 ? (
        <p className="text-sm text-ink-muted">No drafts waiting. The local AI adds new recipes through the week (always at least one meal-prep batch); approve the ones you want in the library.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {drafts.map((d) => (
            <li key={d.id} className="rounded-xl border border-line overflow-hidden">
              <Pic image={d.hero} alt={d.title} className="aspect-[16/9] w-full" rounded="rounded-none" />
              <div className="p-3 space-y-2">
                <Link href={`/recipes/${d.slug}`} className="font-semibold hover:underline">{d.title}</Link>
                <span className="ml-2 text-xs text-ink-muted">{d.kind === "prep" ? "meal prep" : d.kind === "plan" ? "weeknight" : "lesson"}</span>
                <input placeholder="Reason if rejecting (helps next time)" value={reason[d.id] ?? ""} onChange={(e) => setReason({ ...reason, [d.id]: e.target.value })} className="input-field !py-1 text-sm" />
                <div className="flex gap-2">
                  <button onClick={() => decide(d.id, "approve")} className="btn-primary !py-1.5 inline-flex items-center gap-1 text-sm"><Check size={15} /> Add to library</button>
                  <button onClick={() => decide(d.id, "reject")} className="btn-secondary !py-1.5 inline-flex items-center gap-1 text-sm"><X size={15} /> Reject</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { JobPanel, useJob } from "./JobWatcher";

/** Always the signed-in user's own report — the server takes the user from the session. */
export function ReportSummaryButton() {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const job = useJob(id);
  useEffect(() => {
    if (job?.status === "done") router.refresh();
  }, [job?.status, router]);
  return (
    <div className="mt-2">
      <button
        className="btn-secondary !py-1.5 text-sm"
        disabled={!!id && job?.status !== "failed"}
        onClick={async () => {
          const res = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "report" }) });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) setErr(j.error ?? "Could not start");
          else setId(j.id);
        }}
      >
        Write summary (local AI)
      </button>
      {err && <p className="text-sm text-clay-deep mt-1">{err}</p>}
      {id && <div className="mt-2"><JobPanel job={job} /></div>}
    </div>
  );
}

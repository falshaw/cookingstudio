import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader, Chip } from "@/components/ui";
import { TeachForm } from "@/components/TeachForm";

export default async function TeachPage() {
  const jobs = await prisma.job.findMany({ where: { type: { in: ["teach", "feed"] } }, orderBy: { createdAt: "desc" }, take: 12 });
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Local AI · Ollama" title="Teach me">
        Type any dish. The local model writes a beginner recipe (steps, cues, mistakes), the app checks it against your household rules and rejects/regenerates if it breaks them, adds missing ingredients to the guide, and queues step photos. It takes a few minutes — you can leave the page.
      </PageHeader>
      <TeachForm />
      <h2 className="font-display text-lg font-semibold mt-8 mb-2">Recent</h2>
      <ul className="space-y-2">
        {jobs.map((j) => {
          const res = (j.result ?? {}) as { slug?: string };
          const input = (j.input ?? {}) as { dish?: string };
          return (
            <li key={j.id} className="glass-card p-3 flex flex-wrap items-center gap-2 text-sm">
              <Chip tone={j.status === "done" ? "olive" : j.status === "failed" ? "red" : "gold"}>{j.status}</Chip>
              <span className="flex-1">{j.type === "feed" ? "New-recipes feed" : input.dish}</span>
              {res.slug && <Link href={`/recipes/${res.slug}`} className="underline text-clay-deep">open</Link>}
              {j.error && <span className="w-full text-clay-deep text-xs">{j.error}</span>}
            </li>
          );
        })}
        {jobs.length === 0 && <li className="text-sm text-ink-muted">Nothing yet.</li>}
      </ul>
    </div>
  );
}

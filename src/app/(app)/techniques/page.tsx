import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader, Pic } from "@/components/ui";

export default async function TechniquesPage() {
  const rows = await prisma.technique.findMany({ orderBy: { title: "asc" }, include: { image: { select: { id: true, status: true } } } });
  return (
    <div>
      <PageHeader eyebrow="Refreshers" title="Techniques">
        Short cards for the moves every recipe uses. Steps link here when they use one.
      </PageHeader>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((t) => (
          <Link key={t.slug} href={`/techniques/${t.slug}`} className="glass-card overflow-hidden">
            <Pic image={t.image} alt={t.title} className="aspect-[16/10] w-full" rounded="rounded-none" />
            <div className="p-4">
              <h3 className="font-display font-semibold">{t.title}</h3>
              <p className="text-sm text-ink-muted line-clamp-2">{t.summary}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

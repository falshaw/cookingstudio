import Link from "next/link";
import { Search } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader, Pic, Chip, Empty } from "@/components/ui";
import { SECTIONS } from "@/lib/shopping";

const KINDS = [["", "All"], ["spice", "Spices"], ["herb", "Herbs"], ["pantry", "Pantry"], ["fresh", "Fresh"]] as const;

export default async function IngredientsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const { q = "", kind = "" } = await searchParams;
  const term = q.trim();
  const rows = await prisma.ingredient.findMany({
    where: {
      ...(kind ? { kind } : {}),
      ...(term
        ? { OR: [{ nameEn: { contains: term, mode: "insensitive" } }] }
        : {}),
    },
    orderBy: { nameEn: "asc" },
    include: { image: { select: { id: true, status: true } }, _count: { select: { uses: true } } },
  });
  const sectionLabel = new Map(SECTIONS.map((s) => [s.key as string, s.label as string]));
  return (
    <div>
      <PageHeader eyebrow="Guide" title="Ingredients">
        What it is, where to buy it, how to keep it. Search by name (e.g. “coriander”).
      </PageHeader>
      <form className="relative mb-4 max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" size={18} />
        <input name="q" defaultValue={term} placeholder="ginger, coriander, stock…" className="input-field pl-10" aria-label="Search ingredients" />
        {kind && <input type="hidden" name="kind" value={kind} />}
      </form>
      <div className="flex flex-wrap gap-2 mb-5">
        {KINDS.map(([k, l]) => (
          <Link key={k} href={`/ingredients?${new URLSearchParams({ ...(term ? { q: term } : {}), ...(k ? { kind: k } : {}) })}`} className={`rounded-full border px-3 py-1 text-sm ${kind === k ? "bg-clay/10 border-clay/30 text-clay-deep" : "border-line text-ink-soft"}`}>{l}</Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty>Nothing found for “{term}”.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((i) => (
            <Link key={i.id} href={`/ingredients/${i.slug}`} className="glass-card p-3 flex gap-3 items-center">
              <Pic image={i.image} alt={i.nameEn} className="h-16 w-16 shrink-0" rounded="rounded-lg" />
              <div className="min-w-0">
                <p className="font-semibold leading-tight">{i.nameEn}</p>
                <div className="mt-1 flex gap-1 flex-wrap">
                  <Chip>{sectionLabel.get(i.section) ?? i.section}</Chip>
                  {i._count.uses > 0 && <Chip tone="olive">{i._count.uses} recipe{i._count.uses === 1 ? "" : "s"}</Chip>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

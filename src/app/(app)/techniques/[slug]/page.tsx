import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Pic } from "@/components/ui";

export default async function TechniquePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await prisma.technique.findUnique({ where: { slug }, include: { image: { select: { id: true, status: true } } } });
  if (!t) notFound();
  const steps = await prisma.step.findMany({ where: { technique: slug, recipe: { status: "published" } }, select: { recipe: { select: { slug: true, title: true } } }, take: 200 });
  const recipes = [...new Map(steps.map((s) => [s.recipe.slug, s.recipe])).values()];
  return (
    <article className="max-w-3xl">
      <Pic image={t.image} alt={t.title} className="aspect-[16/9] w-full mb-5" />
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-clay-text">Technique</p>
      <h1 className="font-display text-3xl font-bold">{t.title}</h1>
      <p className="mt-2 text-lg text-ink-soft">{t.summary}</p>
      <section className="glass-card p-5 mt-5">
        <h2 className="font-display font-semibold mb-2">How to do it</h2>
        <ol className="list-decimal pl-5 space-y-2">
          {t.body.split("\n").filter(Boolean).map((line, i) => <li key={i}>{line.replace(/^\d+[.)]\s*/, "")}</li>)}
        </ol>
      </section>
      {t.tips && (
        <section className="glass-card p-5 mt-4">
          <h2 className="font-display font-semibold mb-2">Tips & what goes wrong</h2>
          <ul className="list-disc pl-5 space-y-1">{t.tips.split("\n").filter(Boolean).map((l, i) => <li key={i}>{l}</li>)}</ul>
        </section>
      )}
      {recipes.length > 0 && (
        <section className="mt-5">
          <h2 className="font-display font-semibold mb-2">Practise it in</h2>
          <div className="flex flex-wrap gap-2">{recipes.map((r) => <Link key={r.slug} href={`/recipes/${r.slug}`} className="rounded-full border border-line px-3 py-1 text-sm hover:border-clay">{r.title}</Link>)}</div>
        </section>
      )}
    </article>
  );
}

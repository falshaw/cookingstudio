// Add one shop receipt from a JSON file (same rules as POST /api/purchases).
// Usage (host): DATABASE_URL=postgresql://kitchen_app:...@127.0.0.1:15432/kitchen npx tsx scripts/add-receipt.ts receipts/<file>.json
// JSON: { store, boughtOn: "YYYY-MM-DD", total, note?, items: [{ name, kind?, price, grams?, ingredient? (slug) }] }
// The lines must add up to the printed total, every ingredient slug must exist, and the same
// store + date + total is refused a second time (re-running the script is safe).
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { receiptMismatch } from "../src/lib/costs";

type Item = { name: string; kind?: "food" | "drink" | "household"; price: number; grams?: number | null; ingredient?: string | null };
type Receipt = { store: string; boughtOn: string; total: number; note?: string; items: Item[] };

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: add-receipt.ts <receipt.json>");
  const r = JSON.parse(readFileSync(file, "utf8")) as Receipt;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.boughtOn)) throw new Error("boughtOn must be YYYY-MM-DD");
  const off = receiptMismatch(r.total, r.items.map((i) => i.price));
  if (off !== 0) throw new Error(`lines add up to ${(r.total - off).toFixed(2)}, receipt says ${r.total.toFixed(2)}`);

  try {
    const boughtOn = new Date(`${r.boughtOn}T00:00:00Z`);
    const dup = await prisma.purchase.findFirst({ where: { store: r.store, boughtOn, total: r.total }, select: { id: true } });
    if (dup) {
      console.log(`already there: ${r.store} ${r.boughtOn} €${r.total.toFixed(2)} (${dup.id})`);
      return;
    }
    const slugs = [...new Set(r.items.map((i) => i.ingredient).filter((s): s is string => !!s))];
    const known = await prisma.ingredient.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
    const bySlug = new Map(known.map((k) => [k.slug, k.id]));
    const missing = slugs.filter((s) => !bySlug.has(s));
    if (missing.length) throw new Error(`unknown ingredient: ${missing.join(", ")}`);
    const p = await prisma.purchase.create({
      data: {
        store: r.store,
        boughtOn,
        total: r.total,
        note: r.note ?? "",
        items: {
          create: r.items.map((i, n) => ({
            name: i.name,
            kind: i.kind ?? "food",
            price: i.price,
            grams: i.grams ?? null,
            ingredientId: i.ingredient ? bySlug.get(i.ingredient)! : null,
            sort: n,
          })),
        },
      },
      select: { id: true },
    });
    console.log(`added ${r.store} ${r.boughtOn} €${r.total.toFixed(2)}: ${r.items.length} lines, ${slugs.length} priced ingredients (${p.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

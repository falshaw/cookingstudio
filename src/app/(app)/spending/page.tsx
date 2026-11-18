import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { eur, KIND_LABEL, SPEND_KINDS, spendByMonth } from "@/lib/costs";
import { asKind, loadPurchases, recipeCosts } from "@/lib/spending";

// Household grocery spending + what a meal costs. Money only — no health data.
export default async function SpendingPage() {
  const [purchases, costs] = await Promise.all([loadPurchases(), recipeCosts()]);
  const rows = purchases.flatMap((p) => p.items.map((i) => ({ boughtOn: p.boughtOn, kind: asKind(i.kind), price: i.price })));
  const months = spendByMonth(rows);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const now = months.find((m) => m.month === thisMonth);
  const full = costs.filter((c) => c.cost.complete);
  const partial = costs.filter((c) => !c.cost.complete);

  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="groceries · household" title="Spending">
        What we spend at the shop, and what a meal costs from the prices on our receipts. A meal cost uses the latest price we paid per ingredient; until every ingredient has been bought once with its weight, the cost shows how many are priced.
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-4 mb-4 text-sm" data-testid="spend-month">
        <div className="glass-card p-3">
          <p className="text-xs text-ink-muted">This month</p>
          <p className="text-2xl font-bold">{eur(now?.total ?? 0)}</p>
          <p className="text-xs text-ink-muted">{purchases.filter((p) => p.boughtOn.toISOString().startsWith(thisMonth)).length} receipts</p>
        </div>
        {SPEND_KINDS.map((k) => (
          <div key={k} className="glass-card p-3">
            <p className="text-xs text-ink-muted">{KIND_LABEL[k]} · this month</p>
            <p className="text-xl font-bold">{eur(now?.byKind[k] ?? 0)}</p>
          </div>
        ))}
      </div>

      <section className="glass-card p-4 mb-4" data-testid="meal-costs">
        <h2 className="font-display text-lg font-semibold mb-1">What a meal costs</h2>
        {costs.length === 0 ? (
          <p className="text-sm text-ink-muted">No prices yet — add a receipt and the meals that use those ingredients show up here.</p>
        ) : (
          <>
            <p className="text-xs text-ink-muted mb-2">Per portion, from receipt prices. {full.length} fully priced · {partial.length} partly priced (the shown cost covers only the priced ingredients, so the real cost is higher).</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted">
                    <th className="py-1 pr-2">Meal</th>
                    <th className="py-1 pr-2 text-right">Per portion</th>
                    <th className="py-1 text-right">Priced</th>
                  </tr>
                </thead>
                <tbody>
                  {costs.map((c) => (
                    <tr key={c.slug} className="border-t border-line">
                      <td className="py-1 pr-2"><Link href={`/recipes/${c.slug}`} className="underline decoration-dotted">{c.title}</Link></td>
                      <td className="py-1 pr-2 text-right tabular-nums">{c.cost.complete ? eur(c.cost.perPortion) : `≥ ${eur(c.cost.perPortion)}`}</td>
                      <td className="py-1 text-right tabular-nums text-ink-muted">{c.cost.priced} of {c.cost.lines}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {months.length > 1 && (
        <section className="glass-card p-4 mb-4" data-testid="spend-months">
          <h2 className="font-display text-lg font-semibold mb-2">By month</h2>
          <table className="w-full text-sm">
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-t border-line">
                  <td className="py-1">{m.month}</td>
                  <td className="py-1 text-right tabular-nums font-semibold">{eur(m.total)}</td>
                  <td className="py-1 text-right text-xs text-ink-muted">{SPEND_KINDS.map((k) => `${KIND_LABEL[k]} ${eur(m.byKind[k])}`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="glass-card p-4" data-testid="receipts">
        <h2 className="font-display text-lg font-semibold mb-2">Receipts</h2>
        {purchases.length === 0 && <p className="text-sm text-ink-muted">No receipts yet.</p>}
        {purchases.map((p) => (
          <details key={p.id} className="border-t border-line py-2">
            <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
              <span><span className="font-semibold">{p.store}</span> · {p.boughtOn.toISOString().slice(0, 10)}</span>
              <span className="tabular-nums font-semibold">{eur(p.total)}</span>
            </summary>
            {p.note && <p className="mt-1 text-xs text-ink-muted">{p.note}</p>}
            <table className="mt-2 w-full text-sm">
              <tbody>
                {p.items.map((i) => (
                  <tr key={i.id}>
                    <td className="py-0.5 pr-2">
                      {i.name}
                      {i.ingredient && <span className="ml-1 text-xs text-ink-muted">→ {i.ingredient.nameEn}{i.grams ? ` · ${eur((i.price / i.grams) * 1000)}/kg` : ""}</span>}
                    </td>
                    <td className="py-0.5 pr-2 text-xs text-ink-muted">{KIND_LABEL[asKind(i.kind)]}</td>
                    <td className="py-0.5 text-right tabular-nums">{eur(i.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </section>
    </div>
  );
}

"use client";

// Week + month views of MY food log. Data = GET /api/food-log?from&to (owner-scoped server-side).
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DayTotal } from "@/lib/food-log";
import { bucketDays, daysBetween, fillDays, monthDays, monthGrid, periodRange, shiftMonth, shiftPeriod, summarise, targetStatus, tone, weekDays, type Bucket, type LongView, type Nutrient, type Status, type Tone, type View } from "@/lib/food-log-range";
import { addDays } from "@/lib/utils";

type Targets = { kcal: number | null; protein: number | null; netCarbs: number | null };

const r0 = (x: number) => Math.round(x);
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const TONE_CLASS: Record<Tone, string> = { good: "text-olive", low: "text-gold", high: "text-clay-text" };
const TONE_FILL: Record<Tone, string> = { good: "var(--olive)", low: "var(--gold)", high: "var(--clay)" };
const MARK: Record<Status, string> = { under: "▼", on: "●", over: "▲" };
const WORD: Record<Status, string> = { under: "under", on: "on target", over: "over" };

/** Value + shape marker (▼ ● ▲) + word for screen readers — status is never colour alone. */
function Val({ v, t, n, unit = "", compact = false }: { v: number; t: number | null; n: Nutrient; unit?: string; compact?: boolean }) {
  const s = targetStatus(v, t);
  if (!s) return <span className="tabular-nums">{r0(v)}{unit}</span>;
  return (
    <span className={`tabular-nums whitespace-nowrap ${TONE_CLASS[tone(n, s)]}`} title={`${r0(v)}${unit} — ${WORD[s]} (target ${t}${unit})`}>
      {r0(v)}{unit} <span aria-hidden>{MARK[s]}</span>{!compact && <span className="text-[11px]"> {WORD[s]}</span>}
      {compact && <span className="sr-only"> {WORD[s]}</span>}
    </span>
  );
}

function useDays(from: string, to: string, path = "/api/food-log") {
  const [state, setState] = useState<{ days: DayTotal[] | null; err: string }>({ days: null, err: "" });
  useEffect(() => {
    const ac = new AbortController();
    fetch(`${path}?from=${from}&to=${to}`, { signal: ac.signal })
      .then(async (res) => {
        const j = await res.json().catch(() => ({}));
        if (!res.ok) return setState({ days: null, err: j.error ?? "Could not load the log" });
        setState({ days: Array.isArray(j.days) ? j.days : [], err: "" });
      })
      .catch(() => {
        if (!ac.signal.aborted) setState({ days: null, err: "Could not load the log" });
      });
    return () => ac.abort();
  }, [from, to, path]);
  return state;
}

const UNIT: Record<View, string> = { day: "day", week: "week", month: "month", "3m": "3 months", "6m": "6 months", "1y": "12 months" };

function Nav({ view, prev, next, label, isCurrent }: { view: View; prev: string; next: string; label: string; isCurrent: boolean }) {
  const unit = UNIT[view];
  return (
    <div className="flex items-center gap-2">
      <Link href={`/food-log?view=${view}&date=${prev}`} className="btn-secondary !px-3" aria-label={`Previous ${unit}`}><ChevronLeft size={18} /></Link>
      <span className="font-semibold tabular-nums">{label}</span>
      <Link href={`/food-log?view=${view}&date=${next}`} className="btn-secondary !px-3" aria-label={`Next ${unit}`}><ChevronRight size={18} /></Link>
      {!isCurrent && <Link href={`/food-log?view=${view}`} className="text-sm underline text-ink-muted">{view === "3m" || view === "6m" || view === "1y" ? `last ${unit}` : `this ${unit}`}</Link>}
    </div>
  );
}

function Legend({ targets }: { targets: Targets }) {
  const set = [targets.kcal && `${targets.kcal} kcal`, targets.protein && `${targets.protein} g protein`, targets.netCarbs && `${targets.netCarbs} g net carbs`].filter(Boolean);
  return (
    <p className="text-xs text-ink-muted">
      {set.length ? <>Daily targets: {set.join(" · ")}. </> : <>No daily targets set (Profiles). </>}
      ▼ under · ● on target (±10 %) · ▲ over — <span className="text-olive">fine</span>, <span className="text-gold">too low</span>, <span className="text-clay-text">too high</span> (protein over is fine, net carbs under is fine).
    </p>
  );
}

function KcalChart({ days, target, today }: { days: DayTotal[]; target: number | null; today: string }) {
  const W = 700, H = 200, top = 22, bottom = 26, left = 8, right = 8;
  const max = Math.max(target ? target * 1.25 : 0, ...days.map((d) => d.kcal), 1);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const slot = (W - left - right) / days.length;
  const bw = slot * 0.56;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`kcal per day${target ? `, target ${target}` : ""}`} data-testid="week-chart">
      {days.map((d, i) => {
        const x = left + slot * i + (slot - bw) / 2;
        const s = targetStatus(d.kcal, target);
        const fill = d.entries ? (s ? TONE_FILL[tone("kcal", s)] : "var(--sea)") : "transparent";
        return (
          <g key={d.date}>
            {d.entries > 0 ? (
              <rect x={x} y={y(d.kcal)} width={bw} height={Math.max(1, y(0) - y(d.kcal))} rx={4} fill={fill} opacity={0.9} />
            ) : (
              <rect x={x} y={y(0) - 2} width={bw} height={2} fill="var(--line)" />
            )}
            <text x={x + bw / 2} y={d.entries ? y(d.kcal) - 6 : y(0) - 8} textAnchor="middle" fontSize={15} fill="var(--ink-soft)" style={{ fontVariantNumeric: "tabular-nums" }}>{d.entries ? r0(d.kcal) : "–"}</text>
            <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={15} fill={d.date === today ? "var(--sea)" : "var(--ink-muted)"} fontWeight={d.date === today ? 700 : 400}>{WD[i]}</text>
          </g>
        );
      })}
      {target ? (
        <g>
          <line x1={left} x2={W - right} y1={y(target)} y2={y(target)} stroke="var(--gold)" strokeWidth={2} strokeDasharray="6 5" />
          <text x={W - right} y={y(target) - 5} textAnchor="end" fontSize={13} fill="var(--gold)">target {target}</text>
        </g>
      ) : null}
    </svg>
  );
}

export function WeekView({ day, today, targets }: { day: string; today: string; targets: Targets }) {
  const ds = weekDays(day);
  const { days, err } = useDays(ds[0], ds[6]);
  const filled = days ? fillDays(ds, days) : null;
  const sum = filled ? summarise(filled) : null;
  const isCurrent = weekDays(today)[0] === ds[0];
  return (
    <div className="space-y-4" data-testid="food-week">
      <Nav view="week" prev={addDays(ds[0], -7)} next={addDays(ds[0], 7)} label={`${ds[0]} – ${ds[6]}`} isCurrent={isCurrent} />
      {err && <p className="text-sm text-clay-deep">{err}</p>}
      {!filled && !err && <p className="text-sm text-ink-muted">Loading…</p>}
      {filled && sum && (
        <>
          <div className="glass-card p-4"><KcalChart days={filled} target={targets.kcal} today={today} /></div>
          <div className="glass-card p-0 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm tabular-nums" data-testid="week-table">
              <thead className="text-xs uppercase tracking-wide text-ink-muted">
                <tr className="border-b border-line">
                  <th className="text-left font-semibold px-3 py-2">Day</th>
                  <th className="text-right font-semibold px-3 py-2">kcal</th>
                  <th className="text-right font-semibold px-3 py-2">Protein</th>
                  <th className="text-right font-semibold px-3 py-2">Net carbs</th>
                  <th className="text-right font-semibold px-3 py-2">Fat</th>
                  <th className="text-right font-semibold px-3 py-2">Entries</th>
                </tr>
              </thead>
              <tbody>
                {filled.map((d, i) => (
                  <tr key={d.date} className={`border-b border-line ${d.date === today ? "bg-sea/5" : ""}`}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link href={`/food-log?date=${d.date}`} className="underline decoration-line underline-offset-4 hover:text-sea" aria-label={`Open ${WD[i]} ${d.date} in day view`}>
                        {WD[i]} {d.date.slice(8)}.{d.date.slice(5, 7)}{d.date === today ? " · today" : ""}
                      </Link>
                    </td>
                    {d.entries ? (
                      <>
                        <td className="text-right px-3 py-2"><Val v={d.kcal} t={targets.kcal} n="kcal" /></td>
                        <td className="text-right px-3 py-2"><Val v={d.protein} t={targets.protein} n="protein" unit=" g" /></td>
                        <td className="text-right px-3 py-2"><Val v={d.netCarbs} t={targets.netCarbs} n="netCarbs" unit=" g" /></td>
                        <td className="text-right px-3 py-2">{r0(d.fat)} g</td>
                        <td className="text-right px-3 py-2">{d.entries}</td>
                      </>
                    ) : (
                      <td colSpan={5} className="text-right px-3 py-2 text-ink-muted">{d.date > today ? "—" : "not logged"}</td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-b border-line font-semibold">
                  <td className="px-3 py-2">Week total</td>
                  <td className="text-right px-3 py-2">{r0(sum.total.kcal)}</td>
                  <td className="text-right px-3 py-2">{r0(sum.total.protein)} g</td>
                  <td className="text-right px-3 py-2">{r0(sum.total.netCarbs)} g</td>
                  <td className="text-right px-3 py-2">{r0(sum.total.fat)} g</td>
                  <td className="text-right px-3 py-2">{sum.total.entries}</td>
                </tr>
                <tr data-testid="week-avg">
                  <td className="px-3 py-2"><span className="font-semibold">Daily average</span><br /><span className="text-xs text-ink-muted">{sum.logged} of {sum.of} days logged</span></td>
                  {sum.avg ? (
                    <>
                      <td className="text-right px-3 py-2"><Val v={sum.avg.kcal} t={targets.kcal} n="kcal" /></td>
                      <td className="text-right px-3 py-2"><Val v={sum.avg.protein} t={targets.protein} n="protein" unit=" g" /></td>
                      <td className="text-right px-3 py-2"><Val v={sum.avg.netCarbs} t={targets.netCarbs} n="netCarbs" unit=" g" /></td>
                      <td className="text-right px-3 py-2">{r0(sum.avg.fat)} g</td>
                      <td />
                    </>
                  ) : (
                    <td colSpan={5} className="text-right px-3 py-2 text-ink-muted">nothing logged this week</td>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
          <Legend targets={targets} />
        </>
      )}
    </div>
  );
}

export function MonthView({ day, today, targets }: { day: string; today: string; targets: Targets }) {
  const ds = monthDays(day);
  const { days, err } = useDays(ds[0], ds[ds.length - 1]);
  const filled = days ? fillDays(ds, days) : null;
  const by = new Map((filled ?? []).map((d) => [d.date, d]));
  const sum = filled ? summarise(filled) : null;
  const [yy, mm] = [day.slice(0, 4), +day.slice(5, 7)];
  return (
    <div className="space-y-4" data-testid="food-month">
      <Nav view="month" prev={shiftMonth(day, -1)} next={shiftMonth(day, 1)} label={`${MONTHS[mm - 1]} ${yy}`} isCurrent={today.slice(0, 7) === day.slice(0, 7)} />
      {err && <p className="text-sm text-clay-deep">{err}</p>}
      {!filled && !err && <p className="text-sm text-ink-muted">Loading…</p>}
      {filled && sum && (
        <>
          <div className="glass-card p-4 grid gap-3 grid-cols-2 sm:grid-cols-4 tabular-nums" data-testid="month-avg">
            <p className="col-span-2 sm:col-span-4 text-sm"><span className="font-semibold">Daily average</span> <span className="text-ink-muted">· {sum.logged} of {sum.of} days logged</span></p>
            {sum.avg ? (
              <>
                <div><p className="text-xs text-ink-muted">kcal</p><Val v={sum.avg.kcal} t={targets.kcal} n="kcal" /></div>
                <div><p className="text-xs text-ink-muted">Protein</p><Val v={sum.avg.protein} t={targets.protein} n="protein" unit=" g" /></div>
                <div><p className="text-xs text-ink-muted">Net carbs</p><Val v={sum.avg.netCarbs} t={targets.netCarbs} n="netCarbs" unit=" g" /></div>
                <div><p className="text-xs text-ink-muted">Fat</p><span>{r0(sum.avg.fat)} g</span></div>
              </>
            ) : (
              <p className="col-span-2 sm:col-span-4 text-sm text-ink-muted">Nothing logged this month.</p>
            )}
          </div>
          <div className="glass-card p-2 sm:p-3" data-testid="month-grid">
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-wide text-ink-muted mb-1">
              {WD.map((w) => <div key={w}>{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthGrid(day).flat().map((d, i) => {
                if (!d) return <div key={`x${i}`} aria-hidden />;
                const t = by.get(d);
                const logged = !!t?.entries;
                const ks = logged ? targetStatus(t!.kcal, targets.kcal) : null;
                const ps = logged ? targetStatus(t!.protein, targets.protein) : null;
                return (
                  <Link
                    key={d}
                    href={`/food-log?date=${d}`}
                    aria-label={`${d}: ${logged ? `${r0(t!.kcal)} kcal${ks ? ` ${WORD[ks]}` : ""}, ${r0(t!.protein)} g protein${ps ? ` ${WORD[ps]}` : ""}` : d > today ? "future" : "not logged"} — open day`}
                    className={`min-h-[3.6rem] sm:min-h-[4.5rem] rounded-md border px-1 py-1 flex flex-col items-start text-left hover:border-sea ${logged ? "border-line bg-paper" : "border-dashed border-line/70"} ${d === today ? "!border-sea" : ""}`}
                  >
                    <span className={`text-[11px] tabular-nums ${d === today ? "text-sea font-bold" : "text-ink-muted"}`}>{+d.slice(8)}</span>
                    {logged ? (
                      <>
                        <span className="text-[11px] sm:text-sm leading-tight"><Val v={t!.kcal} t={targets.kcal} n="kcal" compact /></span>
                        <span className="text-[10px] sm:text-xs leading-tight text-ink-soft"><Val v={t!.protein} t={targets.protein} n="protein" unit="P" compact /></span>
                      </>
                    ) : (
                      <span className="text-[10px] text-ink-muted/70 mt-auto">{d > today ? "" : "—"}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
          <Legend targets={targets} />
        </>
      )}
    </div>
  );
}

const LABEL: Record<View, string> = { day: "Day", week: "Week", month: "Month", "3m": "3 mo", "6m": "6 mo", "1y": "Year" };

/** Day / Week / Month / 3 mo / 6 mo / Year switch — the choice lives in the URL (?view=…&date=…). */
export function ViewSwitch({ view, day }: { view: View; day: string }) {
  return (
    <nav className="inline-flex flex-wrap rounded-full border border-line p-0.5 text-sm" aria-label="Food log view" data-testid="food-view-switch">
      {(["day", "week", "month", "3m", "6m", "1y"] as const).map((v) => (
        <Link
          key={v}
          href={v === "day" ? `/food-log?date=${day}` : `/food-log?view=${v}&date=${day}`}
          aria-current={v === view ? "page" : undefined}
          className={`px-2.5 sm:px-3 py-1 rounded-full whitespace-nowrap ${v === view ? "bg-sea text-cream font-semibold" : "text-ink-soft hover:text-sea"}`}
        >
          {LABEL[v]}
        </Link>
      ))}
    </nav>
  );
}

const fmtDM = (d: string) => d.slice(5); // MM-DD
const bucketLabel = (b: Bucket, by: "week" | "month") => (by === "week" ? `${fmtDM(b.from)}–${fmtDM(b.to)}` : `${MONTHS[+b.key.slice(5, 7) - 1].slice(0, 3)} ${b.key.slice(0, 4)}`);

/** Average per logged day for each bucket, with the daily target as a dashed line. Empty bucket = a flat stub. */
function BucketChart({ buckets, by, n, target, unit, title }: { buckets: Bucket[]; by: "week" | "month"; n: "kcal" | "protein"; target: number | null; unit: string; title: string }) {
  const W = 700, H = 190, top = 24, bottom = 26, left = 6, right = 6;
  const vals = buckets.map((b) => (b.avg ? b.avg[n] : 0));
  const max = Math.max(target ? target * 1.25 : 0, ...vals, 1);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const slot = (W - left - right) / Math.max(1, buckets.length);
  const bw = slot * (buckets.length > 15 ? 0.7 : 0.56);
  const showVals = buckets.length <= 14;
  const every = Math.ceil(buckets.length / 7); // at most ~7 axis labels, readable at 390 px
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs font-semibold uppercase tracking-[0.18em] text-clay-text">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${title}${target ? `, target ${target}${unit}` : ""}`}>
        {buckets.map((b, i) => {
          const v = vals[i];
          const x = left + slot * i + (slot - bw) / 2;
          const s = b.avg ? targetStatus(v, target) : null;
          return (
            <g key={b.key}>
              <title>{`${bucketLabel(b, by)}: ${b.avg ? `${r0(v)}${unit} per logged day` : "not logged"} · ${b.logged} of ${b.of} days logged`}</title>
              {b.avg ? (
                <rect x={x} y={y(v)} width={bw} height={Math.max(1, y(0) - y(v))} rx={3} fill={s ? TONE_FILL[tone(n, s)] : "var(--sea)"} opacity={0.9} />
              ) : (
                <rect x={x} y={y(0) - 2} width={bw} height={2} fill="var(--line)" />
              )}
              {showVals && b.avg && <text x={x + bw / 2} y={y(v) - 6} textAnchor="middle" fontSize={14} fill="var(--ink-soft)" style={{ fontVariantNumeric: "tabular-nums" }}>{r0(v)}</text>}
              {i % every === 0 && <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={13} fill="var(--ink-muted)">{by === "week" ? fmtDM(b.from) : MONTHS[+b.key.slice(5, 7) - 1].slice(0, 3)}</text>}
            </g>
          );
        })}
        {target ? (
          <g>
            <line x1={left} x2={W - right} y1={y(target)} y2={y(target)} stroke="var(--gold)" strokeWidth={2} strokeDasharray="6 5" />
            <text x={W - right} y={y(target) - 5} textAnchor="end" fontSize={13} fill="var(--gold)">target {target}{unit}</text>
          </g>
        ) : null}
      </svg>
    </figure>
  );
}

/** 3 months / 6 months / 1 year: per-day totals from /api/food-log/summary, bucketed by week or month. */
export function LongRangeView({ view, day, today, targets }: { view: LongView; day: string; today: string; targets: Targets }) {
  const { from, to } = periodRange(view, day);
  const { days, err } = useDays(from, to, "/api/food-log/summary");
  const filled = days ? fillDays(daysBetween(from, to), days) : null;
  const chartBy: "week" | "month" = view === "1y" ? "month" : "week";
  const tableBy: "week" | "month" = view === "3m" ? "week" : "month";
  const chartBuckets = filled ? bucketDays(filled, chartBy) : [];
  const tableBuckets = filled ? bucketDays(filled, tableBy) : [];
  const sum = filled ? summarise(filled) : null;
  const mon = (d: string) => `${MONTHS[+d.slice(5, 7) - 1].slice(0, 3)} ${d.slice(0, 4)}`;
  return (
    <div className="space-y-4" data-testid={`food-${view}`}>
      <Nav view={view} prev={shiftPeriod(view, day, -1)} next={shiftPeriod(view, day, 1)} label={`${mon(from)} – ${mon(to)}`} isCurrent={to.slice(0, 7) === today.slice(0, 7)} />
      {err && <p className="text-sm text-clay-deep">{err}</p>}
      {!filled && !err && <p className="text-sm text-ink-muted">Loading…</p>}
      {filled && sum && (
        <>
          <div className="glass-card p-4 grid gap-3 grid-cols-2 sm:grid-cols-4 tabular-nums" data-testid="long-avg">
            <p className="col-span-2 sm:col-span-4 text-sm"><span className="font-semibold">Daily average</span> <span className="text-ink-muted">· {sum.logged} of {sum.of} days logged</span></p>
            {sum.avg ? (
              <>
                <div><p className="text-xs text-ink-muted">kcal</p><Val v={sum.avg.kcal} t={targets.kcal} n="kcal" /></div>
                <div><p className="text-xs text-ink-muted">Protein</p><Val v={sum.avg.protein} t={targets.protein} n="protein" unit=" g" /></div>
                <div><p className="text-xs text-ink-muted">Net carbs</p><Val v={sum.avg.netCarbs} t={targets.netCarbs} n="netCarbs" unit=" g" /></div>
                <div><p className="text-xs text-ink-muted">Fat</p><span>{r0(sum.avg.fat)} g</span></div>
              </>
            ) : (
              <p className="col-span-2 sm:col-span-4 text-sm text-ink-muted">Nothing logged in this period.</p>
            )}
          </div>
          <div className="glass-card p-4 space-y-4" data-testid="long-chart">
            <BucketChart buckets={chartBuckets} by={chartBy} n="kcal" target={targets.kcal} unit="" title={`kcal per logged day, by ${chartBy}`} />
            <BucketChart buckets={chartBuckets} by={chartBy} n="protein" target={targets.protein} unit=" g" title={`Protein per logged day, by ${chartBy}`} />
          </div>
          <div className="glass-card p-0 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm tabular-nums" data-testid="long-table">
              <caption className="sr-only">Average per logged day, by {tableBy}</caption>
              <thead className="text-xs uppercase tracking-wide text-ink-muted">
                <tr className="border-b border-line">
                  <th className="text-left font-semibold px-3 py-2">{tableBy === "week" ? "Week" : "Month"}</th>
                  <th className="text-right font-semibold px-3 py-2">kcal</th>
                  <th className="text-right font-semibold px-3 py-2">Protein</th>
                  <th className="text-right font-semibold px-3 py-2">Net carbs</th>
                  <th className="text-right font-semibold px-3 py-2">Fat</th>
                  <th className="text-right font-semibold px-3 py-2">Logged</th>
                </tr>
              </thead>
              <tbody>
                {tableBuckets.map((b) => (
                  <tr key={b.key} className="border-b border-line">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link href={`/food-log?view=${tableBy}&date=${b.from}`} className="underline decoration-line underline-offset-4 hover:text-sea">{bucketLabel(b, tableBy)}</Link>
                    </td>
                    {b.avg ? (
                      <>
                        <td className="text-right px-3 py-2"><Val v={b.avg.kcal} t={targets.kcal} n="kcal" /></td>
                        <td className="text-right px-3 py-2"><Val v={b.avg.protein} t={targets.protein} n="protein" unit=" g" /></td>
                        <td className="text-right px-3 py-2"><Val v={b.avg.netCarbs} t={targets.netCarbs} n="netCarbs" unit=" g" /></td>
                        <td className="text-right px-3 py-2">{r0(b.avg.fat)} g</td>
                      </>
                    ) : (
                      <td colSpan={4} className="text-right px-3 py-2 text-ink-muted">{b.from > today ? "—" : "not logged"}</td>
                    )}
                    <td className="text-right px-3 py-2 whitespace-nowrap">{b.logged} of {b.of} days</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Legend targets={targets} />
        </>
      )}
    </div>
  );
}

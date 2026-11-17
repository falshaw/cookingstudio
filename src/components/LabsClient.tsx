"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Plus, Trash2 } from "lucide-react";

interface Lab { id: string; marker: string; value: number | null; unit: string; refLow: number | null; refHigh: number | null; date: string | null; flag: string | null; note: string | null }
interface Extracted { marker: string; value: number | null; unit: string; refLow: number | null; refHigh: number | null; date: string | null; foundInText?: boolean }

function status(l: { value: number | null; refLow: number | null; refHigh: number | null }) {
  if (l.value == null) return null;
  if (l.refHigh != null && l.value > l.refHigh) return "high";
  if (l.refLow != null && l.value < l.refLow) return "low";
  return "ok";
}

/** Small accessible trend chart: dated points, reference band, value labels. */
function Trend({ rows }: { rows: Lab[] }) {
  const pts = rows.filter((r) => r.date && r.value != null).sort((a, b) => a.date!.localeCompare(b.date!));
  if (pts.length < 2) return null;
  const W = 320, H = 120, P = 26;
  const xs = pts.map((p) => new Date(p.date!).getTime());
  const vals = pts.map((p) => p.value!);
  const refHigh = pts[pts.length - 1].refHigh, refLow = pts[pts.length - 1].refLow;
  const lo = Math.min(...vals, refLow ?? Infinity), hi = Math.max(...vals, refHigh ?? -Infinity);
  const pad = (hi - lo) * 0.15 || 1;
  const y = (v: number) => H - P - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 2 * P);
  const x = (t: number) => P + ((t - xs[0]) / (xs[xs.length - 1] - xs[0] || 1)) * (W - 2 * P);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(xs[i]).toFixed(1)},${y(p.value!).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md" role="img" aria-label={`${pts[0].marker} trend: ${pts.map((p) => `${p.date} ${p.value} ${p.unit}`).join(", ")}`}>
      {(refLow != null || refHigh != null) && <rect x={P} width={W - 2 * P} y={y(refHigh ?? hi + pad)} height={Math.max(0, y(refLow ?? lo - pad) - y(refHigh ?? hi + pad))} fill="#b6ff3d" opacity="0.1" />}
      {refHigh != null && <line x1={P} x2={W - P} y1={y(refHigh)} y2={y(refHigh)} stroke="#b6ff3d" strokeDasharray="3 3" />}
      <path d={path} fill="none" stroke="#ff4fd8" strokeWidth="2" />
      {pts.map((p, i) => (
        <g key={p.id}>
          <circle cx={x(xs[i])} cy={y(p.value!)} r="3.5" fill={status(p) === "ok" ? "#b6ff3d" : "#ff4fd8"} />
          <text x={x(xs[i])} y={y(p.value!) - 7} textAnchor="middle" fontSize="9" fill="#f4f1ff">{p.value}</text>
          <text x={x(xs[i])} y={H - 6} textAnchor="middle" fontSize="8" fill="#a39dbd">{p.date!.slice(2, 7)}</text>
        </g>
      ))}
    </svg>
  );
}

export function LabsClient({ labs, imports, pendingReview }: { labs: Lab[]; imports: { id: string; status: string }[]; pendingReview?: { id: string; rows: Extracted[] } | null }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ marker: "", value: "", unit: "", refLow: "", refHigh: "", date: "", note: "" });
  const [review, setReview] = useState<{ id: string; rows: (Extracted & { keep: boolean })[] } | null>(pendingReview ? { id: pendingReview.id, rows: pendingReview.rows.map((r) => ({ ...r, keep: false })) } : null);
  const [polling, setPolling] = useState<string | null>(imports.find((i) => i.status === "queued" || i.status === "running")?.id ?? null);
  const markers = useMemo(() => [...new Set(labs.map((l) => l.marker))], [labs]);
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  async function openReview(id: string) {
    const j = await (await fetch(`/api/labs/import/${id}`)).json();
    setReview({ id, rows: ((j.extracted ?? []) as Extracted[]).map((r) => ({ ...r, keep: false })) });
  }
  useEffect(() => {
    if (!polling) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/labs/import/${polling}`);
      if (!res.ok) return;
      const j = await res.json();
      if (j.status === "review") { setPolling(null); void openReview(polling); }
      else if (j.status === "failed") { setPolling(null); setErr(`PDF import failed: ${j.error}`); }
    }, 3000);
    return () => clearInterval(t);
  }, [polling]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const res = await fetch("/api/labs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marker: form.marker, value: num(form.value), unit: form.unit, refLow: num(form.refLow), refHigh: num(form.refHigh), date: form.date || null, note: form.note || null }) });
    if (!res.ok) return setErr((await res.json().catch(() => ({}))).error ?? "Failed");
    setForm({ marker: "", value: "", unit: "", refLow: "", refHigh: "", date: "", note: "" });
    router.refresh();
  }
  async function del(id: string) {
    await fetch("/api/labs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    router.refresh();
  }
  async function upload(f: File) {
    setErr("");
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch("/api/labs/import", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(j.error ?? "Upload failed");
    setPolling(j.id);
  }
  async function confirm() {
    if (!review) return;
    const rows = review.rows.filter((r) => r.keep).map(({ marker, value, unit, refLow, refHigh, date }) => ({ marker, value, unit, refLow, refHigh, date }));
    const res = await fetch(`/api/labs/import/${review.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });
    if (!res.ok) return setErr((await res.json().catch(() => ({}))).error ?? "Save failed");
    setReview(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {err && <p className="text-sm text-clay-deep">{err}</p>}
      <section>
        <h2 className="font-display text-lg font-semibold mb-2">Trends</h2>
        {markers.length === 0 && <p className="text-sm text-ink-muted">No lab values yet — add one below or import a lab PDF.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {markers.map((m) => {
            const rows = labs.filter((l) => l.marker === m);
            const last = [...rows].filter((r) => r.date).sort((a, b) => a.date!.localeCompare(b.date!)).pop() ?? rows[rows.length - 1];
            const st = status(last);
            return (
              <div key={m} className="glass-card p-3" data-testid={`marker-${m}`}>
                <div className="flex items-baseline gap-2">
                  <h3 className="font-semibold flex-1">{m}</h3>
                  <span className={st === "high" || st === "low" ? "text-clay-deep font-semibold" : "text-olive font-semibold"}>{last.value ?? last.flag ?? "—"} {last.unit}</span>
                </div>
                <p className="text-xs text-ink-muted">{last.date ?? "history (date unknown)"}{(last.refLow != null || last.refHigh != null) && ` · ref ${last.refLow ?? ""}–${last.refHigh ?? ""}`}</p>
                <Trend rows={rows} />
              </div>
            );
          })}
        </div>
      </section>

      <section className="glass-card p-4">
        <h2 className="font-display text-lg font-semibold mb-2">Import a lab PDF</h2>
        <p className="text-sm text-ink-muted mb-2">Read on this PC (pdftotext + the local model); you confirm every value before it is saved.</p>
        <label className="btn-secondary inline-flex items-center gap-2 cursor-pointer">
          <FileUp size={16} /> Choose PDF
          <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        {polling && <p className="mt-2 text-sm inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Reading the report (a few minutes)…</p>}
        {review && (
          <div className="mt-4 overflow-x-auto" data-testid="lab-review">
            <p className="text-sm font-semibold mb-2">Tick each value to save (correct anything wrong):</p>
            <table className="w-full text-sm">
              <tbody>
                {review.rows.map((r, k) => {
                  const set = (patch: Partial<Extracted & { keep: boolean }>) => setReview({ ...review, rows: review.rows.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
                  return (
                    <tr key={k} className="border-t border-line">
                      <td><input type="checkbox" checked={r.keep} onChange={(e) => set({ keep: e.target.checked })} aria-label={`save ${r.marker}`} /></td>
                      <td><input className="input-field !py-1" value={r.marker} onChange={(e) => set({ marker: e.target.value })} /></td>
                      <td><input className="input-field !py-1 !w-20" value={r.value ?? ""} onChange={(e) => set({ value: num(e.target.value) })} /></td>
                      <td><input className="input-field !py-1 !w-20" value={r.unit} onChange={(e) => set({ unit: e.target.value })} /></td>
                      <td><input className="input-field !py-1 !w-16" value={r.refLow ?? ""} onChange={(e) => set({ refLow: num(e.target.value) })} /></td>
                      <td><input className="input-field !py-1 !w-16" value={r.refHigh ?? ""} onChange={(e) => set({ refHigh: num(e.target.value) })} /></td>
                      <td><input type="date" className="input-field !py-1" value={r.date ?? ""} onChange={(e) => set({ date: e.target.value || null })} /></td>
                      <td>{r.foundInText === false && <span className="text-xs text-clay-deep">not in PDF text — check!</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button onClick={confirm} className="btn-primary mt-3">Save {review.rows.filter((r) => r.keep).length} confirmed value(s)</button>
          </div>
        )}
      </section>

      <section className="glass-card p-4">
        <h2 className="font-display text-lg font-semibold mb-2">Add a value by hand</h2>
        <form onSubmit={add} className="grid gap-2 grid-cols-2 sm:grid-cols-4">
          <input required placeholder="Marker (e.g. Ferritin)" value={form.marker} onChange={(e) => setForm({ ...form, marker: e.target.value })} className="input-field col-span-2" list="markers" />
          <datalist id="markers">{markers.map((m) => <option key={m} value={m} />)}</datalist>
          <input placeholder="Value" inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="input-field" />
          <input placeholder="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="input-field" />
          <input placeholder="Ref low" inputMode="decimal" value={form.refLow} onChange={(e) => setForm({ ...form, refLow: e.target.value })} className="input-field" />
          <input placeholder="Ref high" inputMode="decimal" value={form.refHigh} onChange={(e) => setForm({ ...form, refHigh: e.target.value })} className="input-field" />
          <input type="date" aria-label="Date (empty = history)" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input-field" />
          <input placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="input-field" />
          <button className="btn-primary col-span-2 sm:col-span-4 inline-flex items-center justify-center gap-1"><Plus size={16} /> Add</button>
        </form>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold mb-2">All values</h2>
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm" data-testid="labs-table">
            <tbody>
              {[...labs].sort((a, b) => (b.date ?? "0").localeCompare(a.date ?? "0")).map((l) => {
                const st = status(l);
                return (
                  <tr key={l.id} className="border-t border-line">
                    <td className="p-2 whitespace-nowrap">{l.date ?? <em className="text-ink-muted">history</em>}</td>
                    <td className="p-2">{l.marker}</td>
                    <td className={`p-2 tabular-nums ${st === "high" || st === "low" ? "text-clay-deep font-semibold" : ""}`}>{l.value ?? l.flag ?? "—"} {l.unit}{st && st !== "ok" && ` (${st})`}</td>
                    <td className="p-2 text-ink-muted">{l.refLow ?? ""}{(l.refLow != null || l.refHigh != null) && "–"}{l.refHigh ?? ""}</td>
                    <td className="p-2 text-ink-muted">{l.note}</td>
                    <td className="p-2"><button onClick={() => del(l.id)} aria-label={`Delete ${l.marker} ${l.date ?? ""}`}><Trash2 size={15} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

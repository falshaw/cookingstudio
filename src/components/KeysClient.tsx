"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Trash2 } from "lucide-react";
import { SCOPE_LABELS, SCOPES, type Scope } from "@/lib/api-key-scopes";

export interface KeyRow { id: string; name: string; hint: string; scopes: string[]; expiresAt: string; lastUsedAt: string | null; createdAt: string }

const day = (iso: string) => iso.slice(0, 10);

export function KeysClient({ keys }: { keys: KeyRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("My assistant");
  const [scopes, setScopes] = useState<Scope[]>(["food-log:read", "food-log:write", "weight:read", "weight:write", "shopping:write"]);
  const [days, setDays] = useState(90);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  function toggle(s: Scope) {
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!scopes.length) return setErr("Tick at least one permission.");
    const res = await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, scopes, days }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(j.error ?? "Could not make the key.");
    setFresh(j.key);
    setCopied(false);
    router.refresh();
  }
  async function del(id: string, label: string) {
    if (!confirm(`Delete the key "${label}"? Anything using it stops working at once.`)) return;
    await fetch("/api/keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    router.refresh();
  }
  async function copy() {
    if (!fresh) return;
    await navigator.clipboard.writeText(fresh).catch(() => {});
    setCopied(true);
  }

  return (
    <div className="space-y-6">
      {fresh && (
        <section className="glass-card p-4 border-2 border-clay" data-testid="new-key">
          <h2 className="font-display text-lg font-semibold mb-1">Your new key — copy it now</h2>
          <p className="text-sm mb-2">It is shown only this once. Put it in your tool&apos;s config file, never in a chat or an email.</p>
          <div className="flex flex-wrap gap-2 items-center">
            <code className="text-xs break-all bg-sand px-2 py-1 rounded">{fresh}</code>
            <button type="button" onClick={copy} className="btn-primary !py-1.5 inline-flex items-center gap-1">
              <Copy size={14} /> {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" onClick={() => setFresh(null)} className="text-sm underline">Done, hide it</button>
          </div>
        </section>
      )}

      <section className="glass-card p-4" data-testid="keys">
        <h2 className="font-display text-lg font-semibold mb-2">My keys</h2>
        {keys.length === 0 ? (
          <p className="text-sm text-ink-muted">No keys yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {keys.map((k) => {
              const expired = new Date(k.expiresAt) <= new Date();
              return (
                <li key={k.id} className="py-2 flex flex-wrap items-start justify-between gap-2">
                  <div className="text-sm">
                    <strong>{k.name}</strong> <code className="text-xs">{k.hint}</code>
                    <div className="text-ink-muted text-xs mt-0.5">
                      {k.scopes.join(" · ")}
                      <br />
                      made {day(k.createdAt)} · {expired ? <span className="text-clay-deep">expired {day(k.expiresAt)}</span> : <>valid until {day(k.expiresAt)}</>} · {k.lastUsedAt ? `last used ${day(k.lastUsedAt)}` : "never used"}
                    </div>
                  </div>
                  <button type="button" onClick={() => del(k.id, k.name)} className="text-sm inline-flex items-center gap-1 text-clay-deep" aria-label={`Delete key ${k.name}`}>
                    <Trash2 size={14} /> Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="glass-card p-4">
        <h2 className="font-display text-lg font-semibold mb-2">Make a new key</h2>
        <form onSubmit={create} className="space-y-3">
          <label className="block text-sm">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required className="input-field mt-1" />
          </label>
          <fieldset className="text-sm">
            <legend className="mb-1">What this key may do (only for you — never anyone else&apos;s data)</legend>
            {SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} />
                {SCOPE_LABELS[s]}
              </label>
            ))}
          </fieldset>
          <label className="block text-sm">
            Valid for
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input-field mt-1 !w-auto">
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>1 year</option>
            </select>
          </label>
          <button className="btn-primary !py-2">Make key</button>
          {err && <span className="text-sm text-clay-deep ml-2">{err}</span>}
        </form>
        <p className="text-xs text-ink-muted mt-3">A key cannot see labs, glucose, reports or anything not ticked here, and it cannot make or delete keys.</p>
      </section>
    </div>
  );
}

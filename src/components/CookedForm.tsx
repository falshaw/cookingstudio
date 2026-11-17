"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

/** `sauceLesson` = the dish's Sauce School lesson: logging the dish also credits that sauce, rated on its own. */
export function CookedForm({ recipeId, practice, sauceLesson = null }: { recipeId: string; practice: { userName: string; count: number; confidence: number | null }[]; sauceLesson?: { slug: string; title: string } | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(4);
  const [confidence, setConfidence] = useState(3);
  const [notes, setNotes] = useState("");
  const [tweak, setTweak] = useState("");
  const [madeSauce, setMadeSauce] = useState(true);
  const [sauceRating, setSauceRating] = useState(4);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/cook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipeId, rating, confidence, notes, tweak, ...(sauceLesson ? { sauceCredit: madeSauce, sauceRating: madeSauce ? sauceRating : undefined } : {}) }),
    });
    setBusy(false);
    if (!res.ok) {
      setMsg((await res.json().catch(() => ({}))).error ?? "Could not save");
      return;
    }
    setOpen(false);
    setMsg(sauceLesson && madeSauce ? `Logged — and ${sauceLesson.title} counts as practised.` : "Logged. Nice work.");
    router.refresh();
  }

  return (
    <div className="glass-card p-4" data-testid="cooked">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="text-sm text-ink-soft">
          {practice.length === 0 ? "Not cooked yet." : practice.map((p) => `${p.userName}: ${p.count}× (confidence ${p.confidence ?? "–"}/5)`).join(" · ")}
        </div>
        <button onClick={() => setOpen((o) => !o)} className="btn-primary inline-flex items-center gap-2">
          <CheckCircle2 size={18} /> Mark as cooked
        </button>
      </div>
      {msg && <p className="mt-2 text-sm text-olive">{msg}</p>}
      {open && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            How did it taste? (1–5)
            <input type="range" min={1} max={5} value={rating} onChange={(e) => setRating(+e.target.value)} className="w-full accent-[#9e4527]" />
            <span className="font-semibold">{rating}/5</span>
          </label>
          <label className="text-sm">
            How confident do you feel making it again? (1–5)
            <input type="range" min={1} max={5} value={confidence} onChange={(e) => setConfidence(+e.target.value)} className="w-full accent-[#5e6b4f]" />
            <span className="font-semibold">{confidence}/5</span>
          </label>
          {sauceLesson && (
            <fieldset className="sm:col-span-2 rounded-xl border border-line p-3 text-sm" data-testid="sauce-credit">
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={madeSauce} onChange={(e) => setMadeSauce(e.target.checked)} />
                I made the sauce — count it for {sauceLesson.title}
              </label>
              {madeSauce && (
                <label className="block mt-2">
                  How did the sauce turn out? (1–5)
                  <input type="range" min={1} max={5} value={sauceRating} onChange={(e) => setSauceRating(+e.target.value)} className="w-full accent-[#2f6e8f]" />
                  <span className="font-semibold">{sauceRating}/5</span>
                </label>
              )}
            </fieldset>
          )}
          <label className="text-sm sm:col-span-2">
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input-field mt-1" />
          </label>
          <label className="text-sm sm:col-span-2">
            Tweak next time (shown at the top next time you open it)
            <input value={tweak} onChange={(e) => setTweak(e.target.value)} placeholder="e.g. less salt, sear 1 min longer" className="input-field mt-1" />
          </label>
          <button disabled={busy} onClick={save} className="btn-primary sm:col-span-2">{busy ? "Saving…" : "Save"}</button>
        </div>
      )}
    </div>
  );
}

"use client";
import { MedicalFooter } from "@/components/MedicalFooter";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // The digest is the key into `docker logs kitchen-app` (the server logs the full error).
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="glass-card p-8 w-full max-w-md text-center">
        <p className="text-[11px] uppercase tracking-[0.22em] text-clay mb-2">
          Something broke
        </p>
        <h1 className="text-2xl font-bold text-ink">This page could not load</h1>
        <p className="text-sm text-ink-muted mt-2">
          Your data is untouched — nothing was written. Try again, and if it
          keeps failing the app log has the details.
        </p>
        {error.digest && (
          <p className="text-xs text-ink-muted mt-3 font-mono">ref {error.digest}</p>
        )}
        <div className="flex items-center justify-center gap-3 mt-6">
          <button type="button" onClick={reset} className="btn-primary">
            Try again
          </button>
          <a href="/dashboard" className="btn-secondary">
            Dashboard
          </a>
        </div>
      </div>
      <MedicalFooter className="mt-6 border-0" />
    </div>
  );
}

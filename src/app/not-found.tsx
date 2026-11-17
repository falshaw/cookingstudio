import Link from "next/link";
import { MedicalFooter } from "@/components/MedicalFooter";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="glass-card p-8 w-full max-w-md text-center">
        <p className="text-[11px] uppercase tracking-[0.22em] text-clay mb-2">404</p>
        <h1 className="text-2xl font-bold text-ink">No such page</h1>
        <p className="text-sm text-ink-muted mt-2">
          That page is not in the kitchen.
        </p>
        <Link href="/dashboard" className="btn-primary inline-block mt-6">
          Back to the dashboard
        </Link>
      </div>
      <MedicalFooter className="mt-6 border-0" />
    </div>
  );
}

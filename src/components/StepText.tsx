import type { Segment } from "@/lib/inline-amounts";

/** One step sentence with amounts in bold — segments come from amountsForSteps() (all steps, first mention only). */
export function StepText({ segs, amountClass = "font-semibold text-clay-deep" }: { segs: Segment[]; amountClass?: string }) {
  return (
    <>
      {segs.map((s, k) => ("amount" in s ? <strong key={k} className={amountClass}>{s.amount}</strong> : <span key={k}>{s.text}</span>))}
    </>
  );
}

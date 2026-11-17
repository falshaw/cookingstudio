/** Required on every page (hard rule): this app gives no medical advice. */
export function MedicalFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`border-t border-line px-4 py-3 text-center text-xs text-ink-muted ${className}`}>
      Not medical advice, check with your doctor.
    </footer>
  );
}

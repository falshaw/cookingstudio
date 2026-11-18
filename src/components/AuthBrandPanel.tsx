import { ChefHat, Timer, Soup, ShoppingBasket } from "lucide-react";

export function AuthBrandMark({ size = "lg" }: { size?: "lg" | "sm" }) {
  const box = size === "lg" ? "h-11 w-11" : "h-10 w-10";
  const icon = size === "lg" ? "h-6 w-6" : "h-5 w-5";
  const text = size === "lg" ? "text-xl" : "text-2xl";
  return (
    <div className="flex items-center gap-3">
      <div
        className={`${box} rounded-xl flex items-center justify-center`}
        style={{ background: "linear-gradient(135deg,#bf5a36,#2f6e8f)" }}
      >
        <ChefHat className={`${icon} text-white`} />
      </div>
      <span className={`${text} font-semibold tracking-tight text-ink`}>CookingStudio</span>
    </div>
  );
}

const FEATURES = [
  { Icon: ChefHat, chip: "#f0dfd6", fg: "#bf5a36", title: "Cook along, step by step", desc: "Big text, photos, timers, what it should look like." },
  { Icon: Soup, chip: "#e6e8da", fg: "#5e6b4f", title: "Sauce School", desc: "Roux, reductions, emulsions — practise until it clicks." },
  { Icon: Timer, chip: "#dce8e6", fg: "#2f6e8f", title: "Cook together", desc: "Who does what, so both finish at the same time." },
  { Icon: ShoppingBasket, chip: "#f0dfd6", fg: "#bf5a36", title: "Shop by aisle", desc: "One merged list, pack sizes, what is already in stock." },
];

export default function AuthBrandPanel({
  eyebrow,
  title,
  titleAccent,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  titleAccent: string;
  subtitle: string;
}) {
  return (
    <aside
      className="relative hidden lg:flex lg:w-1/2 flex-col justify-between overflow-hidden p-12 border-r border-line"
      style={{ background: "linear-gradient(160deg,#f6f0e6 0%,#ece2d1 100%)" }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full" style={{ background: "radial-gradient(circle,rgba(191,90,54,0.10),transparent 70%)" }} />
        <div className="absolute -right-24 -bottom-24 h-[28rem] w-[28rem] rounded-full" style={{ background: "radial-gradient(circle,rgba(47,110,143,0.10),transparent 70%)" }} />
        <div className="absolute inset-0" style={{ opacity: 0.04, backgroundImage: "radial-gradient(rgba(33,28,21,0.9) 1px,transparent 1px)", backgroundSize: "22px 22px" }} />
      </div>

      <div className="relative">
        <AuthBrandMark size="lg" />
      </div>

      <div className="relative max-w-md">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">{eyebrow}</div>
        <h2 className="mt-4 font-display text-4xl font-bold leading-[1.12] text-ink">
          {title}
          <br />
          <span className="text-clay">{titleAccent}</span>
        </h2>
        <p className="mt-4 text-ink-soft leading-relaxed">{subtitle}</p>

        <ul className="mt-9 flex flex-col gap-4">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex gap-3.5">
              <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: f.chip }}>
                <f.Icon className="h-[18px] w-[18px]" style={{ color: f.fg }} />
              </span>
              <div>
                <div className="font-semibold leading-tight text-ink">{f.title}</div>
                <div className="text-sm leading-tight text-ink-muted">{f.desc}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative">
        <div className="h-px w-full bg-line" />
        <div className="mt-4 flex items-center gap-4 text-xs font-medium text-ink-muted">
          {[["#5e6b4f", "Runs locally"], ["#2f6e8f", "Whole household"], ["#bf5a36", "Your kitchen"]].map(([dot, label]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </aside>
  );
}

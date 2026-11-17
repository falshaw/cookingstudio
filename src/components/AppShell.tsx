"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  KeyRound,
  Menu,
  X,
  LayoutDashboard,
  Route,
  Soup,
  BookOpen,
  GraduationCap,
  Carrot,
  Refrigerator,
  CalendarDays,
  Boxes,
  ShoppingBasket,
  Sparkles,
  Link2,
  Recycle,
  History,
  HeartPulse,
  FileText,
  Activity,
  NotebookPen,
  Users,
  LogOut,
  ChefHat,
  Heart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MedicalFooter } from "./MedicalFooter";
import { TimerProvider, TimerTray } from "./Timers";

const NAV = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/path", label: "Skill path", icon: Route },
  { href: "/sauces", label: "Sauce School", icon: Soup },
  { href: "/recipes", label: "Recipes", icon: BookOpen },
  { href: "/favourites", label: "Favourites & taste", icon: Heart },
  { href: "/techniques", label: "Techniques", icon: GraduationCap },
  { href: "/ingredients", label: "Ingredients", icon: Carrot },
  { href: "/kitchen", label: "Kitchen & Stock", icon: Refrigerator },
  { href: "/plan", label: "Meal plan", icon: CalendarDays },
  { href: "/prep", label: "Meal prep", icon: Boxes },
  { href: "/shopping", label: "Shopping", icon: ShoppingBasket },
  { href: "/use-it-up", label: "Use it up", icon: Recycle },
  { href: "/teach", label: "Teach me", icon: Sparkles },
  { href: "/import", label: "Import recipe", icon: Link2 },
  { href: "/log", label: "Cooked log", icon: History },
  { href: "/health", label: "Health", icon: HeartPulse },
  { href: "/report", label: "Weekly report", icon: FileText },
  { href: "/glucose", label: "Glucose", icon: Activity },
  { href: "/food-log", label: "Food log", icon: NotebookPen },
  { href: "/profiles", label: "Profiles", icon: Users },
  { href: "/keys", label: "API keys", icon: KeyRound },
];

export function AppShell({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Below `md` the sidebar is a toggled drawer under a top bar. It used to be a fixed 230 px column
  // at every width, which left `main` ~150 px on a phone and squeezed /sale's line labels to 0 px.
  const [navOpen, setNavOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <TimerProvider>
    <div className="flex flex-col md:flex-row min-h-screen">
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b border-line bg-sand">
        <div className="flex items-center gap-2">
          <ChefHat className="text-clay-deep" size={22} />
          <span className="gradient-text text-lg">CookingStudio</span>
        </div>
        <button
          type="button"
          onClick={() => setNavOpen((o) => !o)}
          aria-expanded={navOpen}
          aria-controls="app-nav"
          aria-label={navOpen ? "Close menu" : "Open menu"}
          className="p-2 -mr-2 rounded-lg text-ink-soft hover:text-ink hover:bg-ink/[0.04]"
        >
          {navOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      <aside
        id="app-nav"
        className={cn(
          "border-line bg-sand flex-col md:flex md:w-[230px] md:shrink-0 md:border-r md:border-b-0 md:sticky md:top-0 md:h-screen md:overflow-y-auto",
          navOpen ? "flex border-b" : "hidden",
        )}
      >
        <div className="hidden md:block border-b border-line">
          <div className="neon-lanterns" aria-hidden><i /><i /><i /><i /><i /><i /><i /></div>
          <div className="flex items-center gap-2 px-5 pb-4">
            <ChefHat className="text-clay-deep" size={22} />
            <span className="gradient-text text-xl">CookingStudio</span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setNavOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  active
                    ? "neon-nav-active font-medium"
                    : "text-ink-soft hover:text-ink hover:bg-ink/[0.04]",
                )}
              >
                <Icon size={18} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-line">
          <p className="px-3 text-xs text-ink-muted truncate mb-2">{name}</p>
          <button
            onClick={logout}
            className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-ink-soft hover:text-ink hover:bg-ink/[0.04] transition-colors"
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto">{children}</main>
        <MedicalFooter className="pb-20" />
      </div>
      <TimerTray />
    </div>
    </TimerProvider>
  );
}

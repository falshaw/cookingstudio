import { describe, expect, it } from "vitest";
import { cookStreak, heroLabel, pickHeroMeal, ringOffset } from "@/lib/dashboard";

describe("neon dashboard helpers", () => {
  it("pickHeroMeal: the meal of this time of day (or the next open one); never breakfast in the evening", () => {
    const s = (meal: string, logged: boolean) => ({ meal, logged });
    const open = [s("dinner", false), s("breakfast", false), s("lunch", false)];
    expect(pickHeroMeal(open, 8)?.meal).toBe("breakfast");
    expect(pickHeroMeal(open, 12)?.meal).toBe("lunch");
    expect(pickHeroMeal(open, 18)?.meal).toBe("dinner"); // nothing logged all day → still dinner at 18:00
    expect(pickHeroMeal([s("dinner", false), s("breakfast", true), s("lunch", false)], 9)?.meal).toBe("lunch");
    expect(pickHeroMeal([s("dinner", true), s("breakfast", true), s("lunch", false)], 20)?.meal).toBe("lunch"); // dinner eaten, lunch still open
    expect(pickHeroMeal([s("breakfast", true), s("dinner", true)], 20)?.meal).toBe("dinner");
    expect(pickHeroMeal([], 12)).toBeNull();
  });
  it("heroLabel", () => {
    expect(heroLabel("dinner")).toBe("Tonight");
    expect(heroLabel("lunch")).toBe("Lunch today");
    expect(heroLabel("snack")).toBe("Today");
  });
  it("cookStreak: counts back from today, or from yesterday when today has no cook yet", () => {
    expect(cookStreak(["2026-11-15", "2026-11-14", "2026-11-13", "2026-11-11"], "2026-11-15")).toBe(3);
    expect(cookStreak(["2026-11-14", "2026-11-13"], "2026-11-15")).toBe(2);
    expect(cookStreak(["2026-11-12"], "2026-11-15")).toBe(0);
    expect(cookStreak(["2026-11-01", "2026-10-31"], "2026-11-01")).toBe(2); // month boundary
    expect(cookStreak([], "2026-11-15")).toBe(0);
  });
  it("ringOffset: empty → full, capped, full ring without a target", () => {
    expect(ringOffset(0, 2000)).toBe(327);
    expect(ringOffset(1000, 2000)).toBe(164);
    expect(ringOffset(2600, 2000)).toBe(0);
    expect(ringOffset(455, null)).toBe(0);
  });
});

// Optional household tuna cap (TUNA_MAX_PER_WEEK): off by default, enforced when set.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { checkWeekTuna, isTunaLine, isTunaMeal, tunaMaxPerWeek, type RuleLine } from "@/lib/rules";
import { tunaCount, tunaFits, type Candidate } from "@/lib/planner";

const line = (slug: string, o: Partial<RuleLine> = {}): RuleLine => ({ slug, nameEn: slug.replace(/-/g, " "), forUserId: null, grams: 150, isMeat: false, isFish: true, isOmega3: false, isAlcohol: false, isAddedSugar: false, isRefinedStarch: false, ...o });
const cand = (slug: string, lines: RuleLine[]): Candidate => ({ slug, lines } as unknown as Candidate);

afterEach(() => vi.unstubAllEnvs());

describe("tuna cap", () => {
  it("matches tinned tuna, not other fish", () => {
    expect(isTunaLine(line("tuna-tin", { nameEn: "Tinned tuna" }))).toBe(true);
    expect(isTunaLine(line("salmon-fillet"))).toBe(false);
    expect(isTunaMeal([line("lemon", { isFish: false }), line("tuna-tin", { forUserId: "alex" })])).toBe(true);
  });
  it("reads the cap from the environment, unset = no cap", () => {
    expect(tunaMaxPerWeek(undefined)).toBeNull();
    expect(tunaMaxPerWeek("")).toBeNull();
    expect(tunaMaxPerWeek("abc")).toBeNull();
    expect(tunaMaxPerWeek("4")).toBe(4);
    vi.stubEnv("TUNA_MAX_PER_WEEK", "3");
    expect(tunaMaxPerWeek()).toBe(3);
  });
  it("counts tuna meals and stops one over the cap", () => {
    const tuna = cand("tuna-salad", [line("tuna-tin")]);
    const chicken = cand("chicken", [line("chicken-breast", { isFish: false, isMeat: true })]);
    expect(tunaCount([{ slug: "tuna-salad" }, { slug: "chicken" }, { slug: "tuna-salad" }], [tuna, chicken])).toBe(2);
    expect(tunaFits(tuna, 1, 2)).toBe(true);
    expect(tunaFits(tuna, 2, 2)).toBe(false);
    expect(tunaFits(tuna, 9, null)).toBe(true);
    expect(tunaFits(chicken, 5, 2)).toBe(true);
  });
  it("week check fails only over a configured cap", () => {
    expect(checkWeekTuna(2, 2)).toEqual([]);
    expect(checkWeekTuna(3, 2)[0]).toMatchObject({ level: "fail", code: "tuna", msg: "3 tuna meals this week, max 2" });
    expect(checkWeekTuna(10, null)).toEqual([]);
  });
});

// Sauce rule for AI recipes: the "make the sauce" step + sauceLesson are checked in code.
import { describe, expect, it } from "vitest";
import { NO_SAUCE, needsSauce, pickSauceLesson, recipeSauceProblem, sauceIssues, sauceRuleText, sauceStepIndex, type LessonOption } from "@/lib/sauce-rule";

const step = (text: string, cue = "") => ({ text, cue });
const LESSONS = ["s1-pan-juices-cream", "s1-roasted-tomato-feta"];

describe("sauceStepIndex", () => {
  it("finds a step that makes a sauce: the word + an action + a done cue", () => {
    const steps = [step("Air-fry the chicken 15 minutes."), step("Make the sauce: press each tomato flat with a fork and stir in the feta until creamy.")];
    expect(sauceStepIndex(steps)).toBe(1);
  });
  it("accepts the done cue in the cue field", () => {
    expect(sauceStepIndex([step("Scrape the brown bits into the sauce with the cream.", "Bubble 2 min, coats a spoon")])).toBe(0);
  });
  it("does not count serving or mentioning a sauce as making one", () => {
    expect(sauceStepIndex([step("Spoon the sauce over the chicken and serve.")])).toBe(-1); // no making action
    expect(sauceStepIndex([step("Stir the sauce.")])).toBe(-1); // no done cue
    expect(sauceStepIndex([step("Bubble the juices 2 minutes until thick.")])).toBe(-1); // never says sauce
  });
});

describe("sauceIssues", () => {
  const good = { steps: [step("Scrape the pan, stir in the cream and bubble 2 minutes until the sauce coats the spoon.")], sauceLesson: "s1-pan-juices-cream" };
  it("passes a dish with a sauce step and a real lesson", () => {
    expect(sauceIssues(good, { lessonSlugs: LESSONS })).toBeNull();
  });
  it("rejects a missing step, a missing lesson and an unknown lesson — with the allowed list fed back", () => {
    expect(sauceIssues({ steps: [step("Air-fry 15 minutes.")], sauceLesson: "s1-pan-juices-cream" }, { lessonSlugs: LESSONS })).toMatch(/no "make the sauce" step/);
    expect(sauceIssues({ ...good, sauceLesson: "" }, { lessonSlugs: LESSONS })).toMatch(/sauceLesson is missing.*s1-pan-juices-cream, s1-roasted-tomato-feta/);
    expect(sauceIssues({ ...good, sauceLesson: "bechamel" }, { lessonSlugs: LESSONS })).toMatch(/"bechamel" is not a Sauce School lesson/);
  });
  it("a Sauce School lesson itself needs the step but no lesson link", () => {
    expect(sauceIssues({ ...good, sauceLesson: "" }, { lessonSlugs: LESSONS, isLesson: true })).toBeNull();
    expect(sauceIssues({ steps: [step("Chop the onion.")] }, { lessonSlugs: LESSONS, isLesson: true })).toMatch(/no "make the sauce" step/);
  });
  it("an empty lesson library skips only the link, never the step", () => {
    expect(sauceIssues({ ...good, sauceLesson: "" }, { lessonSlugs: [] })).toBeNull();
    expect(sauceIssues({ steps: [step("Grill 10 minutes.")] }, { lessonSlugs: [] })).not.toBeNull();
  });
  it("the prompt text lists the lessons and the fork-and-spoon wording", () => {
    const t = sauceRuleText([{ slug: "s1-lemon-butter", title: "Lemon butter" }]);
    expect(t).toContain("s1-lemon-butter (Lemon butter)");
    expect(t).toMatch(/scrape the brown bits/);
    expect(sauceRuleText([], true)).toContain('sauceLesson = ""');
  });
});

describe("check:sauce logic (recipeSauceProblem)", () => {
  const SAUCE = "Make the sauce: scrape the brown bits off the pan with 3 tbsp water and bubble 1 minute until slightly thick.";
  const rec = (over: Partial<Parameters<typeof recipeSauceProblem>[0]> = {}) => ({ slug: "x", kind: "plan", sauceFamily: null, sauceLesson: "s1-pan-juices-cream", steps: [step("Fry the chicken in a pan 6 minutes."), step(SAUCE)], ...over });
  it("passes a dish with a sauce step and a published lesson link", () => {
    expect(recipeSauceProblem(rec(), LESSONS)).toBeNull();
  });
  it("fails a pan dish that ends with the juices left in the pan, and one without a lesson", () => {
    expect(recipeSauceProblem(rec({ steps: [step("Fry the chicken in a pan 6 minutes.")] }), LESSONS)).toMatch(/no "make the sauce" step/);
    expect(recipeSauceProblem(rec({ sauceLesson: null }), LESSONS)).toMatch(/sauceLesson is missing/);
  });
  it("skips lessons, exempt dishes and dishes with nothing to turn into a sauce", () => {
    expect(recipeSauceProblem(rec({ kind: "lesson", steps: [] }), LESSONS)).toBeNull();
    expect(recipeSauceProblem(rec({ slug: "tomato-scrambled-eggs", steps: [step("Soften the tomatoes in butter.")] }), LESSONS)).toBeNull();
    expect(NO_SAUCE["tomato-scrambled-eggs"]).toBeTruthy();
    expect(recipeSauceProblem(rec({ sauceLesson: null, steps: [step("Blend the berries with water 60 seconds.")] }), LESSONS)).toBeNull();
  });
  it("a plan recipe with a sauceFamily (Thai curry) is a lesson itself: step only", () => {
    expect(recipeSauceProblem(rec({ sauceFamily: "curry", sauceLesson: null }), LESSONS)).toBeNull();
    expect(recipeSauceProblem(rec({ sauceFamily: "curry", steps: [step("Fry the paste in the pan.")] }), LESSONS)).toMatch(/no "make the sauce"/);
  });
  it("needsSauce triggers on juices, roast, tomatoes, cheese, cream, feta, pan", () => {
    for (const w of ["pour the juices", "roasted peppers", "cherry tomatoes", "melted cheese", "the cream", "feta on top", "the same pan"]) expect(needsSauce([step(w)])).toBe(true);
    expect(needsSauce([step("Boil the eggs 9 minutes.")])).toBe(false);
  });
});

describe("pickSauceLesson (dislike-aware link)", () => {
  const L = (slug: string, sauceFamily: string | null, level: number, ingredientIds: string[]): LessonOption => ({ slug, title: slug, sauceFamily, level, ingredientIds });
  const mother = [L("bechamel", "mother", 3, ["butter", "flour", "milk", "nutmeg"]), L("espagnole", "mother", 6, ["butter", "flour", "tomato-paste", "beef-stock"]), L("veloute", "mother", 4, ["butter", "flour", "chicken-stock"]), L("cheese-sauce", "mother", 4, ["butter", "flour", "milk", "cheese"])];
  const mustardEggs = ["egg", "butter", "flour", "chicken-stock", "cream", "mustard"];
  it("keeps the linked lesson when the viewer did not dislike it", () => {
    expect(pickSauceLesson("bechamel", mother, new Set(), mustardEggs)?.slug).toBe("bechamel");
  });
  it("falls back to the liked lesson of the same family that shares most of the dish's ingredients", () => {
    expect(pickSauceLesson("bechamel", mother, new Set(["bechamel", "cheese-sauce"]), mustardEggs)?.slug).toBe("veloute");
  });
  it("ties go to the lower level, then slug", () => {
    expect(pickSauceLesson("bechamel", mother, new Set(["bechamel", "cheese-sauce"]), ["egg"])?.slug).toBe("veloute");
  });
  it("never crosses families and shows no link when every lesson of the family is disliked", () => {
    const pool = [...mother, L("s1-mustard-cream", "quick", 1, mustardEggs)];
    expect(pickSauceLesson("bechamel", pool, new Set(mother.map((m) => m.slug)), mustardEggs)).toBeNull();
  });
  it("no link for a missing or unpublished lesson", () => {
    expect(pickSauceLesson(null, mother, new Set(), mustardEggs)).toBeNull();
    expect(pickSauceLesson("maggi-fix", mother, new Set(), mustardEggs)).toBeNull();
  });
});

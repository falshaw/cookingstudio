import { describe, expect, it } from "vitest";
import { LabExtract, PlanDraft, RecipeDraft, jsonSchemaOf, parseModelJson } from "@/lib/llm-schema";

const good = {
  title: "Avgolemono soup",
    servings: 4,
  prepMinutes: 10,
  cookMinutes: 30,
  ingredients: [{ name: "Chicken stock", grams: 1500, qty: 1.5, unit: "l", prep: "", component: "both" }],
  steps: [{ text: "Bring the stock to a simmer.", why: "Hot stock tempers the eggs.", cue: "Small bubbles", mistake: "Boiling", who: "either", minutes: 5, technique: "stock", timerSeconds: 0, imagePrompt: "pot of stock" }],
};

describe("LLM JSON validation", () => {
  it("accepts a valid recipe and fills defaults", () => {
    const r = parseModelJson(RecipeDraft, JSON.stringify(good));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.equipment).toEqual([]);
      expect(r.data.fridgeDays).toBe(2);
    }
  });
  it("extracts JSON wrapped in prose / code fences", () => {
    expect(parseModelJson(RecipeDraft, "Here you go:\n```json\n" + JSON.stringify(good) + "\n```").ok).toBe(true);
  });
  it("rejects invalid JSON with a readable error", () => {
    const r = parseModelJson(RecipeDraft, "{not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not valid JSON/);
  });
  it("rejects wrong types and lists the path", () => {
    const bad = { ...good, servings: "four", steps: [{ ...good.steps[0], who: "chef" }] };
    const r = parseModelJson(RecipeDraft, JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("servings");
      expect(r.error).toContain("steps.0.who");
    }
  });
  it("rejects negative grams and an empty ingredient list", () => {
    expect(parseModelJson(RecipeDraft, JSON.stringify({ ...good, ingredients: [] })).ok).toBe(false);
    expect(parseModelJson(RecipeDraft, JSON.stringify({ ...good, ingredients: [{ ...good.ingredients[0], grams: -5 }] })).ok).toBe(false);
  });
  it("plan needs exactly 7 days", () => {
    const day = { breakfast: "a", lunch: "b", dinner: "c" };
    expect(PlanDraft.safeParse({ days: Array(7).fill(day) }).success).toBe(true);
    expect(PlanDraft.safeParse({ days: Array(6).fill(day) }).success).toBe(false);
  });
  it("lab extract keeps nulls and rejects non-ISO dates", () => {
    expect(LabExtract.safeParse({ results: [{ marker: "HbA1c", value: 5.5, unit: "%", refLow: 4, refHigh: 6, date: "2026-04-15" }] }).success).toBe(true);
    expect(LabExtract.safeParse({ results: [{ marker: "LDL", value: null, unit: "", refLow: null, refHigh: null, date: "15.04.2026" }] }).success).toBe(false);
  });
  it("produces a JSON schema for Ollama's format field", () => {
    const s = jsonSchemaOf(RecipeDraft) as { type?: string; properties?: Record<string, unknown> };
    expect(s.type).toBe("object");
    expect(Object.keys(s.properties ?? {})).toContain("steps");
  });
});

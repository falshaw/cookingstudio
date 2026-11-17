// Health trackers are private: the job API never hands one person's report,
// photo or lab-PDF job to the other, and a report is always the caller's own.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePrisma, type Overrides } from "./helpers/fake-prisma";

const ALEX = { id: "calex00000000000000000000001", slug: "alex", name: "Alex", email: "n@k" };
const SAM = { id: "csam000000000000000000001", slug: "sam", name: "Sam", email: "a@k" };
const h = vi.hoisted(() => ({ overrides: {} as Overrides, me: null as null | { id: string; slug: string; name: string; email: string }, created: [] as unknown[] }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return makePrisma(h.overrides).client;
  },
}));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(async () => h.me) }));
vi.mock("@/lib/ollama", () => ({ ollamaUp: vi.fn(async () => true) }));

const { GET } = await import("@/app/api/jobs/[id]/route");
const { POST } = await import("@/app/api/jobs/route");

const JOB_ID = "cjob00000000000000000000001";
const job = (type: string, userId: string, input: Record<string, unknown> = {}) => ({ id: JOB_ID, type, status: "done", log: "", result: { ok: 1 }, error: null, createdAt: new Date(), updatedAt: new Date(), userId, input });
const get = (id = JOB_ID) => GET(new Request(`http://127.0.0.1:3030/api/jobs/${id}`), { params: Promise.resolve({ id }) });
const post = (body: unknown) => POST(new Request("http://127.0.0.1:3030/api/jobs", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  h.me = SAM;
  h.created.length = 0;
  h.overrides = { job: { create: async (a: { data: Record<string, unknown> }) => (h.created.push(a.data), { id: JOB_ID, ...a.data }) } };
});
const withJob = (row: ReturnType<typeof job>) => (h.overrides = { job: { findUnique: async () => row } });

describe("GET /api/jobs/[id]: owner-only for health jobs", () => {
  it("401 without a session, 400 on a bad id, 404 on a missing job", async () => {
    h.me = null;
    expect((await get()).status).toBe(401);
    h.me = SAM;
    expect((await get("nope")).status).toBe(400);
    expect((await get()).status).toBe(404);
  });
  it("404 for the partner's report, photo and lab-pdf jobs", async () => {
    for (const t of ["report", "photo", "lab-pdf"]) {
      withJob(job(t, ALEX.id, t === "report" ? { userId: ALEX.id } : { importId: "cimp" }));
      const r = await get();
      expect(r.status, t).toBe(404);
      expect(await r.json()).toEqual({ error: "not found" });
    }
  });
  it("404 for an old report about me that the partner started", async () => {
    withJob(job("report", ALEX.id, { userId: SAM.id }));
    expect((await get()).status).toBe(404);
  });
  it("returns my own health job without userId or input", async () => {
    withJob(job("photo", SAM.id, { image: "aGVsbG8=" }));
    const r = await get();
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.result).toEqual({ ok: 1 });
    expect(j).not.toHaveProperty("userId");
    expect(j).not.toHaveProperty("input");
  });
  it("any type outside the shared allowlist is owner-only by default (a new type is private)", async () => {
    withJob(job("x-new", ALEX.id, { secret: "health" }));
    const r = await get();
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not found" });
    h.me = ALEX;
    const own = await get();
    expect(own.status).toBe(200);
    const j = await own.json();
    expect(j).not.toHaveProperty("userId");
    expect(j).not.toHaveProperty("input");
  });
  it("shared kitchen jobs (teach, plan, feed) stay readable by both, still without userId", async () => {
    for (const t of ["teach", "plan", "feed", "import-url", "cards"]) {
      withJob(job(t, ALEX.id));
      const r = await get();
      expect(r.status, t).toBe(200);
      expect(await r.json(), t).not.toHaveProperty("userId");
    }
  });
});

describe("POST /api/jobs report: always the caller's own", () => {
  it("queues the report for the signed-in user", async () => {
    const r = await post({ type: "report" });
    expect(r.status).toBe(200);
    expect(h.created).toEqual([{ userId: SAM.id, type: "report", input: { userId: SAM.id } }]);
  });
  it("ignores a who field — no way to target the partner", async () => {
    await post({ type: "report", who: "alex" });
    expect(h.created).toEqual([{ userId: SAM.id, type: "report", input: { userId: SAM.id } }]);
  });
});

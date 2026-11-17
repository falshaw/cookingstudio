// Picture painting is opt-in (IMAGE_GENERATION=on). Off (the default): the worker never claims a queued
// picture, never counts an attempt and sends no request at all to ComfyUI — text jobs still run.
// On: the next queued picture is rendered and marked done.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makePrisma, type Overrides } from "./helpers/fake-prisma";

const h = vi.hoisted(() => ({ overrides: {} as Overrides, calls: [] as { model: string; method: string; args: unknown }[] }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    const p = makePrisma(h.overrides);
    p.calls.push = (...c) => h.calls.push(...c);
    return p.client;
  },
}));
const render = vi.hoisted(() => vi.fn(async (id: string) => `${id}.png`));
vi.mock("@/lib/comfyui", async (orig) => ({ ...(await orig<typeof import("@/lib/comfyui")>()), renderToFile: render }));
vi.mock("@/lib/feed", async (orig) => ({ ...(await orig<typeof import("@/lib/feed")>()), maybeScheduleFeed: vi.fn(async () => undefined) }));

let server: http.Server;
let comfyHits: string[] = [];
const QUEUED = { id: "cimg0000000000000000000001", kind: "hero", prompt: "a bowl of soup", status: "queued", attempts: 0 };

beforeAll(async () => {
  server = http.createServer((req, res) => (comfyHits.push(String(req.url)), res.end("{}")));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  process.env.COMFYUI_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  delete process.env.IMAGE_GENERATION;
  return new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  comfyHits = [];
  h.calls.length = 0;
  render.mockClear();
  h.overrides = { image: { findFirst: async () => QUEUED, updateMany: async () => ({ count: 1 }) } };
  vi.resetModules();
});
const imageCalls = () => h.calls.filter((c) => c.model === "image").map((c) => c.method);

describe("IMAGE_GENERATION", () => {
  it.each([undefined, "off", "true"])("is off for %s: no picture claimed, nothing reaches ComfyUI", async (v) => {
    if (v === undefined) delete process.env.IMAGE_GENERATION;
    else process.env.IMAGE_GENERATION = v;
    const { tick } = await import("@/lib/worker");
    for (let i = 0; i < 3; i++) expect(await tick()).toBe(false);
    expect(imageCalls()).toEqual([]);
    expect(render).not.toHaveBeenCalled();
    expect(comfyHits).toEqual([]);
  });
  it("off: text jobs still run (and still touch no ComfyUI endpoint)", async () => {
    delete process.env.IMAGE_GENERATION;
    h.overrides.job = { findFirst: async () => ({ id: "cjob00000000000000000000001", type: "bogus", userId: "u", input: {} }), updateMany: async () => ({ count: 1 }) };
    const { tick } = await import("@/lib/worker");
    expect(await tick()).toBe(true);
    expect(h.calls.some((c) => c.model === "job" && c.method === "update" && (c.args as { data: { status: string } }).data.status === "failed")).toBe(true);
    expect(comfyHits).toEqual([]);
    expect(imageCalls()).toEqual([]);
  });
  it("on: the next queued picture is rendered and marked done", async () => {
    process.env.IMAGE_GENERATION = "on";
    const { tick } = await import("@/lib/worker");
    expect(await tick()).toBe(true);
    expect(render).toHaveBeenCalledWith(QUEUED.id, QUEUED.prompt, { width: 1024, height: 768 }, "hero");
    expect(imageCalls()).toEqual(["findFirst", "updateMany", "update"]);
    const done = h.calls.find((c) => c.model === "image" && c.method === "update")!.args as { data: { status: string; file: string } };
    expect(done.data).toMatchObject({ status: "done", file: `${QUEUED.id}.png` });
  });
});

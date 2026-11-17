// Network / IO helpers: node-http NDJSON client, SSRF guard, Ollama client, ComfyUI client,
// logger, API helpers, rate limiter, utils.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeNetError, getPublicPage, isBlockedIp, postNdjson } from "@/lib/http";
import { htmlToText } from "@/lib/fetch-page";
import { startFakeOllama, type FakeOllama } from "./helpers/fake-ollama";
import { CUID, isCuid, publicError, uploadTooLarge } from "@/lib/api";
import { enforce, rateLimit, clientIp } from "@/lib/ratelimit";
import { fmtMinutes, fmtQty, isoDate, serverNow, slugify, weekStart } from "@/lib/utils";
import { log, logError, requestIdOf } from "@/lib/log";

describe("SSRF guard", () => {
  it("blocks loopback, private (172.16/12 = Docker), link-local and CGNAT; allows Cloudflare 172.64/13", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.5", "169.254.169.254", "100.64.0.1", "172.16.0.1", "172.20.0.10", "172.31.255.1", "172.17.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "224.0.0.1"]) expect(isBlockedIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "151.101.1.69", "172.64.0.10", "172.67.1.1", "172.15.0.1", "172.32.0.1", "2a00:1450:4001::1"]) expect(isBlockedIp(ip), ip).toBe(false);
  });
  it("blocks IPv4 smuggled inside IPv6: NAT64, 6to4 and the IPv4-compatible ::a.b.c.d form", () => {
    for (const ip of ["64:ff9b::808:808", "64:ff9b::7f00:1", "64:ff9b:1::a00:1", "2002:c0a8:101::", "2002:808:808::1", "::127.0.0.1", "::10.0.0.1", "::192.168.1.50", "::172.20.0.10", "::0.0.0.0"]) expect(isBlockedIp(ip), ip).toBe(true);
    // the IPv4-compatible form is judged by its embedded IPv4, like ::ffff:
    expect(isBlockedIp("::8.8.8.8")).toBe(false);
  });
  it("blocks special-purpose IPv4 ranges and the remaining IPv6 forms", () => {
    const blocked = [
      "198.18.0.1", "198.19.255.254", "192.0.0.8", "192.0.0.170", "192.0.2.1", "198.51.100.7", "203.0.113.9", // benchmarking, IETF, TEST-NETs
      "100.127.255.255", "0.1.2.3", "240.0.0.1", "255.255.255.255", // CGNAT edge, 0/8, reserved, broadcast
      "fc00::1", "fdff::1", "febf::1", "fec0::1", "ff02::1", // ULA, link-local, site-local, multicast
      "::ffff:7f00:1", "::ffff:a00:1", "::ffff:c0a8:101", "::ffff:10.0.0.1", // IPv4-mapped, hex and dotted
      "2001:0:4136:e378::1", "2001:db8::1", "::", // Teredo, documentation, unspecified
    ];
    for (const ip of blocked) expect(isBlockedIp(ip), ip).toBe(true);
    for (const ip of ["198.17.255.255", "198.20.0.1", "192.0.1.1", "100.63.255.255", "100.128.0.1", "223.255.255.254", "::ffff:808:808", "2606:4700::1111"]) expect(isBlockedIp(ip), ip).toBe(false);
    expect(isBlockedIp("not-an-ip")).toBe(true);
  });
  it("refuses bracketed IPv6 literals in URLs", async () => {
    await expect(getPublicPage("http://[::1]/")).rejects.toThrow(/private|loopback/);
    await expect(getPublicPage("http://[::ffff:127.0.0.1]/")).rejects.toThrow(/private|loopback/);
  });
  it("refuses private targets, bad schemes and credentials before connecting", async () => {
    await expect(getPublicPage("http://127.0.0.1:3030/")).rejects.toThrow(/private|loopback/);
    await expect(getPublicPage("http://localhost/")).rejects.toThrow(/private|loopback/);
    await expect(getPublicPage("ftp://example.com/")).rejects.toThrow(/only http/);
    await expect(getPublicPage("https://user:pw@example.com/")).rejects.toThrow(/credentials/);
    await expect(getPublicPage("not a url")).rejects.toThrow(/valid URL/);
  });
  it("strips HTML and prefers schema.org Recipe JSON-LD", () => {
    expect(htmlToText('<html><script type="application/ld+json">{"@type":"Recipe","name":"X"}</script><p>story</p></html>')).toMatch(/^STRUCTURED RECIPE DATA/);
    expect(htmlToText("<nav>menu</nav><p>Fry &amp; stir</p><script>x()</script>")).toBe("Fry & stir");
  });
  it("describes socket errors in plain words", () => {
    expect(describeNetError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }), "Ollama")).toMatch(/not running/);
    expect(describeNetError(new Error("terminated"), "Ollama")).toMatch(/dropped the connection/);
    expect(describeNetError(Object.assign(new Error("t"), { code: "ETIMEDOUT" }), "Ollama")).toMatch(/timed out/);
    expect(describeNetError(new Error(""), "Ollama")).toMatch(/Ollama: Error/);
  });
});

describe("postNdjson", () => {
  let server: http.Server;
  let url = "";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/fail") {
        res.writeHead(500);
        return res.end("boom");
      }
      if (req.url === "/hang") return; // never answers
      if (req.url === "/abort") {
        res.writeHead(200);
        res.write('{"response":"a"}\n');
        return setTimeout(() => res.destroy(), 20);
      }
      res.writeHead(200);
      res.write('{"n":1}\n{"n":2}\n');
      res.end('{"n":3}');
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  it("streams every line including an unterminated last one", async () => {
    const lines: string[] = [];
    await postNdjson(`${url}/ok`, {}, 5000, (l) => lines.push(l));
    expect(lines).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
  });
  it("rejects HTTP errors with the status", async () => {
    await expect(postNdjson(`${url}/fail`, {}, 5000, () => {})).rejects.toMatchObject({ status: 500 });
  });
  it("applies one overall timeout", async () => {
    await expect(postNdjson(`${url}/hang`, {}, 100, () => {})).rejects.toMatchObject({ code: "ETIMEDOUT" });
  });
  it("reports a dropped connection", async () => {
    await expect(postNdjson(`${url}/abort`, {}, 5000, () => {})).rejects.toBeTruthy();
  });
});

describe("Ollama client", () => {
  let fake: FakeOllama;
  let mod: typeof import("@/lib/ollama");
  beforeAll(async () => {
    fake = await startFakeOllama();
    process.env.OLLAMA_URL = fake.url;
    vi.resetModules();
    mod = await import("@/lib/ollama");
  });
  afterAll(() => fake.close());
  it("detects a running Ollama", async () => {
    expect(await mod.ollamaUp()).toBe(true);
  });
  it("accepts only the local Ollama hosts (health-data rule)", () => {
    for (const u of ["http://host.docker.internal:11434", "http://127.0.0.1:11434/", "http://localhost:11434", "https://localhost"]) expect(() => mod.localAiUrl(u), u).not.toThrow();
    expect(mod.localAiUrl("http://127.0.0.1:11434//")).toBe("http://127.0.0.1:11434");
    for (const u of ["http://evil.example:11434", "http://192.168.1.60:11434", "http://127.0.0.1.evil.example", "http://user@evil.example", "ftp://localhost", "file:///etc/passwd", "not a url", ""]) {
      expect(() => mod.localAiUrl(u), u).toThrow(/health data may only go to the local Ollama/);
    }
  });
  it("refuses a non-local OLLAMA_URL before sending anything (text, vision and status check)", async () => {
    const before = fake.requests.length;
    process.env.OLLAMA_URL = "http://ollama.example.com:11434";
    vi.resetModules();
    const bad = await import("@/lib/ollama");
    try {
      const { z } = await import("zod");
      await expect(bad.ollamaUp()).rejects.toThrow(/OLLAMA_URL refused/);
      await expect(bad.ollamaJson("p", "s", z.object({}))).rejects.toThrow(/health data/);
      await expect(bad.ollamaVisionJson("p", "aGVsbG8=", z.object({}))).rejects.toThrow(/health data/);
      await expect(bad.unloadTextModel()).resolves.toBeUndefined();
      expect(fake.requests.length).toBe(before);
    } finally {
      process.env.OLLAMA_URL = fake.url;
      vi.resetModules();
    }
  });
  it("sends images to the vision model on /api/chat", async () => {
    fake.queue.push('{"items":[{"name":"egg","grams":100}]}');
    const { z } = await import("zod");
    const out = await mod.ollamaVisionJson("what is this?", "aGVsbG8=", z.object({ items: z.array(z.object({ name: z.string(), grams: z.number() })) }));
    expect(JSON.parse(out).items[0].name).toBe("egg");
    const req = fake.requests[fake.requests.length - 1];
    expect(req.path).toBe("/api/chat");
    expect(req.body.model).toBe("qwen2.5vl:7b");
    expect((req.body.messages as { images: string[] }[])[0].images[0]).toBe("aGVsbG8=");
  });
  it("turns HTTP errors and empty answers into readable errors", async () => {
    const { z } = await import("zod");
    fake.queue.push({ status: 404 });
    await expect(mod.ollamaJson("p", "s", z.object({}))).rejects.toThrow(/Ollama/);
    fake.queue.push("");
    await expect(mod.ollamaJson("p", "s", z.object({}))).rejects.toThrow(/empty answer/);
  });
  it("unloads the text model without throwing", async () => {
    await expect(mod.unloadTextModel()).resolves.toBeUndefined();
    expect(fake.requests.some((r) => r.body.keep_alive === 0)).toBe(true);
  });
  it("refuses any provider other than ollama", async () => {
    process.env.LLM_PROVIDER = "claude";
    const { z } = await import("zod");
    await expect(mod.ollamaJson("p", "s", z.object({}))).rejects.toThrow(/local Ollama only/);
    process.env.LLM_PROVIDER = "ollama";
  });
});

describe("ComfyUI client", () => {
  let server: http.Server;
  let dir = "";
  let posted: Record<string, unknown> | null = null;
  let kleinOn = false;
  const list = (node: string, field: string, items: string[]) => JSON.stringify({ [node]: { input: { required: { [field]: [items] } } } });
  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "kitchen-img-"));
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (kleinOn && req.url === "/object_info/UnetLoaderGGUF") return res.end(list("UnetLoaderGGUF", "unet_name", ["flux-2-klein-4b-Q5_K_M.gguf"]));
        if (kleinOn && req.url === "/object_info/CLIPLoader") return res.end(list("CLIPLoader", "clip_name", ["qwen_3_4b.safetensors"]));
        if (kleinOn && req.url === "/object_info/VAELoader") return res.end(list("VAELoader", "vae_name", ["flux2-vae.safetensors"]));
        if (req.url?.startsWith("/object_info/CheckpointLoaderSimple")) return res.end(JSON.stringify({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [["sdxl.safetensors", "flux1-schnell-fp8.safetensors"]] } } } }));
        if (req.url === "/prompt") {
          posted = JSON.parse(body);
          return res.end(JSON.stringify({ prompt_id: "p1" }));
        }
        if (req.url === "/history/p1") return res.end(JSON.stringify({ p1: { outputs: { "9": { images: [{ filename: "kitchen_1.png", subfolder: "", type: "output" }] } } } }));
        if (req.url?.startsWith("/view")) return res.end(Buffer.from([137, 80, 78, 71]));
        if (req.url === "/free") return res.end("{}");
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    process.env.COMFYUI_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.IMAGES_DIR = dir;
    process.env.IMAGE_GENERATION = "on";
  });
  afterAll(() => {
    delete process.env.IMAGE_GENERATION;
    return new Promise<void>((r) => server.close(() => r()));
  });
  it("sends nothing to ComfyUI while IMAGE_GENERATION is not on", async () => {
    for (const v of [undefined, "off", "yes"]) {
      if (v === undefined) delete process.env.IMAGE_GENERATION;
      else process.env.IMAGE_GENERATION = v;
      vi.resetModules();
      const c = await import("@/lib/comfyui");
      posted = null;
      expect(c.imageGenerationOn()).toBe(false);
      await expect(c.renderToFile("cimg0000000000000000000009", "a pan of onions")).rejects.toThrow(/IMAGE_GENERATION=on/);
      await expect(c.releaseComfyMemory()).resolves.toBeUndefined();
      expect(posted).toBeNull();
    }
    process.env.IMAGE_GENERATION = "on";
  });
  it("prefers the FLUX checkpoint, renders, and writes the PNG to the images volume", async () => {
    vi.resetModules();
    const c = await import("@/lib/comfyui");
    const file = await c.renderToFile("cimg0000000000000000000001", "a pan of onions", { width: 768, height: 768 });
    expect(file).toBe("cimg0000000000000000000001.png");
    expect(readFileSync(path.join(dir, file)).subarray(0, 4)).toEqual(Buffer.from([137, 80, 78, 71]));
    const wf = (posted as { prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> }).prompt;
    expect(wf["4"].inputs.ckpt_name).toBe("flux1-schnell-fp8.safetensors");
    expect(wf["5"].class_type).toBe("EmptySD3LatentImage");
    expect(String(wf["6"].inputs.text)).toContain("photo-realistic");
    await expect(c.releaseComfyMemory()).resolves.toBeUndefined();
  }, 20_000);
  it("renders with FLUX.2 klein when ComfyUI lists its unet, text encoder and VAE", async () => {
    kleinOn = true;
    try {
      vi.resetModules();
      const c = await import("@/lib/comfyui");
      await c.renderToFile("cimg0000000000000000000002", "a pan of onions", { width: 1000, height: 750 });
      const wf = (posted as { prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> }).prompt;
      expect(wf.m).toEqual({ class_type: "UnetLoaderGGUF", inputs: { unet_name: "flux-2-klein-4b-Q5_K_M.gguf" } });
      expect(wf.c.inputs).toMatchObject({ clip_name: "qwen_3_4b.safetensors", type: "flux2" });
      expect(wf.v.inputs).toMatchObject({ vae_name: "flux2-vae.safetensors" });
      expect(wf.sig.inputs).toMatchObject({ steps: 4, width: 1008, height: 752 });
      expect(wf.guid.inputs).toMatchObject({ cfg: 1 });
      expect(wf.neg.class_type).toBe("ConditioningZeroOut");
      expect(String(wf.pos.inputs.text)).toContain("photo-realistic");
      expect(wf["4"]).toBeUndefined();
    } finally {
      kleinOn = false;
    }
  }, 20_000);
  it("keeps the checkpoint path when COMFYUI_MODEL pins a model, even with klein installed", async () => {
    kleinOn = true;
    process.env.COMFYUI_MODEL = "flux1-schnell-fp8.safetensors";
    try {
      vi.resetModules();
      const c = await import("@/lib/comfyui");
      await c.renderToFile("cimg0000000000000000000003", "a pan of onions");
      const wf = (posted as { prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> }).prompt;
      expect(wf["4"].inputs.ckpt_name).toBe("flux1-schnell-fp8.safetensors");
    } finally {
      kleinOn = false;
      delete process.env.COMFYUI_MODEL;
    }
  }, 20_000);
  it("builds an SDXL workflow for non-FLUX models", async () => {
    const c = await import("@/lib/comfyui");
    const wf = c.buildWorkflow({ model: "sdxl.safetensors", prompt: "x", seed: 1, width: 512, height: 512 }) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    expect(wf["5"].class_type).toBe("EmptyLatentImage");
    expect(wf["3"].inputs.steps).toBe(25);
    expect(c.fullPrompt("onions.")).toMatch(/^onions\. photo-realistic/);
    // per-kind food-styling line: heroes get the plating rules, steps/ingredients do not
    expect(c.fullPrompt("kofta", "hero")).toMatch(/one single plate.*odd numbers.*no other dishes/);
    expect(c.fullPrompt("frying onions", "step")).toMatch(/cooking step in progress/);
    expect(c.fullPrompt("frying onions", "step")).not.toMatch(/single plate/);
    expect(c.fullPrompt("onions", "ingredient")).toMatch(/single ingredient centred/);
    expect(c.fullPrompt("onions", "unknown-kind")).toBe(c.fullPrompt("onions"));
  });
});

describe("API helpers, logger, rate limit, utils", () => {
  it("guards uploads before buffering", () => {
    const mk = (len?: string) => new Request("http://x/", { method: "POST", headers: len ? { "content-length": len } : {} });
    expect(uploadTooLarge(mk(), 100)?.status).toBe(411);
    expect(uploadTooLarge(mk("101"), 100)?.status).toBe(413);
    expect(uploadTooLarge(mk("100"), 100)).toBeNull();
  });
  it("validates cuids and hides internal error text", () => {
    expect(isCuid("cmvfb2wa30000vcbxgx35q6uv")).toBe(true);
    expect(isCuid("../../etc/passwd")).toBe(false);
    expect(CUID.test("c123")).toBe(false);
    expect(publicError(new Error("Invalid `prisma.recipe.findMany()` invocation"))).toMatch(/server log/);
    expect(publicError(new Error("recipe not found"))).toBe("recipe not found");
    expect(publicError("x")).toMatch(/server log/);
  });
  it("writes one JSON line per event with the request id", () => {
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => (out.push(String(s)), true));
    const spyErr = vi.spyOn(process.stderr, "write").mockImplementation((s: string | Uint8Array) => (out.push(String(s)), true));
    log("info", "hello", { requestId: "r1", n: 2 });
    logError("bad", { err: new Error("boom") });
    spy.mockRestore();
    spyErr.mockRestore();
    const a = JSON.parse(out[0]);
    expect(a).toMatchObject({ level: "info", msg: "hello", requestId: "r1", n: 2, app: "cookingstudio" });
    expect(JSON.parse(out[1])).toMatchObject({ level: "error", error: "boom" });
    expect(requestIdOf(new Request("http://x", { headers: { "x-request-id": "abc" } }))).toBe("abc");
  });
  it("rate-limits per key and window", () => {
    expect(rateLimit("t:a", 2, 60_000).ok).toBe(true);
    expect(rateLimit("t:a", 2, 60_000).ok).toBe(true);
    expect(rateLimit("t:a", 2, 60_000).ok).toBe(false);
    enforce("t:b", 1, 60_000);
    expect(enforce("t:b", 1, 60_000)?.status).toBe(429);
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4" }))).toBe("local");
  });
  it("keys on the first X-Forwarded-For entry only when TRUST_PROXY=1", () => {
    process.env.TRUST_PROXY = "1";
    try {
      expect(clientIp(new Headers({ "x-forwarded-for": "192.168.1.20" }))).toBe("192.168.1.20");
      expect(clientIp(new Headers({ "x-forwarded-for": " 192.168.1.21 , 10.0.0.1, 1.1.1.1" }))).toBe("192.168.1.21");
      // cf-connecting-ip is never trusted (lan-proxy strips it; nothing else sets it)
      expect(clientIp(new Headers({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "192.168.1.22" }))).toBe("192.168.1.22");
      expect(clientIp(new Headers({ "cf-connecting-ip": "9.9.9.9" }))).toBe("local");
      expect(clientIp(new Headers())).toBe("local");
      expect(clientIp(new Headers({ "x-forwarded-for": "" }))).toBe("local");
    } finally {
      delete process.env.TRUST_PROXY;
    }
  });
  it("formats quantities, minutes, slugs and weeks", () => {
    expect(fmtQty(0.3)).toBe("0.25");
    expect(fmtQty(12.4)).toBe("12");
    expect(fmtQty(153)).toBe("155");
    expect(fmtMinutes(45)).toBe("45 min");
    expect(fmtMinutes(90)).toBe("1 h 30 min");
    expect(fmtMinutes(120)).toBe("2 h");
    expect(slugify("Béchamel & Mornay!")).toBe("bechamel-mornay");
    expect(isoDate(weekStart(new Date("2026-10-22T10:00:00Z")))).toBe("2026-10-19");
    expect(serverNow()).toBeGreaterThan(0);
  });
});

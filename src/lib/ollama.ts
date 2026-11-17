// Local Ollama at OLLAMA_URL (127.0.0.1:11434 on the host → host.docker.internal from the container).
// Text model OLLAMA_MODEL, vision model (photo food log, lab PDFs) OLLAMA_VISION_MODEL.
// Streams over node:http (see http.ts) — undici's 300 s headers timeout broke slow first tokens.
// DATA RULE: health data may reach this LOCAL model; never any external service.
import { z } from "zod";
import { jsonSchemaOf, parseModelJson } from "./llm-schema";
import { describeNetError, postNdjson } from "./http";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://host.docker.internal:11434";
const LOCAL_AI_HOSTS = new Set(["host.docker.internal", "127.0.0.1", "localhost"]);

/**
 * DATA RULE guard: every Ollama call (text AND vision — lab-PDF text, food photos, report
 * numbers) goes to OLLAMA_URL, so a mis-set env var would ship health data off this PC. Refuse
 * any host other than the local Ollama before a single byte is sent.
 */
export function localAiUrl(raw: string, name = "OLLAMA_URL"): string {
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    /* refused below */
  }
  if (!url || !["http:", "https:"].includes(url.protocol) || !LOCAL_AI_HOSTS.has(url.hostname)) {
    throw new Error(`${name} refused: health data may only go to the local Ollama on this PC (host.docker.internal, 127.0.0.1 or localhost), never an outside service.`);
  }
  return raw.replace(/\/+$/, "");
}
export const TEXT_MODEL = process.env.OLLAMA_MODEL || "gemma4:12b";
export const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "qwen2.5vl:7b";

/** Is the host Ollama app running? (used to gate AI buttons; never starts it) */
export async function ollamaUp(): Promise<boolean> {
  const base = localAiUrl(OLLAMA_URL);
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}

type Chunk = { response?: string; message?: { content?: string }; error?: string };

async function stream(path: string, body: Record<string, unknown>, timeoutMs: number): Promise<string> {
  if ((process.env.LLM_PROVIDER || "ollama").toLowerCase() !== "ollama") {
    throw new Error("Kitchen runs AI on the local Ollama only (LLM_PROVIDER=ollama).");
  }
  const base = localAiUrl(OLLAMA_URL);
  let text = "";
  try {
    await postNdjson(`${base}${path}`, body, timeoutMs, (line) => {
      const c = JSON.parse(line) as Chunk;
      if (c.error) throw new Error(`Ollama: ${c.error}`);
      text += c.response ?? c.message?.content ?? "";
    });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Ollama:")) throw e;
    throw new Error(describeNetError(e, `Local AI (Ollama at ${base})`));
  }
  if (!text.trim()) throw new Error("Ollama returned an empty answer");
  return text;
}

export function ollamaJson(prompt: string, system: string, schema: z.ZodType, timeoutMs = 1_800_000): Promise<string> {
  return stream(
    "/api/generate",
    { model: TEXT_MODEL, prompt, system, stream: true, think: false, format: jsonSchemaOf(schema), options: { num_ctx: 16384, temperature: 0.4, num_predict: 7000, repeat_penalty: 1.1 } },
    timeoutMs,
  );
}

/** Vision call (photo food log): image as base64, structured JSON answer. */
export function ollamaVisionJson(prompt: string, imageB64: string, schema: z.ZodType, timeoutMs = 600_000): Promise<string> {
  return stream(
    "/api/chat",
    { model: VISION_MODEL, stream: true, format: jsonSchemaOf(schema), messages: [{ role: "user", content: prompt, images: [imageB64] }], options: { temperature: 0.2, num_predict: 1500 } },
    timeoutMs,
  );
}

/**
 * Ask, validate with zod, and retry with the validation errors (plus any extra check, e.g. diet
 * rules) fed back to the model. Throws after `attempts` failures.
 */
export async function generateValidated<T>(opts: {
  prompt: string;
  system: string;
  schema: z.ZodType<T>;
  attempts?: number;
  check?: (data: T) => string | null | Promise<string | null>; // return an error message to reject
  onLog?: (msg: string) => Promise<void> | void;
  ask?: (prompt: string) => Promise<string>; // injectable for tests
}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const ask = opts.ask ?? ((p: string) => ollamaJson(p, opts.system, opts.schema));
  let feedback = "";
  for (let i = 1; i <= attempts; i++) {
    await opts.onLog?.(`attempt ${i}/${attempts}: asking ${TEXT_MODEL}`);
    const text = await ask(feedback ? `${opts.prompt}\n\nYour previous answer was REJECTED: ${feedback}\nFix every point and answer again.` : opts.prompt);
    const parsed = parseModelJson(opts.schema, text);
    if (!parsed.ok) {
      feedback = parsed.error;
      await opts.onLog?.(`rejected (schema): ${feedback}`);
      continue;
    }
    const bad = (await opts.check?.(parsed.data)) ?? null;
    if (bad) {
      feedback = bad;
      await opts.onLog?.(`rejected (rules): ${bad}`);
      continue;
    }
    return parsed.data;
  }
  throw new Error(`model output failed validation ${attempts}× — last: ${feedback}`);
}

/** Unload the text model so ComfyUI gets the 8 GB of VRAM. Best effort, never throws. */
export async function unloadTextModel(): Promise<void> {
  try {
    await fetch(`${localAiUrl(OLLAMA_URL)}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: TEXT_MODEL, keep_alive: 0 }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    /* not running (or OLLAMA_URL refused — the next real call reports that) */
  }
}

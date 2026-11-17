// ComfyUI (optional, on the host GPU, :8188). Default: FLUX.2 [klein] 4B (Apache-2.0, GGUF Q5_K_M
// via ComfyUI-GGUF; template wiring: qwen_3_4b text encoder, flux2 VAE, Flux2Scheduler 4 steps, CFGGuider cfg 1,
// euler) — picked when ComfyUI lists its three files. Fallback / COMFYUI_MODEL pin: the checkpoint path
// (FLUX.1-schnell fp8, 16-channel SD3 latent, cfg 1, euler/simple). Output bytes are written to the
// images volume and served by /api/images/[id]; nothing external, no stock photos.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const COMFYUI_URL = process.env.COMFYUI_URL || "http://host.docker.internal:8188";
export const IMAGES_DIR = process.env.IMAGES_DIR || "/data/images";

/** Picture painting is opt-in: nothing is ever sent to ComfyUI unless IMAGE_GENERATION=on. */
export function imageGenerationOn(): boolean {
  return process.env.IMAGE_GENERATION === "on";
}

// Food-photography rules: soft side window light, 45° for plated food / overhead for bowls, one hero plate with
// empty space round it, odd counts, ≥3 colours + fresh garnish, sauce under or beside the food, clean rim, props
// only at the edge. No steam: klein put it on cold salads too. klein runs at
// cfg 1, so NEGATIVE is ignored — every "no …" has to live in the positive prompt.
const STYLE =
  "photo-realistic food photography, soft natural side light from a window, warm home kitchen softly blurred behind, shallow depth of field, sharp focus on the food, true-to-life appetising colours, no text, no logos, no faces, 35mm";
const STYLE_BY_KIND: Record<string, string> = {
  hero:
    "plated for the camera like a food stylist: one single plate or bowl as the hero, centred, with generous empty space around it, three-quarter 45-degree angle (straight overhead for bowls and flat dishes), food arranged with a little height, pieces in odd numbers, at least three colours with a fresh herb garnish, sauce spooned under or beside the food, clean plate rim, a linen napkin or fork only at the edge of the frame, no other dishes or extra food on the table, no steam, no smoke",
  step: "the cooking step in progress, close-up of the pan, pot, tray or board at a 45-degree angle, tidy work surface, only the ingredients of this step in the shot",
  ingredient: "single ingredient centred on a wooden board with empty space around it, 45-degree angle, nothing else in the shot",
  technique: "close-up of the technique on a wooden board or in a pan, 45-degree angle, tidy surface, nothing unrelated in the shot",
};
const NEGATIVE = "text, letters, watermark, logo, label, faces, deformed hands, extra fingers, blurry, lowres, cartoon, illustration, extra ingredients, unrelated food, cluttered table";

async function objectInfo(node: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${COMFYUI_URL}/object_info/${node}`, { signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function pickModel(): Promise<string> {
  if (process.env.COMFYUI_MODEL) return process.env.COMFYUI_MODEL;
  const info = await objectInfo("CheckpointLoaderSimple");
  const node = info?.CheckpointLoaderSimple as { input?: { required?: { ckpt_name?: unknown[] } } } | undefined;
  const list = node?.input?.required?.ckpt_name?.[0];
  const models = Array.isArray(list) ? list.map(String) : [];
  if (!models.length) throw new Error("ComfyUI not reachable on :8188 or no checkpoint installed");
  return models.find((m) => /flux/i.test(m)) ?? models[0];
}

export function buildWorkflow(o: { model: string; prompt: string; seed: number; width: number; height: number }) {
  const flux = /flux/i.test(o.model);
  return {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: o.model } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: o.prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: NEGATIVE, clip: ["4", 1] } },
    "5": { class_type: flux ? "EmptySD3LatentImage" : "EmptyLatentImage", inputs: { width: o.width, height: o.height, batch_size: 1 } },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: o.seed,
        steps: flux ? 6 : 25,
        cfg: flux ? 1 : 7,
        sampler_name: flux ? "euler" : "dpmpp_2m",
        scheduler: flux ? "simple" : "karras",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "kitchen", images: ["8", 0] } },
  };
}

export const KLEIN_UNET = "flux-2-klein-4b-Q5_K_M.gguf";
const KLEIN_CLIP = "qwen_3_4b.safetensors";
const KLEIN_VAE = "flux2-vae.safetensors";

function listOf(info: Record<string, unknown> | null, node: string, field: string): string[] {
  const n = info?.[node] as { input?: { required?: Record<string, unknown[]> } } | undefined;
  const v = n?.input?.required?.[field]?.[0];
  return Array.isArray(v) ? v.map(String) : [];
}

/** klein unet (ComfyUI-GGUF) + text encoder + VAE all listed by the live engine. */
export async function hasKlein(): Promise<boolean> {
  const [u, c, v] = await Promise.all([objectInfo("UnetLoaderGGUF"), objectInfo("CLIPLoader"), objectInfo("VAELoader")]);
  return (
    listOf(u, "UnetLoaderGGUF", "unet_name").includes(KLEIN_UNET) &&
    listOf(c, "CLIPLoader", "clip_name").includes(KLEIN_CLIP) &&
    listOf(v, "VAELoader", "vae_name").includes(KLEIN_VAE)
  );
}

/** FLUX.2 klein 4B distilled text-to-image (cfg 1 ignores negatives, so the negative is zeroed). Sizes snap to 16 px. */
export function buildKleinWorkflow(o: { prompt: string; seed: number; width: number; height: number }) {
  const width = Math.max(16, Math.round(o.width / 16) * 16);
  const height = Math.max(16, Math.round(o.height / 16) * 16);
  return {
    m: { class_type: "UnetLoaderGGUF", inputs: { unet_name: KLEIN_UNET } },
    c: { class_type: "CLIPLoader", inputs: { clip_name: KLEIN_CLIP, type: "flux2", device: "default" } },
    v: { class_type: "VAELoader", inputs: { vae_name: KLEIN_VAE } },
    pos: { class_type: "CLIPTextEncode", inputs: { text: o.prompt, clip: ["c", 0] } },
    neg: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["pos", 0] } },
    lat: { class_type: "EmptyFlux2LatentImage", inputs: { width, height, batch_size: 1 } },
    sig: { class_type: "Flux2Scheduler", inputs: { steps: 4, width, height } },
    smp: { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    noise: { class_type: "RandomNoise", inputs: { noise_seed: o.seed } },
    guid: { class_type: "CFGGuider", inputs: { model: ["m", 0], positive: ["pos", 0], negative: ["neg", 0], cfg: 1 } },
    samp: {
      class_type: "SamplerCustomAdvanced",
      inputs: { noise: ["noise", 0], guider: ["guid", 0], sampler: ["smp", 0], sigmas: ["sig", 0], latent_image: ["lat", 0] },
    },
    dec: { class_type: "VAEDecode", inputs: { samples: ["samp", 0], vae: ["v", 0] } },
    save: { class_type: "SaveImage", inputs: { filename_prefix: "kitchen", images: ["dec", 0] } },
  };
}

/** klein unless COMFYUI_MODEL pins a checkpoint or the klein files are missing. */
async function workflowFor(prompt: string, seed: number, size: { width: number; height: number }) {
  if (!process.env.COMFYUI_MODEL && (await hasKlein())) return buildKleinWorkflow({ prompt, seed, ...size });
  return buildWorkflow({ model: await pickModel(), prompt, seed, ...size });
}

export function fullPrompt(subject: string, kind?: string): string {
  const extra = kind ? STYLE_BY_KIND[kind] : undefined;
  return `${subject.trim().replace(/\.$/, "")}. ${STYLE}${extra ? `, ${extra}` : ""}`;
}

/** Render one image and write it to IMAGES_DIR/<id>.png. Returns the file name. */
export async function renderToFile(id: string, subject: string, size: { width: number; height: number } = { width: 1024, height: 768 }, kind?: string): Promise<string> {
  if (!imageGenerationOn()) throw new Error("picture generation is off (set IMAGE_GENERATION=on)");
  const wf = await workflowFor(fullPrompt(subject, kind), Math.floor(Math.random() * 1e9), size);
  const res = await fetch(`${COMFYUI_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: wf }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ComfyUI /prompt ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { prompt_id: pid } = (await res.json()) as { prompt_id?: string };
  if (!pid) throw new Error("ComfyUI did not queue the prompt");
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    let hist: Record<string, { outputs?: Record<string, { images?: { filename: string; subfolder?: string; type?: string }[] }>; status?: { status_str?: string } }>;
    try {
      const h = await fetch(`${COMFYUI_URL}/history/${pid}`, { signal: AbortSignal.timeout(8000) });
      if (!h.ok) continue;
      hist = await h.json();
    } catch {
      continue;
    }
    const entry = hist?.[pid];
    if (entry?.status?.status_str === "error") throw new Error("ComfyUI reported an execution error");
    for (const node of Object.values(entry?.outputs ?? {})) {
      const img = node.images?.[0];
      if (!img) continue;
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? "", type: img.type ?? "output" });
      const v = await fetch(`${COMFYUI_URL}/view?${q}`, { signal: AbortSignal.timeout(30_000) });
      if (!v.ok) throw new Error(`ComfyUI /view ${v.status}`);
      const buf = Buffer.from(await v.arrayBuffer());
      await mkdir(IMAGES_DIR, { recursive: true });
      const file = `${id}.png`;
      await writeFile(path.join(IMAGES_DIR, file), buf);
      return file;
    }
  }
  throw new Error("ComfyUI render timed out (10 min)");
}

export async function releaseComfyMemory(): Promise<void> {
  if (!imageGenerationOn()) return;
  try {
    await fetch(`${COMFYUI_URL}/free`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* gone or busy */
  }
}

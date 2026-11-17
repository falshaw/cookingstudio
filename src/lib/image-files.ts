// Where a picture's bytes live. Rendered pictures go to IMAGES_DIR (the images volume); the pictures
// that ship with the repo (prisma/seed-images, linked by the seed) are read from SEED_IMAGES_DIR.
// A file in IMAGES_DIR wins, so a re-rendered picture replaces the shipped one.
import { access } from "node:fs/promises";
import path from "node:path";
import { IMAGES_DIR } from "@/lib/comfyui";

export const SEED_IMAGES_DIR = process.env.SEED_IMAGES_DIR || path.join(process.cwd(), "prisma", "seed-images");

const TYPES: Record<string, string> = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp4": "video/mp4" };

export function contentType(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Absolute path of a stored picture or clip, or null when neither folder has it. */
export async function resolveImageFile(name: string): Promise<string | null> {
  const base = path.basename(name);
  for (const dir of [IMAGES_DIR, SEED_IMAGES_DIR]) {
    const file = path.join(dir, base);
    try {
      await access(file);
      return file;
    } catch {
      // try the next folder
    }
  }
  return null;
}

/** Name of the pre-made 480 px WebP thumbnail next to a picture: `hero-x.webp` → `hero-x.thumb.webp`. */
export function thumbName(name: string): string {
  return path.basename(name).replace(/\.[a-z0-9]+$/i, "") + ".thumb.webp";
}

/**
 * The thumbnail of a stored picture, taken from the folder the original resolves to (so a re-rendered
 * picture in IMAGES_DIR never shows the shipped picture's thumbnail), or null when none was made yet.
 */
export async function resolveThumbFile(name: string): Promise<string | null> {
  const original = await resolveImageFile(name);
  if (!original) return null;
  const thumb = path.join(path.dirname(original), thumbName(name));
  try {
    await access(thumb);
    return thumb;
  } catch {
    return null;
  }
}

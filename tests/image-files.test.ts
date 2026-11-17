// Thumbnail lookup for card grids: `<name>.thumb.webp` next to the original, in the images volume or the
// shipped seed folder, and never a shipped thumbnail for a picture that was re-rendered into the volume.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const images = mkdtempSync(path.join(tmpdir(), "cs-images-"));
const seed = mkdtempSync(path.join(tmpdir(), "cs-seed-"));
process.env.IMAGES_DIR = images;
process.env.SEED_IMAGES_DIR = seed;
const { resolveThumbFile, thumbName } = await import("@/lib/image-files");

writeFileSync(path.join(seed, "hero-soup.webp"), "x");
writeFileSync(path.join(seed, "hero-soup.thumb.webp"), "x");
writeFileSync(path.join(seed, "hero-stew.webp"), "x");
writeFileSync(path.join(seed, "hero-stew.thumb.webp"), "x");
writeFileSync(path.join(images, "hero-stew.webp"), "x"); // re-rendered, no thumbnail yet
writeFileSync(path.join(images, "cabc.png"), "x");
writeFileSync(path.join(images, "cabc.thumb.webp"), "x");

afterAll(() => {
  rmSync(images, { recursive: true, force: true });
  rmSync(seed, { recursive: true, force: true });
});

describe("thumbnails", () => {
  it("names the thumbnail after the original, without its extension or folder", () => {
    expect(thumbName("hero-soup.webp")).toBe("hero-soup.thumb.webp");
    expect(thumbName("../x/cabc.png")).toBe("cabc.thumb.webp");
  });
  it("finds it in the seed folder and in the images volume", async () => {
    expect(await resolveThumbFile("hero-soup.webp")).toBe(path.join(seed, "hero-soup.thumb.webp"));
    expect(await resolveThumbFile("cabc.png")).toBe(path.join(images, "cabc.thumb.webp"));
  });
  it("a re-rendered picture never gets the shipped thumbnail; missing = null", async () => {
    expect(await resolveThumbFile("hero-stew.webp")).toBeNull();
    expect(await resolveThumbFile("nope.png")).toBeNull();
  });
});

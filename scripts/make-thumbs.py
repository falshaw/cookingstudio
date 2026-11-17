"""Make 480 px WebP thumbnails (<name>.thumb.webp) for card grids.

Card grids load `/api/images/<id>?w=thumb` instead of the full-size original; the route serves the
thumbnail that sits next to the original and falls back to the original when there is none yet.
Only writes thumbnails that are missing; never touches the originals. Needs Pillow (pip install pillow).

  Local folder (e.g. the shipped seed pictures):
    python scripts/make-thumbs.py --dir prisma/seed-images --glob "hero-*.webp"
  Pictures rendered later, inside the app container's images volume:
    python scripts/make-thumbs.py --container <app-container> [--container-dir /data/images]
"""
import argparse
import fnmatch
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

SIZE = 480
QUALITY = 72
EXTS = (".png", ".webp", ".jpg", ".jpeg")


def is_original(name: str, pattern: str) -> bool:
    return name.lower().endswith(EXTS) and not name.endswith(".thumb.webp") and fnmatch.fnmatch(name, pattern)


def thumb_name(name: str) -> str:
    return name.rsplit(".", 1)[0] + ".thumb.webp"


def make(src: Path, dst: Path) -> None:
    with Image.open(src) as im:
        im = im.convert("RGB")
        im.thumbnail((SIZE, SIZE))
        # a fresh RGB image carries no EXIF/XMP/ICC, so the thumbnail ships without metadata
        im.save(dst, "WEBP", quality=QUALITY, method=6)


def todo_list(names: list[str], pattern: str) -> list[str]:
    have = set(names)
    return [n for n in names if is_original(n, pattern) and thumb_name(n) not in have]


def run_local(folder: Path, pattern: str) -> None:
    todo = todo_list(sorted(p.name for p in folder.iterdir() if p.is_file()), pattern)
    print(f"{len(todo)} thumbnails to make in {folder}")
    for i, name in enumerate(todo, 1):
        make(folder / name, folder / thumb_name(name))
        if i % 100 == 0:
            print(f"  {i}/{len(todo)}")


def run_container(container: str, cdir: str, pattern: str) -> None:
    def sh(*args: str) -> str:
        return subprocess.run(args, check=True, capture_output=True, text=True).stdout

    todo = todo_list(sh("docker", "exec", container, "ls", cdir).split(), pattern)
    print(f"{len(todo)} thumbnails to make in {container}:{cdir}")
    if not todo:
        return
    with tempfile.TemporaryDirectory() as tmp:
        src, out = Path(tmp, "src"), Path(tmp, "out")
        src.mkdir()
        out.mkdir()
        for i, name in enumerate(todo, 1):
            subprocess.run(["docker", "cp", f"{container}:{cdir}/{name}", str(src / name)], check=True, capture_output=True)
            make(src / name, out / thumb_name(name))
            (src / name).unlink()
            if i % 100 == 0:
                print(f"  {i}/{len(todo)}")
        # one docker cp for all new thumbnails ("<dir>/." copies the folder's contents)
        subprocess.run(["docker", "cp", str(out) + "/.", f"{container}:{cdir}/"], check=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    where = ap.add_mutually_exclusive_group(required=True)
    where.add_argument("--dir", type=Path, help="local folder with the originals")
    where.add_argument("--container", help="running app container that holds the images volume")
    ap.add_argument("--container-dir", default="/data/images", help="images folder inside the container (IMAGES_DIR)")
    ap.add_argument("--glob", default="*", help='only originals matching this name pattern, e.g. "hero-*.webp"')
    a = ap.parse_args()
    if a.dir:
        run_local(a.dir, a.glob)
    else:
        run_container(a.container, a.container_dir, a.glob)
    print("done")


if __name__ == "__main__":
    main()

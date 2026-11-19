#!/usr/bin/env python3
"""Regenerate the app icon family.

Fixes two defects in the generated icon set:
1. The master artwork was exported on an opaque white background, so every size
   (and every member of icon.icns) carries white corner artifacts instead of
   transparent rounded corners. macOS does not mask app icons, so those white
   corners show up in the Dock and in System Settings permission lists.
2. The 16/32/48/64 members were naive Lanczos downscales of the 1968px master:
   the terminal window lands off-center at ~60% canvas width and the 1px text
   lines alias into noise. Per Apple HIG these sizes are redrawn as simplified
   icons (the terminal window itself becomes the rounded-square icon).

Large sizes (128-1024) keep the original artwork, only corner-fixed.

Run from the repo root: python3 scripts/icons.py
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parent.parent
BUILD = REPO / "build"
RESOURCE = REPO / "resource" / "electron-icons"

# Brand palette sampled from the master artwork (build/icon.png).
PLATE = (14, 15, 21, 255)  # dark terminal background
FRAME = (72, 72, 80, 255)  # window frame / pane divider
WHITE = (253, 253, 253, 255)  # prompt / text
GREEN = (40, 190, 94, 255)  # tmux status green
GREEN_DARK = (17, 95, 48, 255)  # status bar accent segment

SS = 8  # supersampling factor for the small-size renderer


def corner_fix(im: Image.Image) -> Image.Image:
    """Make the near-white background that surrounds the rounded plate transparent.

    Flood-fills from the four canvas corners over near-white pixels only, so the
    white prompt/text inside the plate is never touched (it is enclosed by the
    dark plate and the gray frame).
    """
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()

    near_white = [[min(px[x, y][:3]) > 200 for x in range(w)] for y in range(h)]
    visited = [[False] * w for _ in range(h)]
    stack = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h or visited[y][x]:
            continue
        visited[y][x] = True
        if not near_white[y][x]:
            continue
        px[x, y] = (0, 0, 0, 0)
        stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return im


def rounded_plate(n: int, radius: float, fill, outline, width: int) -> Image.Image:
    """Rounded square of side n at supersampled resolution."""
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(
        [width // 2, width // 2, n - 1 - width // 2, n - 1 - width // 2],
        radius=radius,
        fill=fill,
        outline=outline,
        width=width,
    )
    return im


def render_small(size: int) -> Image.Image:
    """Simplified icon for a specific pixel size: the terminal window IS the icon.

    Motif kept from the master: dark terminal, centered pane divider (tmux
    panes), white/green text dashes, green status bar along the bottom.
    """
    n = size * SS
    bt = max(1, round(size / 20)) * SS  # frame border thickness
    im = rounded_plate(n, n * 0.2, PLATE, FRAME, bt)

    d = ImageDraw.Draw(im)
    sbh = round(size * 0.17) * SS  # status bar height
    top, bottom = bt, n - bt
    status_top = bottom - sbh

    # Pane divider from the top border down to the status bar.
    div_x = n // 2
    d.rectangle([div_x - bt // 2, top, div_x + bt // 2 - 1, status_top - 1], fill=FRAME)

    # Green status bar across the inner bottom, with a darker tmux segment.
    d.rectangle([bt, status_top, n - bt - 1, bottom - 1], fill=GREEN)
    seg = round(n * 0.28)
    d.rectangle([n - bt - seg, status_top, n - bt - 1, bottom - 1], fill=GREEN_DARK)

    # Text dashes: three rows per pane, vertically distributed.
    pad = round(size * 0.11) * SS
    th = max(1, round(size / 11)) * SS  # dash thickness
    rows = [
        (0.24, WHITE, 0.55),
        (0.5, GREEN, 0.4),
        (0.76, WHITE, 0.68),
    ]
    panes = (
        (bt + pad, div_x - bt // 2 - pad),  # left pane x-range
        (div_x + bt // 2 + pad, n - bt - pad),  # right pane x-range
    )
    content_top, content_bottom = top + round(size * 0.1) * SS, status_top - round(size * 0.12) * SS
    for pane_idx, (x0, x1) in enumerate(panes):
        pane_w = x1 - x0
        for frac, color, length_frac in rows:
            # Right pane rows are offset by one slot so the two panes read separately.
            f = frac if pane_idx == 0 else min(0.85, frac + 0.08)
            cy = content_top + round((content_bottom - content_top) * f)
            w = max(th, round(pane_w * length_frac))
            d.rectangle([x0, cy - th // 2, x0 + w - 1, cy + th // 2 - th % 2], fill=color)

    return im.resize((size, size), Image.LANCZOS)


def main() -> None:
    workdir = Path(tempfile.mkdtemp(prefix="icons-"))
    iconset = workdir / "icon.iconset"
    iconset.mkdir()

    # Extract the current icns so the large members keep their artwork.
    subprocess.run(
        ["iconutil", "-c", "iconset", "-o", str(iconset), str(BUILD / "icon.icns")],
        check=True,
    )

    small = {s: render_small(s) for s in (16, 32, 48, 64)}
    large = {s: corner_fix(Image.open(iconset / f"icon_{s}x{s}.png")) for s in (128, 256, 512)}
    large[1024] = corner_fix(Image.open(iconset / "icon_512x512@2x.png"))

    members = {
        "icon_16x16.png": small[16],
        "icon_16x16@2x.png": small[32],
        "icon_32x32.png": small[32],
        "icon_32x32@2x.png": small[64],
        "icon_128x128.png": large[128],
        "icon_128x128@2x.png": large[256],
        "icon_256x256.png": large[256],
        "icon_256x256@2x.png": large[512],
        "icon_512x512.png": large[512],
        "icon_512x512@2x.png": large[1024],
    }
    for name, im in members.items():
        im.save(iconset / name)

    icns = workdir / "icon.icns"
    subprocess.run(["iconutil", "-c", "icns", "-o", str(icns), str(iconset)], check=True)

    # build/: what electron-builder consumes (build/icon.icns for mac,
    # build/icons/*.png for linux, build/icons/512x512.png ships in the asar).
    shutil.copy(icns, BUILD / "icon.icns")
    for s, im in {**small, **large}.items():
        if s != 1024:
            im.save(BUILD / "icons" / f"{s}x{s}.png")
    corner_fix(Image.open(BUILD / "icon.png")).save(BUILD / "icon.png")
    large[256].save(BUILD / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])

    # resource/electron-icons/: regenerate the reference set to match.
    (RESOURCE / "macos").mkdir(parents=True, exist_ok=True)
    shutil.copy(icns, RESOURCE / "macos" / "icon.icns")
    for s in (16, 32, 64, 128, 256, 512, 1024):
        src = small.get(s) or large[s]
        src.save(RESOURCE / "macos" / f"{s}x{s}.png")
    for s in (16, 32, 48, 64, 128, 256):
        src = small.get(s) or large[s]
        src.save(RESOURCE / "windows" / f"{s}x{s}.png")
    shutil.copy(BUILD / "icon.ico", RESOURCE / "windows" / "icon.ico")
    linux_icons = RESOURCE / "linux" / "icons"
    linux_icons.mkdir(parents=True, exist_ok=True)
    for s in (16, 32, 48, 64, 128, 256, 512):
        src = small.get(s) or large[s]
        src.save(linux_icons / f"{s}x{s}.png")
    master = corner_fix(Image.open(RESOURCE / "icon.png"))
    master.save(RESOURCE / "icon.png")
    master.resize((1024, 1024), Image.LANCZOS).save(workdir / "master-1024.png")

    print("icon family regenerated:")
    print("  - small sizes 16/32/48/64 redrawn (centered, simplified, AA)")
    print("  - large sizes 128-1024 corner-fixed (white background removed)")
    print("  - icon.icns rebuilt; build/ and resource/electron-icons/ synced")
    shutil.rmtree(workdir)


if __name__ == "__main__":
    main()

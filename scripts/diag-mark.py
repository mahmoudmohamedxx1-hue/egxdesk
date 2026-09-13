#!/usr/bin/env python3
"""Diagnose logo-mark.png: row/col content profile to find any leaked wordmark
band inside the mark crop (VLM claims 'DESK' text at bottom-right)."""
from PIL import Image

for name in ("logo-mark.png", "logo-mark-dark.png", "logo.png"):
    im = Image.open(f"/home/z/my-project/public/{name}").convert("RGBA")
    W, H = im.size
    p = im.load()

    # row profile: fraction of opaque pixels per row band (10px bands)
    print(f"\n=== {name} {W}x{H} — row content bands ===")
    bands = []
    for y0 in range(0, H, max(1, H // 40)):
        cnt = tot = 0
        for y in range(y0, min(y0 + max(1, H // 40), H), 3):
            for x in range(0, W, 6):
                tot += 1
                if p[x, y][3] > 100:
                    cnt += 1
        bands.append((y0, cnt / max(1, tot)))
    for y0, r in bands:
        bar = "#" * int(r * 50)
        print(f"  row {y0:5d}  {r:5.1%}  {bar}")

    # column profile
    print(f"  --- col profile ---")
    colb = []
    for x0 in range(0, W, max(1, W // 30)):
        cnt = tot = 0
        for x in range(x0, min(x0 + max(1, W // 30), W), 3):
            for y in range(0, H, 6):
                tot += 1
                if p[x, y][3] > 100:
                    cnt += 1
        colb.append((x0, cnt / max(1, tot)))
    for x0, r in colb:
        bar = "#" * int(r * 40)
        print(f"  col {x0:5d}  {r:5.1%}  {bar}")

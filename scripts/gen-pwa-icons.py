#!/usr/bin/env python3
"""Generate PWA icons for EGX Desk (G14): the app mark (X on the primary
color) rendered to 192/512 PNGs + a maskable variant with extra padding."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = "/home/z/my-project/public"
os.makedirs(OUT, exist_ok=True)

PRIMARY = (13, 98, 78)  # app's primary teal (matches globals.css)
PRIMARY_DARK = (9, 70, 56)
FG = (250, 250, 249)

def draw_icon(size: int, path: str, maskable: bool = False):
    img = Image.new("RGB", (size, size), PRIMARY)
    d = ImageDraw.Draw(img)
    # subtle diagonal depth band
    d.polygon([(0, size), (size, 0), (size, size)], fill=PRIMARY_DARK)
    # the X mark, centered, generous padding for maskable safe zone
    pad = size * (0.26 if maskable else 0.22)
    x0, y0, x1, y1 = pad, pad, size - pad, size - pad
    stroke = max(6, int(size * (0.13 if maskable else 0.15)))
    d.line([(x0, y0), (x1, y1)], fill=FG, width=stroke)
    d.line([(x0, y1), (x1, y0)], fill=FG, width=stroke)
    # rounded stroke caps via circles at the four endpoints
    r = stroke // 2
    for (cx, cy) in [(x0, y0), (x1, y1), (x0, y1), (x1, y0)]:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=FG)
    img.save(path, "PNG", optimize=True)
    print("wrote", path, os.path.getsize(path), "bytes")

draw_icon(192, f"{OUT}/icon-192.png")
draw_icon(512, f"{OUT}/icon-512.png")
draw_icon(512, f"{OUT}/icon-512-maskable.png", maskable=True)
print("OK")

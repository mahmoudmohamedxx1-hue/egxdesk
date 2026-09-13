#!/usr/bin/env python3
"""Analyze the uploaded logo image: sample checkerboard colors, find content bbox."""
from PIL import Image
import collections

SRC = "/home/z/my-project/upload/MAKE_IT_WITHOUT_BACKGROUND_2K_20260910233958.jpeg"
img = Image.open(SRC).convert("RGB")
W, H = img.size
print(f"Image: {W}x{H}")

# Sample corner colors (checkerboard cells)
samples = {}
for name, (x, y) in {
    "top-left": (5, 5), "top-left+20": (25, 5),
    "top-right": (W-5, 5), "top-right-20": (W-25, 5),
    "bottom-left": (5, H-5), "bottom-left+20": (25, H-5),
}.items():
    samples[name] = img.getpixel((x, y))
for k, v in samples.items():
    print(f"  {k}: {v}")

# Histogram of the most common colors (downsampled)
small = img.resize((W // 8, H // 8))
counts = collections.Counter(small.getdata())
print("\nTop 10 most common colors (downsampled):")
for color, cnt in counts.most_common(10):
    print(f"  {color}: {cnt}")

# Find the palette bar at the bottom: scan rows from bottom up, find rows with saturated colors
import colorsys
def row_stats(y):
    px = [img.getpixel((x, y)) for x in range(0, W, 24)]
    sat = []
    for r, g, b in px:
        h_, s_, v_ = colorsys.rgb_to_hsv(r/255, g/255, b/255)
        sat.append(s_)
    return sum(sat) / len(sat)

print("\nAverage saturation by row (from bottom):")
for dy in range(0, 200, 20):
    y = H - 1 - dy
    print(f"  y={y} ({dy}px from bottom): sat={row_stats(y):.3f}")

# Column profile of "non-checkerboard" content: luminance < 120 or saturated
def is_content(px):
    r, g, b = px
    lum = 0.299*r + 0.587*g + 0.114*b
    mx, mn = max(px), min(px)
    sat = (mx - mn) / mx if mx else 0
    return lum < 120 or sat > 0.25

print("\nScanning content bbox (excluding bottom 200px for palette bar)...")
min_x, min_y, max_x, max_y = W, H, 0, 0
step = 4
for y in range(0, H - 200, step):
    for x in range(0, W, step):
        if is_content(img.getpixel((x, y))):
            if x < min_x: min_x = x
            if x > max_x: max_x = x
            if y < min_y: min_y = y
            if y > max_y: max_y = y
print(f"Content bbox (lum<120 or sat>0.25): x=[{min_x},{max_x}] y=[{min_y},{max_y}]")
print(f"  as % of image: x=[{min_x/W:.2%},{max_x/W:.2%}] y=[{min_y/H:.2%},{max_y/H:.2%}]")

#!/usr/bin/env python3
"""Sample the content colors (gold accent + dark grey) from the logo image."""
from PIL import Image
import collections

SRC = "/home/z/my-project/upload/MAKE_IT_WITHOUT_BACKGROUND_2K_20260910233958.jpeg"
img = Image.open(SRC).convert("RGB")
W, H = img.size

# Content region only
region = img.crop((452, 296, 1944, 1488))
counts = collections.Counter(region.getdata())

def lum(px): return 0.299*px[0] + 0.587*px[1] + 0.114*px[2]

gold = [(c, n) for c, n in counts.most_common(3000) if max(c)-min(c) > 60 and c[0] > 140 and lum(c) < 220]
dark = [(c, n) for c, n in counts.most_common(3000) if lum(c) < 110]

print("Top gold-ish colors:")
for c, n in sorted(gold, key=lambda t: -t[1])[:8]:
    print(f"  {c}: {n}")
print("Top dark colors:")
for c, n in sorted(dark, key=lambda t: -t[1])[:8]:
    print(f"  {c}: {n}")

# What is the vertical split between logo mark and EGXDESK text?
# scan rows in content region for content density
def is_content(px):
    r, g, b = px
    return lum(px) < 150 or (max(px)-min(px) > 50 and r > 140)

width = region.size[0]
row_density = []
for y in range(0, region.size[1], 4):
    cnt = sum(1 for x in range(0, width, 8) if is_content(region.getpixel((x, y))))
    row_density.append((y, cnt))

# find the gap between logo (top) and text (bottom): the widest low-density band mid-region
best_gap = None
for i in range(len(row_density)):
    y, c = row_density[i]
    if 0.35 < y / region.size[1] < 0.62 and c < width/8*0.08:
        if best_gap is None: best_gap = [y, y]
        best_gap[1] = y
print(f"\nGap between logo and text (y in region): {best_gap}")
print(f"Region size: {region.size}, gap at {best_gap[0]/region.size[1]:.1%}-{best_gap[1]/region.size[1]:.1%}")

#!/usr/bin/env python3
"""T66 — pixel-level clip verification, cropped to the SVG element only."""
from PIL import Image
import colorsys

img = Image.open("/home/z/my-project/scripts/qa/t66-val-log-zoom2.png").convert("RGB")
# SVG element page rect: x=81 y=355 w=1118 h=358 (device scale 1)
svg = img.crop((81, 355, 81 + 1118, 355 + 358))
sw, sh = svg.size
# viewBox 960x560 → plot frame: PX0=70 → px 70/960*sw ; PY0=30 → 30/560*sh ; PX1=920; PY1=500
px0 = 70 / 960 * sw
px1 = 920 / 960 * sw
py0 = 30 / 560 * sh
py1 = 500 / 560 * sh
print(f"svg crop {sw}x{sh}; plot frame x [{px0:.0f},{px1:.0f}] y [{py0:.0f},{py1:.0f}]")


def bubble_pixel(px):
    r, g, b = px
    hh, ss, vv = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return ss > 0.45 and 0.25 < vv < 0.95


# count bubble-colored pixels OUTSIDE the plot frame (in the margins)
outside = 0
outside_samples = []
for yy in range(0, sh, 2):
    for xx in range(0, sw, 2):
        if bubble_pixel(svg.getpixel((xx, yy))):
            if xx < px0 - 1 or xx > px1 + 1 or yy < py0 - 1 or yy > py1 + 1:
                outside += 1
                if len(outside_samples) < 8:
                    outside_samples.append((xx, yy))
print(f"saturated pixels OUTSIDE the plot frame: {outside}")
print(f"samples: {outside_samples}")
# count inside for reference
inside = sum(
    1
    for yy in range(0, sh, 2)
    for xx in range(0, sw, 2)
    if bubble_pixel(svg.getpixel((xx, yy))) and px0 - 1 <= xx <= px1 + 1 and py0 - 1 <= yy <= py1 + 1
)
print(f"saturated pixels INSIDE the plot frame: {inside}")

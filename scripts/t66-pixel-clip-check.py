#!/usr/bin/env python3
"""T66 — pixel-level clip verification: sample the axis-margin strips of the
zoomed valuation map screenshot for bubble colors (must be NONE there)."""
from PIL import Image

img = Image.open("/home/z/my-project/scripts/qa/t66-val-log-zoom2.png").convert("RGB")
w, h = img.size
print(f"screenshot {w}x{h}")

# The SVG element: find the plot area. The svg viewBox is 960x560; the svg
# element occupies the card width. We approximate: the plot frame's left
# edge (PX0=70/960) and bottom edge (PY1=500/560) of the SVG element.
# The SVG card spans roughly the content width; find it by scanning for the
# axis frame line... simpler: use the same ratios the DOM measured earlier.
# From the earlier DOM eval, we know the svg rect. Let's re-derive roughly:
# screenshot is full page; the map card starts after the header. Instead of
# guessing, detect colored bubbles and check none sit left of the leftmost
# gridline/axis pixels... too fuzzy. Direct approach: find the svg by its
# known dark card + look for saturated green/red/amber/blue blobs and report
# their bounding box vs the axis frame estimated from tick text positions.

# Simpler robust check: count saturated "bubble-colored" pixels in the whole
# image, then compute the min-x of such pixels. The y-axis tick labels ("1.5x"
# etc.) are dim gray text — not saturated. If bubbles are clipped at the plot
# frame, the saturated pixels' min-x must be clearly right of the y-tick text.
import colorsys

def saturated_bubble_pixel(px):
    r, g, b = px
    hh, ss, vv = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    # bubble fills at opacity .6 on dark card → medium value, strong hue
    return ss > 0.45 and 0.25 < vv < 0.95 and not (abs(r - g) < 12 and abs(g - b) < 12)

xs = []
ys = []
for yy in range(0, h, 3):
    for xx in range(0, w, 3):
        if saturated_bubble_pixel(img.getpixel((xx, yy))):
            xs.append(xx)
            ys.append(yy)

if not xs:
    print("no bubble-colored pixels found — screenshot may show a different state")
else:
    print(f"bubble-colored pixels: {len(xs)}; x range [{min(xs)}, {max(xs)}], y range [{min(ys)}, {max(ys)}]")
    # The y-axis tick labels column: dim text around x ≈ plot_left - 40px.
    # If clipping works, min(xs) should be at/inside the plot frame, and the
    # tick-text column (which is LEFT of the frame) should contain ZERO
    # saturated pixels. Print the histogram of x to see the leftmost cluster.
    left_strip = [x for x in xs if x < min(xs) + 40]
    print(f"pixels in the leftmost 40px band of the bubble field: {len(left_strip)}")

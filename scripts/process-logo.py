#!/usr/bin/env python3
"""Process the uploaded EGXDesk logo image into production assets.

Input : upload/MAKE_IT_WITHOUT_BACKGROUND_2K_20260910233958.jpeg
        (2400x1792, checkerboard fake-transparency, palette bar at bottom)

Outputs (into public/):
  - logo.png        : original colors (slate grey + gold) on TRUE transparency
  - logo-dark.png   : recolored for dark theme (warm cream + gold)
  - logo-mark.png   : hexagon mark only (no wordmark), original colors
  - logo-mark-dark.png : mark only, dark theme
  - icon-512.png / icon-192.png / apple-touch-icon.png : dark tile, cream+gold
  - icon-512-maskable.png : full-bleed tile, content in safe zone
"""
from PIL import Image, ImageFilter
import math

SRC = "/home/z/my-project/upload/MAKE_IT_WITHOUT_BACKGROUND_2K_20260910233958.jpeg"
OUT = "/home/z/my-project/public"

BG_COLORS = [(255, 255, 255), (224, 224, 224)]  # checkerboard pair
ALPHA_LOW, ALPHA_HIGH = 30.0, 95.0               # distance ramp for alpha
GOLD = (253, 199, 13)
SLATE = (90, 94, 103)
CREAM = (237, 236, 228)  # target for dark-theme recolor

def dist(a, b):
    return math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2)

def clamp01(v):
    return max(0.0, min(1.0, v))

# ── 1. load, drop palette bar, crop to content ─────────────────────────
img = Image.open(SRC).convert("RGB")
W, H = img.size
img = img.crop((0, 0, W, H - 70))  # remove the color-palette strip at the bottom
W, H = img.size

def is_content(px):
    r, g, b = px
    lum = 0.299*r + 0.587*g + 0.114*b
    mx, mn = max(px), min(px)
    sat = (mx - mn) / mx if mx else 0
    return lum < 120 or sat > 0.25

step = 4
min_x, min_y, max_x, max_y = W, H, 0, 0
px_data = img.load()
for y in range(0, H, step):
    for x in range(0, W, step):
        if is_content(px_data[x, y]):
            if x < min_x: min_x = x
            if x > max_x: max_x = x
            if y < min_y: min_y = y
            if y > max_y: max_y = y

PAD = 26
crop_box = (max(0, min_x - PAD), max(0, min_y - PAD), min(W, max_x + PAD), min(H, max_y + PAD))
img = img.crop(crop_box)
W, H = img.size
print(f"Cropped logo+wordmark: {W}x{H}  (aspect {W/H:.3f})")

# ── 2. alpha from checkerboard distance ────────────────────────────────
rgba = img.convert("RGBA")
p = rgba.load()
for y in range(H):
    for x in range(W):
        r, g, b = p[x, y][:3]
        d = min(dist((r, g, b), BG_COLORS[0]), dist((r, g, b), BG_COLORS[1]))
        a = clamp01((d - ALPHA_LOW) / (ALPHA_HIGH - ALPHA_LOW))
        p[x, y] = (r, g, b, int(a * 255))

# kill JPEG speckle in the alpha channel
r_, g_, b_, a_ = rgba.split()
a_ = a_.filter(ImageFilter.MedianFilter(5))
rgba = Image.merge("RGBA", (r_, g_, b_, a_))

# trim rows/cols that ended up fully transparent after the median pass
bbox = rgba.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
if bbox:
    rgba = rgba.crop(bbox)
W, H = rgba.size
print(f"Transparent logo: {W}x{H}  (aspect {W/H:.3f})")
rgba.save(f"{OUT}/logo.png")

# ── 3. dark-theme recolor: slate grey -> warm cream, gold untouched ────
dark = rgba.copy()
dp = dark.load()
for y in range(H):
    for x in range(W):
        r, g, b, a = dp[x, y]
        if a == 0:
            continue
        mx, mn = max(r, g, b), min(r, g, b)
        if mx - mn < 30:  # grey family -> scale luminance toward cream
            lum = 0.299*r + 0.587*g + 0.114*b
            factor = CREAM[0] / max(1.0, 0.299*SLATE[0] + 0.587*SLATE[1] + 0.114*SLATE[2])
            nl = min(255.0, lum * factor)
            ratio = nl / lum if lum > 1 else 1.0
            dp[x, y] = (int(r*ratio), int(g*ratio), int(b*ratio), a)
        # saturated (gold) pixels stay as-is
dark.save(f"{OUT}/logo-dark.png")

# ── 4. mark-only crops (hexagon without the wordmark) ──────────────────
# find the horizontal gap between the mark and the EGXDESK text
def row_content_ratio(y):
    cnt = 0
    for x in range(0, W, 6):
        if p[x, y][3] > 100:
            cnt += 1
    return cnt / (W // 6)

gap_lo = gap_hi = None
for y in range(int(H*0.30), int(H*0.75)):
    if row_content_ratio(y) < 0.02:
        if gap_lo is None:
            gap_lo = y
        gap_hi = y
    elif gap_lo is not None and y - (gap_hi or gap_lo) > 6:
        break
print(f"mark/text gap rows: {gap_lo}..{gap_hi} ({(gap_lo or 0)/H:.1%} of height)")
if gap_lo and gap_hi:
    mark = rgba.crop((0, 0, W, gap_lo))
    mb = mark.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if mb:
        mark = mark.crop(mb)
    mark.save(f"{OUT}/logo-mark.png")
    mark_dark = dark.crop((0, 0, W, gap_lo))
    if mb:
        mark_dark = mark_dark.crop(mb)
    mark_dark.save(f"{OUT}/logo-mark-dark.png")
    print(f"mark-only: {mark.size[0]}x{mark.size[1]} (aspect {mark.size[0]/mark.size[1]:.3f})")
else:
    # fallback: no gap detected — degrade to the full logo rather than crash
    mark, mark_dark = rgba, dark
    print("WARN: mark/text gap not found — icons will use the full logo")

# ── 5. favicons: dark charcoal tile + cream/gold MARK ONLY ───────────────
# Task 24 fix: the icons used to composite the FULL mark+wordmark logo,
# which at 16–192 px reads as the whole shrunken photo (unreadable "EGXDesk"
# text). A favicon carries the hexagon mark alone — the wordmark already
# lives in the header/footer logo and the manifest name.
TILE = (44, 44, 46)  # matches the app's dark theme canvas

def make_icon(size, content_scale=0.74, rounded=None, path=None):
    """Composite mark_dark onto a charcoal tile, fitted INSIDE a
    content_scale×content_scale box (mark is taller than wide, so the fit
    is driven by its height — never distorted, never cropped)."""
    mw, mh = mark_dark.size
    box = size * content_scale
    s = min(box / mw, box / mh)
    cw, ch = max(1, int(mw * s)), max(1, int(mh * s))
    tile = Image.new("RGBA", (size, size), (*TILE, 255))
    content = mark_dark.resize((cw, ch), Image.LANCZOS)
    ox = (size - cw) // 2
    oy = (size - ch) // 2
    tile.alpha_composite(content, (ox, oy))
    if rounded:  # rounded-corner mask (plain icons)
        mask = Image.new("L", (size, size), 0)
        from PIL import ImageDraw
        d = ImageDraw.Draw(mask)
        d.rounded_rectangle([0, 0, size-1, size-1], radius=rounded, fill=255)
        tile.putalpha(mask)
    tile.save(path)
    print(f"icon {path}: {size}x{size} (mark {cw}x{ch}, aspect {cw/ch:.3f})")
    return tile

make_icon(512, 0.74, rounded=96, path=f"{OUT}/icon-512.png")
make_icon(192, 0.74, rounded=36, path=f"{OUT}/icon-192.png")
make_icon(180, 0.74, rounded=34, path=f"{OUT}/apple-touch-icon.png")
make_icon(512, 0.56, rounded=None, path=f"{OUT}/icon-512-maskable.png")  # safe zone

# ── 6. QA: the icon content must be the MARK (taller than wide), not the
# full logo (wide). Scan icon-192 for non-tile pixels and assert the aspect.
iq = Image.open(f"{OUT}/icon-192.png").convert("RGBA")
qx = iq.load()
iw, ih = iq.size
xs, ys, xe, ye = iw, ih, 0, 0
for y in range(0, ih):
    for x in range(0, iw):
        r, g, b, a = qx[x, y]
        if a > 200 and (abs(r-44) > 24 or abs(g-44) > 24 or abs(b-46) > 24):
            xs, ys = min(xs, x), min(ys, y)
            xe, ye = max(xe, x), max(ye, y)
if xe > xs and ye > ys:
    cw_, ch_ = xe - xs + 1, ye - ys + 1
    print(f"QA icon-192 content bbox: {cw_}x{ch_} (aspect {cw_/ch_:.3f})")
    assert cw_ / ch_ < 1.0, "favicon content is WIDER than tall — looks like the full logo, not the mark!"
    print("QA PASS: favicon carries the mark only (no wordmark)")
else:
    raise SystemExit("QA FAIL: no content found in icon-192")

print("\nAll assets written to public/")

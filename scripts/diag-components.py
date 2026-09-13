#!/usr/bin/env python3
"""Connected-component analysis of logo-mark-dark.png alpha channel:
find the hexagon (big component) vs the leaked 'DESK' text fragments."""
from PIL import Image
import sys

try:
    import numpy as np
except ImportError:
    sys.exit("numpy missing")

im = Image.open("/home/z/my-project/public/logo-mark-dark.png").convert("RGBA")
W, H = im.size
a = np.array(im)[:, :, 3] > 100  # opaque mask

# simple two-pass labeling via BFS
from collections import deque
labels = np.zeros((H, W), dtype=np.int32)
comps = []
cur = 0
for y in range(H):
    for x in range(W):
        if a[y, x] and labels[y, x] == 0:
            cur += 1
            q = deque([(y, x)])
            labels[y, x] = cur
            n = 0
            x0 = x1 = x
            y0 = y1 = y
            while q:
                cy, cx = q.popleft()
                n += 1
                x0, x1 = min(x0, cx), max(x1, cx)
                y0, y1 = min(y0, cy), max(y1, cy)
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and a[ny, nx] and labels[ny, nx] == 0:
                        labels[ny, nx] = cur
                        q.append((ny, nx))
            comps.append((n, x0, y0, x1, y1))

comps.sort(reverse=True)
print(f"{len(comps)} components in {W}x{H} mark:")
for n, x0, y0, x1, y1 in comps[:25]:
    w, h = x1 - x0 + 1, y1 - y0 + 1
    print(f"  px={n:7d}  bbox=({x0},{y0})-({x1},{y1})  {w}x{h}  at {x0/W:.0%}W {y0/H:.0%}H")

# also do it for the FULL logo to understand the lockup layout
im2 = Image.open("/home/z/my-project/public/logo-dark.png").convert("RGBA")
W2, H2 = im2.size
a2 = np.array(im2)[:, :, 3] > 100
labels2 = np.zeros((H2, W2), dtype=np.int32)
comps2 = []
cur = 0
for y in range(H2):
    for x in range(W2):
        if a2[y, x] and labels2[y, x] == 0:
            cur += 1
            q = deque([(y, x)])
            labels2[y, x] = cur
            n = 0
            x0 = x1 = x
            y0 = y1 = y
            while q:
                cy, cx = q.popleft()
                n += 1
                x0, x1 = min(x0, cx), max(x1, cx)
                y0, y1 = min(y0, cy), max(y1, cy)
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H2 and 0 <= nx < W2 and a2[ny, nx] and labels2[ny, nx] == 0:
                        labels2[ny, nx] = cur
                        q.append((ny, nx))
            comps2.append((n, x0, y0, x1, y1))
comps2.sort(reverse=True)
print(f"\n{len(comps2)} components in {W2}x{H2} FULL logo:")
for n, x0, y0, x1, y1 in comps2[:25]:
    w, h = x1 - x0 + 1, y1 - y0 + 1
    print(f"  px={n:7d}  bbox=({x0},{y0})-({x1},{y1})  {w}x{h}  at {x0/W2:.0%}W {y0/H2:.0%}H")

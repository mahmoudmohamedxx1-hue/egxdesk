#!/usr/bin/env python3
"""Crop suspicious regions of the mark and upscale for VLM inspection."""
from PIL import Image

im = Image.open("/home/z/my-project/public/logo-mark-dark.png").convert("RGBA")
W, H = im.size  # 758x873

crops = {
    "mark-bottom-right": (W // 2, int(H * 0.62), W, H),      # bottom-right quadrant
    "mark-bottom-strip": (0, int(H * 0.70), W, H),            # bottom 30% full width
    "mark-full": (0, 0, W, H),
}
for name, box in crops.items():
    c = im.crop(box)
    c = c.resize((c.width * 3, c.height * 3), Image.LANCZOS)  # upscale for clarity
    # white bg composite so transparency doesn't confuse the VLM
    bg = Image.new("RGBA", c.size, (44, 44, 46, 255))
    bg.alpha_composite(c)
    bg.convert("RGB").save(f"/home/z/my-project/scripts/data-test/diag-{name}.png")
    print(f"saved diag-{name}.png {bg.size}")

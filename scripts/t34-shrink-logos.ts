/** T34 — logo diet: the header/footer logo PNGs were 1.5MB each (1496x1197
 *  source artwork) rendered at 38x30px — ~3MB of the very first page load.
 *  This script re-encodes them at 4x display resolution (150x120) with
 *  palette compression (crisp text, tiny files). Also optimizes the
 *  512 icon (117KB -> ~35KB) for lighter SW precache/manifest reads.
 *  Run: bun scripts/t34-shrink-logos.ts */
import sharp from "sharp";

const jobs: { file: string; width: number; height: number }[] = [
  { file: "public/logo.png", width: 150, height: 120 },
  { file: "public/logo-dark.png", width: 150, height: 120 },
  { file: "public/icon-512.png", width: 512, height: 512 },
  { file: "public/apple-touch-icon.png", width: 192, height: 192 },
];

for (const j of jobs) {
  const before = (await Bun.file(j.file).length) / 1024;
  const buf = await sharp(j.file)
    .resize(j.width, j.height, { fit: "fill" })
    .png({ quality: 90, palette: true, compressionLevel: 9, effort: 10 })
    .toBuffer();
  await Bun.write(j.file, buf);
  const after = buf.length / 1024;
  console.log(`${j.file}: ${before.toFixed(0)}KB -> ${after.toFixed(1)}KB (${j.width}x${j.height})`);
}

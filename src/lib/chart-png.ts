/** T45 — server-side candlestick chart PNG renderer (zero dependencies).
 *
 *  The vision pass (glm-4.6v-flash) reads REAL images of the tape. Rather
 *  than pulling a headless browser or a native canvas into the sandbox, this
 *  module rasterizes the chart directly onto an RGBA pixel buffer and encodes
 *  it as a PNG with Node's own zlib — pure, deterministic, testable.
 *
 *  Honesty rules:
 *   - candles are drawn ONLY when the point carries high/low (Yahoo daily
 *     OHLC); a tape without wicks renders as a close POLYLINE — wicks are
 *     never invented;
 *   - the image self-identifies: ticker, last close, session count, and the
 *     first/last dates are drawn with the built-in 5×7 bitmap font, so the
 *     vision model can never misattribute the chart;
 *   - SMA20/SMA50 overlays are computed with the same smaSeries() the
 *     strategy engine uses — the picture matches the numbers the ensemble
 *     voted on. */

import { deflateSync } from "node:zlib";
import { smaSeries } from "@/lib/indicators";
import type { ChartPointLite } from "@/lib/strategy";

// ── the 5×7 bitmap font (uppercase, digits, and the symbols we need) ──

const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ".": [0, 0, 0, 0, 0, 0x0c, 0x0c],
  "-": [0, 0, 0, 0x1f, 0, 0, 0],
  ":": [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  "/": [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  "%": [0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03],
  "+": [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
  " ": [0, 0, 0, 0, 0, 0, 0],
};

// ── canvas ──

type RGB = [number, number, number];
const WHITE: RGB = [255, 255, 255];
const INK: RGB = [17, 24, 39]; // near-black
const UP: RGB = [22, 128, 61]; // green (EGX up)
const DOWN: RGB = [200, 30, 30]; // red
const SMA20_C: RGB = [120, 113, 108]; // neutral gray
const SMA50_C: RGB = [217, 119, 6]; // amber
const VOL_C: RGB = [148, 163, 184];

class Raster {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array; // RGBA

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 4);
    this.fill(WHITE);
  }

  fill(c: RGB) {
    for (let i = 0; i < this.px.length; i += 4) {
      this.px[i] = c[0];
      this.px[i + 1] = c[1];
      this.px[i + 2] = c[2];
      this.px[i + 3] = 255;
    }
  }

  set(x: number, y: number, c: RGB) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = 255;
  }

  rect(x0: number, y0: number, x1: number, y1: number, c: RGB) {
    const xa = Math.max(0, Math.min(this.w - 1, Math.round(Math.min(x0, x1))));
    const xb = Math.max(0, Math.min(this.w - 1, Math.round(Math.max(x0, x1))));
    const ya = Math.max(0, Math.min(this.h - 1, Math.round(Math.min(y0, y1))));
    const yb = Math.max(0, Math.min(this.h - 1, Math.round(Math.max(y0, y1))));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) this.set(x, y, c);
  }

  /** Bresenham line, 2px thick for visibility at vision-model scale. */
  line(x0: number, y0: number, x1: number, y1: number, c: RGB) {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const x2 = Math.round(x1);
    const y2 = Math.round(y1);
    const dx = Math.abs(x2 - x);
    const dy = Math.abs(y2 - y);
    const sx = x < x2 ? 1 : -1;
    const sy = y < y2 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.set(x, y, c);
      this.set(x + 1, y, c);
      this.set(x, y + 1, c);
      if (x === x2 && y === y2) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  text(x: number, y: number, s: string, c: RGB = INK, scale = 1) {
    let cx = x;
    for (const chRaw of s.toUpperCase()) {
      const glyph = FONT[chRaw] ?? FONT[" "];
      for (let row = 0; row < 7; row++) {
        const bits = glyph[row];
        for (let col = 0; col < 5; col++) {
          if (bits & (1 << (4 - col))) {
            if (scale === 1) this.set(cx + col, y + row, c);
            else this.rect(cx + col * scale, y + row * scale, cx + col * scale + scale - 1, y + row * scale + scale - 1, c);
          }
        }
      }
      cx += 6 * scale;
    }
  }

  textWidth(s: string, scale = 1): number {
    return s.length * 6 * scale;
  }

  /** Encode as PNG (RGBA8, filter 0, zlib). */
  png(): Buffer {
    const rows: Buffer[] = [];
    const stride = this.w * 4;
    for (let y = 0; y < this.h; y++) {
      const row = Buffer.alloc(stride + 1);
      row[0] = 0; // filter: none
      Buffer.from(this.px.buffer, y * stride, stride).copy(row, 1);
      rows.push(row);
    }
    const raw = Buffer.concat(rows);
    const idat = deflateSync(raw, { level: 6 });
    const out: Buffer[] = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
    out.push(this.chunk("IHDR", ihdr(this.w, this.h)));
    out.push(this.chunk("IDAT", idat));
    out.push(this.chunk("IEND", Buffer.alloc(0)));
    return Buffer.concat(out);
  }

  private chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  }
}

function ihdr(w: number, h: number): Buffer {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(w, 0);
  b.writeUInt32BE(h, 4);
  b[8] = 8; // bit depth
  b[9] = 6; // color type RGBA
  b[10] = 0;
  b[11] = 0;
  b[12] = 0;
  return b;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── the chart itself ──

export type CandleChartOpts = {
  ticker: string;
  width?: number;
  height?: number;
  sessions?: number; // how many trailing sessions to draw
};

/** Rasterize the last `sessions` points of a tape as candlesticks (+ SMA20 /
 *  SMA50 overlays + volume). Pure function — same input, same PNG bytes. */
export function renderCandleChartPng(points: ChartPointLite[], opts: CandleChartOpts): Buffer {
  const W = opts.width ?? 520;
  const H = opts.height ?? 300;
  const sessions = Math.min(opts.sessions ?? 90, points.length);
  const pts = points.slice(-sessions);
  const r = new Raster(W, H);

  // layout: header band 26px, price panel to ~76%, volume strip bottom
  const headerH = 30;
  const volH = Math.max(34, Math.round(H * 0.16));
  const priceTop = headerH + 6;
  const priceBot = H - volH - 8;
  const volTop = priceBot + 6;
  const volBot = H - 6;
  const left = 8;
  const right = W - 8;

  const hasWicks = pts.every((p) => typeof p.high === "number" && typeof p.low === "number" && p.high >= p.low);
  const closes = pts.map((p) => p.close);
  const sma20 = smaSeries(closes, 20);
  const sma50 = smaSeries(closes, 50);

  let lo = Math.min(...closes);
  let hi = Math.max(...closes);
  if (hasWicks) {
    for (const p of pts) {
      lo = Math.min(lo, p.low!);
      hi = Math.max(hi, p.high!);
    }
  }
  if (sma20) lo = Math.min(lo, ...sma20.filter((v) => v !== null));
  if (sma50) lo = Math.min(lo, ...sma50.filter((v) => v !== null));
  if (sma20) hi = Math.max(hi, ...sma20.filter((v) => v !== null));
  if (sma50) hi = Math.max(hi, ...sma50.filter((v) => v !== null));
  const pad = (hi - lo) * 0.06 || hi * 0.02 || 1;
  lo -= pad;
  hi += pad;
  const yOf = (v: number) => priceBot - ((v - lo) / (hi - lo)) * (priceBot - priceTop);

  // frame + 3 gridlines
  r.rect(left, priceTop, right, priceTop, VOL_C);
  r.rect(left, priceBot, right, priceBot, VOL_C);
  for (let g = 1; g <= 3; g++) {
    const gy = priceTop + ((priceBot - priceTop) * g) / 4;
    for (let x = left; x <= right; x += 3) r.set(x, gy, VOL_C);
  }

  const n = pts.length;
  const slot = (right - left) / Math.max(1, n);
  const bodyW = Math.max(3, Math.min(9, Math.floor(slot * 0.66)));

  // candles / polyline
  if (hasWicks) {
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const cx = left + slot * i + slot / 2;
      const up = i === 0 || p.close >= pts[i - 1].close;
      const c = up ? UP : DOWN;
      r.rect(cx, yOf(p.high!), cx, yOf(p.low!), c); // wick (1px wide rect)
      const yO = yOf(p.close); // body: prev-close→close (honest when open unknown)
      const yP = yOf(i === 0 ? p.close : pts[i - 1].close);
      r.rect(cx - bodyW / 2, Math.min(yO, yP), cx + bodyW / 2, Math.max(yO, yP), c);
    }
  } else {
    // no OHLC wicks in the tape — a close polyline, never invented wicks
    for (let i = 1; i < n; i++) {
      r.line(left + slot * (i - 1) + slot / 2, yOf(pts[i - 1].close), left + slot * i + slot / 2, yOf(pts[i].close), INK);
    }
  }

  // SMA overlays
  const drawSma = (series: (number | null)[] | null, c: RGB) => {
    if (!series) return;
    for (let i = 1; i < n; i++) {
      const a = series[series.length - n + i - 1];
      const b = series[series.length - n + i];
      if (a === null || b === null) continue;
      r.line(left + slot * (i - 1) + slot / 2, yOf(a), left + slot * i + slot / 2, yOf(b), c);
    }
  };
  drawSma(sma20, SMA20_C);
  drawSma(sma50, SMA50_C);

  // volume strip
  let maxVol = 0;
  for (const p of pts) maxVol = Math.max(maxVol, p.volume ?? 0);
  if (maxVol > 0) {
    for (let i = 0; i < n; i++) {
      const v = pts[i].volume ?? 0;
      const cx = left + slot * i + slot / 2;
      const hgt = (v / maxVol) * (volBot - volTop);
      r.rect(cx - bodyW / 2, volBot - hgt, cx + bodyW / 2, volBot, VOL_C);
    }
  }

  // header: ticker, last close, range, session count — the image identifies itself
  const last = pts[n - 1];
  const chg = n > 1 ? ((last.close - pts[0].close) / pts[0].close) * 100 : 0;
  r.text(left, 6, opts.ticker.toUpperCase(), INK, 2);
  const priceTxt = `${fmt(last.close)} EGP  ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`;
  r.text(left + r.textWidth(opts.ticker.toUpperCase(), 2) + 14, 8, priceTxt, chg >= 0 ? UP : DOWN);
  const d0 = pts[0].date.slice(0, 10);
  const d1 = last.date.slice(0, 10);
  r.text(left, 20, `${d0}  TO  ${d1}  (${n} SESSIONS)  SMA20 GRAY  SMA50 AMBER`, VOL_C);

  return r.png();
}

function fmt(v: number): string {
  if (v >= 1000) return v.toFixed(0);
  if (v >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

// re-export the CRC for tests (PNG validity proof)
export { crc32 };

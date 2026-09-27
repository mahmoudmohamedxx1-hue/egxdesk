/** Shared client-side technical-indicator math — one source of truth used by
 *  both the interactive price chart (overlays/sub-panels) and the technical
 *  analysis summary (ratings). All series are aligned to the input array:
 *  index i is the indicator value AT that bar, or null where not yet defined
 *  (insufficient lookback). Standard definitions, no smoothing shortcuts. */

// ── moving averages ──

export function smaSeries(v: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= n) sum -= v[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

export function emaFull(v: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  if (v.length < n) return out;
  const k = 2 / (n + 1);
  let seed = 0;
  for (let i = 0; i < n; i++) seed += v[i];
  let prev = seed / n;
  out[n - 1] = prev;
  for (let i = n; i < v.length; i++) {
    prev = v[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** EMA over a series that may start with nulls (MACD line). */
export function emaSparse(v: (number | null)[], n: number): (number | null)[] {
  const idx: number[] = [];
  const vals: number[] = [];
  v.forEach((x, i) => {
    if (x !== null && x !== undefined && Number.isFinite(x)) {
      idx.push(i);
      vals.push(x);
    }
  });
  const out: (number | null)[] = new Array(v.length).fill(null);
  if (vals.length < n) return out;
  const k = 2 / (n + 1);
  let seed = 0;
  for (let j = 0; j < n; j++) seed += vals[j];
  let prev = seed / n;
  out[idx[n - 1]] = prev;
  for (let j = n; j < vals.length; j++) {
    prev = vals[j] * k + prev * (1 - k);
    out[idx[j]] = prev;
  }
  return out;
}

export function bollingerSeries(v: number[], n = 20, k = 2) {
  const mid: (number | null)[] = [];
  const up: (number | null)[] = [];
  const lo: (number | null)[] = [];
  for (let i = 0; i < v.length; i++) {
    if (i < n - 1) {
      mid.push(null);
      up.push(null);
      lo.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += v[j];
    const m = sum / n;
    let sq = 0;
    for (let j = i - n + 1; j <= i; j++) sq += (v[j] - m) ** 2;
    const sd = Math.sqrt(sq / n);
    mid.push(m);
    up.push(m + k * sd);
    lo.push(m - k * sd);
  }
  return { mid, up, lo };
}

// ── oscillators ──

export function rsiSeries(v: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  if (v.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const ch = v[i] - v[i - 1];
    gain += Math.max(ch, 0) / n;
    loss += Math.max(-ch, 0) / n;
  }
  const rsi = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[n] = rsi(gain, loss);
  for (let i = n + 1; i < v.length; i++) {
    const ch = v[i] - v[i - 1];
    gain = (gain * (n - 1) + Math.max(ch, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-ch, 0)) / n;
    out[i] = rsi(gain, loss);
  }
  return out;
}

export function macdSeries(v: number[], fast = 12, slow = 26, sig = 9) {
  const ef = emaFull(v, fast);
  const es = emaFull(v, slow);
  const macd: (number | null)[] = [];
  for (let i = 0; i < v.length; i++) {
    const a = ef[i];
    const b = es[i];
    macd.push(a !== null && b !== null ? a - b : null);
  }
  const signal = emaSparse(macd, sig);
  const hist: (number | null)[] = [];
  for (let i = 0; i < v.length; i++) {
    const m = macd[i];
    const s = signal[i];
    hist.push(m !== null && s !== null ? m - s : null);
  }
  return { macd, signal, hist };
}

/** Slow stochastic: raw %K over n bars (of high/low window), then %K = 3-bar
 *  SMA of raw, %D = 3-bar SMA of %K. Falls back to close-only windows when
 *  candle highs/lows are unavailable (weekly candles, index series). */
export function stochasticSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[],
  n = 14,
  smoothK = 3,
  smoothD = 3
) {
  const raw: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    let ok = true;
    for (let j = i - n + 1; j <= i; j++) {
      const h = highs[j] ?? closes[j];
      const l = lows[j] ?? closes[j];
      if (!Number.isFinite(h) || !Number.isFinite(l)) {
        ok = false;
        break;
      }
      if (h > hh) hh = h;
      if (l < ll) ll = l;
    }
    if (!ok) continue;
    const span = hh - ll;
    raw[i] = span > 0 ? ((closes[i] - ll) / span) * 100 : 50;
  }
  // %K = SMA(raw, 3) over non-null tail
  const k = smaSparse(raw, smoothK);
  const d = smaSparse(k, smoothD);
  return { k, d };
}

/** SMA over a series containing nulls (skips leading nulls, returns null
 *  where fewer than `n` finite values exist in the contiguous tail). */
export function smaSparse(v: (number | null)[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  const idx: number[] = [];
  const vals: number[] = [];
  v.forEach((x, i) => {
    if (x !== null && x !== undefined && Number.isFinite(x)) {
      idx.push(i);
      vals.push(x);
    }
  });
  if (vals.length < n) return out;
  let sum = 0;
  for (let j = 0; j < n; j++) sum += vals[j];
  out[idx[n - 1]] = sum / n;
  for (let j = n; j < vals.length; j++) {
    sum += vals[j] - vals[j - n];
    out[idx[j]] = sum / n;
  }
  return out;
}

/** CCI (Commodity Channel Index) over typical price HLC; close-only fallback. */
export function cciSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[],
  n = 20
): (number | null)[] {
  const tp: (number | null)[] = closes.map((c, i) => {
    const h = highs[i];
    const l = lows[i];
    if (h != null && l != null && Number.isFinite(h) && Number.isFinite(l)) return (h + l + c) / 3;
    return c;
  });
  const out: (number | null)[] = new Array(closes.length).fill(null);
  const idx: number[] = [];
  const vals: number[] = [];
  tp.forEach((x, i) => {
    if (x !== null && Number.isFinite(x)) {
      idx.push(i);
      vals.push(x);
    }
  });
  if (vals.length < n) return out;
  for (let j = n - 1; j < vals.length; j++) {
    let mean = 0;
    for (let k = j - n + 1; k <= j; k++) mean += vals[k];
    mean /= n;
    let dev = 0;
    for (let k = j - n + 1; k <= j; k++) dev += Math.abs(vals[k] - mean);
    dev /= n;
    const i = idx[j];
    out[i] = dev > 0 ? (vals[j] - mean) / (0.015 * dev) : 0;
  }
  return out;
}

/** Momentum: close now minus close n bars ago. */
export function momentumSeries(v: number[], n = 10): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  for (let i = n; i < v.length; i++) out[i] = v[i] - v[i - n];
  return out;
}

/** Williams %R: ((HH - close) / (HH - LL)) × -100 over n bars. */
export function williamsRSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[],
  n = 14
): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      const h = highs[j] ?? closes[j];
      const l = lows[j] ?? closes[j];
      if (h > hh) hh = h;
      if (l < ll) ll = l;
    }
    const span = hh - ll;
    out[i] = span > 0 ? ((hh - closes[i]) / span) * -100 : -50;
  }
  return out;
}

/** Bull Bear Power: close minus EMA(13). */
export function bullBearSeries(v: number[], n = 13): (number | null)[] {
  const ema = emaFull(v, n);
  return v.map((c, i) => (ema[i] !== null ? c - (ema[i] as number) : null));
}

/** Classic pivot points from the previous session's H/L/C. */
export function classicPivots(h: number, l: number, c: number) {
  const p = (h + l + c) / 3;
  return {
    r3: h + 2 * (p - l),
    r2: p + (h - l),
    r1: 2 * p - l,
    p,
    s1: 2 * p - h,
    s2: p - (h - l),
    s3: l - 2 * (h - p),
  };
}

// ═════════════════════ advanced indicators (T26) ════════════════════════
// All series stay aligned to the input arrays; null until lookback is met.
// High/low inputs may carry nulls (weekly candles / index series) — the
// functions fall back to the close where the candle extremes are missing.

/** Wilder smoothing (RMA): running average where each step is
 *  prev + (x - prev) / n; seeded by a plain SMA of the first n values. */
function wilder(v: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  if (v.length < n) return out;
  let seed = 0;
  for (let i = 0; i < n; i++) seed += v[i];
  let prev = seed / n;
  out[n - 1] = prev;
  for (let i = n; i < v.length; i++) {
    prev = prev + (v[i] - prev) / n;
    out[i] = prev;
  }
  return out;
}

const hl = (h: (number | null) | undefined, l: (number | null) | undefined, c: number): [number, number] =>
  [h != null && Number.isFinite(h) ? h : c, l != null && Number.isFinite(l) ? l : c];

/** True Range series. */
export function trueRangeSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[]
): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 1; i < closes.length; i++) {
    const [h, l] = hl(highs[i], lows[i], closes[i]);
    const [ph] = hl(highs[i - 1], lows[i - 1], closes[i - 1]);
    out[i] = Math.max(h - l, Math.abs(h - closes[i - 1]), Math.abs(l - closes[i - 1]));
  }
  return out;
}

/** Average True Range (Wilder, n=14). */
export function atrSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[],
  n = 14
): (number | null)[] {
  const tr = trueRangeSeries(highs, lows, closes);
  const idx: number[] = [];
  const vals: number[] = [];
  tr.forEach((x, i) => {
    if (x !== null && Number.isFinite(x)) {
      idx.push(i);
      vals.push(x);
    }
  });
  const w = wilder(vals, n);
  const out: (number | null)[] = new Array(closes.length).fill(null);
  w.forEach((x, j) => {
    if (x !== null) out[idx[j]] = x;
  });
  return out;
}

/** Average Directional Index with +DI / −DI (Wilder, n=14). */
export function adxSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[],
  n = 14
): { adx: (number | null)[]; pdi: (number | null)[]; mdi: (number | null)[] } {
  const len = closes.length;
  const pdm: (number | null)[] = new Array(len).fill(null);
  const mdm: (number | null)[] = new Array(len).fill(null);
  const tr: (number | null)[] = new Array(len).fill(null);
  for (let i = 1; i < len; i++) {
    const [h, l] = hl(highs[i], lows[i], closes[i]);
    const [ph, pl] = hl(highs[i - 1], lows[i - 1], closes[i - 1]);
    const up = h - ph;
    const dn = pl - l;
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = Math.max(h - l, Math.abs(h - closes[i - 1]), Math.abs(l - closes[i - 1]));
  }
  const smooth = (arr: (number | null)[]) => {
    const idx: number[] = [];
    const vals: number[] = [];
    arr.forEach((x, i) => {
      if (x !== null && Number.isFinite(x)) {
        idx.push(i);
        vals.push(x);
      }
    });
    const w = wilder(vals, n);
    const out: (number | null)[] = new Array(len).fill(null);
    w.forEach((x, j) => {
      if (x !== null) out[idx[j]] = x;
    });
    return { out, firstIdx: idx[n - 1] };
  };
  const sp = smooth(pdm);
  const sm = smooth(mdm);
  const st = smooth(tr);
  const pdi: (number | null)[] = new Array(len).fill(null);
  const mdi: (number | null)[] = new Array(len).fill(null);
  const dx: (number | null)[] = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const t = st.out[i];
    const p = sp.out[i];
    const m = sm.out[i];
    if (t !== null && t > 0) {
      if (p !== null) pdi[i] = (p / t) * 100;
      if (m !== null) mdi[i] = (m / t) * 100;
      const a = pdi[i];
      const b = mdi[i];
      if (a !== null && b !== null && a + b > 0) dx[i] = (Math.abs(a - b) / (a + b)) * 100;
    }
  }
  // ADX = Wilder smoothing of DX (first value = mean of first n DX values)
  const dxIdx: number[] = [];
  const dxVals: number[] = [];
  dx.forEach((x, i) => {
    if (x !== null && Number.isFinite(x)) {
      dxIdx.push(i);
      dxVals.push(x);
    }
  });
  const adx: (number | null)[] = new Array(len).fill(null);
  if (dxVals.length >= n) {
    let seed = 0;
    for (let j = 0; j < n; j++) seed += dxVals[j];
    let prev = seed / n;
    adx[dxIdx[n - 1]] = prev;
    for (let j = n; j < dxVals.length; j++) {
      prev = prev + (dxVals[j] - prev) / n;
      adx[dxIdx[j]] = prev;
    }
  }
  return { adx, pdi, mdi };
}

/** On-Balance Volume. Volume may be null (index series) — treated as 0. */
export function obvSeries(closes: number[], volumes: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let obv = 0;
  out[0] = 0;
  for (let i = 1; i < closes.length; i++) {
    const v = volumes[i];
    const vol = v !== null && v !== undefined && Number.isFinite(v) ? v : 0;
    obv += closes[i] > closes[i - 1] ? vol : closes[i] < closes[i - 1] ? -vol : 0;
    out[i] = obv;
  }
  return out;
}

/** Cumulative (window-anchored) VWAP — one number per bar from window start. */
export function vwapSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[],
  volumes: (number | null)[]
): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let pv = 0;
  let vv = 0;
  for (let i = 0; i < closes.length; i++) {
    const [h, l] = hl(highs[i], lows[i], closes[i]);
    const tp = (h + l + closes[i]) / 3;
    const v = volumes[i];
    const vol = v !== null && v !== undefined && Number.isFinite(v) ? v : 0;
    pv += tp * vol;
    vv += vol;
    out[i] = vv > 0 ? pv / vv : null;
  }
  return out;
}

/** Money Flow Index (n=14). */
export function mfiSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[],
  volumes: (number | null)[],
  n = 14
): (number | null)[] {
  const len = closes.length;
  const tp: number[] = closes.map((c, i) => {
    const [h, l] = hl(highs[i], lows[i], c);
    return (h + l + c) / 3;
  });
  const out: (number | null)[] = new Array(len).fill(null);
  for (let i = n; i < len; i++) {
    let pos = 0;
    let neg = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const v = volumes[j];
      const vol = v !== null && v !== undefined && Number.isFinite(v) ? v : 0;
      const flow = tp[j] * vol;
      if (tp[j] > tp[j - 1]) pos += flow;
      else if (tp[j] < tp[j - 1]) neg += flow;
    }
    out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  return out;
}

/** Stochastic RSI: raw stoch of RSI(14) over 14, %K = SMA(3), %D = SMA(3). */
export function stochRsiSeries(
  closes: number[],
  rsiN = 14,
  stochN = 14,
  smoothK = 3,
  smoothD = 3
): { k: (number | null)[]; d: (number | null)[] } {
  const rsi = rsiSeries(closes, rsiN);
  const raw: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    // need stochN consecutive finite RSI values ending at i
    let ok = true;
    for (let j = i - stochN + 1; j <= i; j++) {
      if (j < 0 || rsi[j] === null || !Number.isFinite(rsi[j] as number)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - stochN + 1; j <= i; j++) {
      const r = rsi[j] as number;
      if (r > hh) hh = r;
      if (r < ll) ll = r;
    }
    const span = hh - ll;
    raw[i] = span > 0 ? ((rsi[i] as number - ll) / span) * 100 : 50;
  }
  const k = smaSparse(raw, smoothK);
  const d = smaSparse(k, smoothD);
  return { k, d };
}

/** Parabolic SAR (Wilder accelerator, step 0.02, max 0.2). */
export function psarSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[],
  step = 0.02,
  max = 0.2
): (number | null)[] {
  const len = closes.length;
  const out: (number | null)[] = new Array(len).fill(null);
  if (len < 3) return out;
  const H = (i: number) => hl(highs[i], lows[i], closes[i])[0];
  const L = (i: number) => hl(highs[i], lows[i], closes[i])[1];
  // seed: first two bars decide the initial direction
  let up = closes[1] >= closes[0];
  let af = step;
  let ep = up ? H(1) : L(1); // extreme point
  let sar = up ? L(0) : H(0);
  out[1] = sar;
  for (let i = 2; i < len; i++) {
    sar = sar + af * (ep - sar);
    // SAR may not enter the previous bar's range
    if (up) sar = Math.min(sar, L(i - 1), L(i - 2));
    else sar = Math.max(sar, H(i - 1), H(i - 2));
    const h = H(i);
    const l = L(i);
    if (up) {
      if (l < sar) {
        // reversal to downtrend
        up = false;
        sar = ep; // new SAR = previous EP
        ep = l;
        af = step;
      } else if (h > ep) {
        ep = h;
        af = Math.min(af + step, max);
      }
    } else {
      if (h > sar) {
        up = true;
        sar = ep;
        ep = h;
        af = step;
      } else if (l < ep) {
        ep = l;
        af = Math.min(af + step, max);
      }
    }
    out[i] = sar;
  }
  return out;
}

/** SuperTrend (ATR-based, n=10, mult=3): trend = +1 long / −1 short. */
export function superTrendSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[],
  n = 10,
  mult = 3
): { trend: (number | null)[]; line: (number | null)[] } {
  const len = closes.length;
  const atr = atrSeries(highs, lows, closes, n);
  const trend: (number | null)[] = new Array(len).fill(null);
  const line: (number | null)[] = new Array(len).fill(null);
  let dir: 1 | -1 = 1;
  let upperPrev = NaN;
  let lowerPrev = NaN;
  for (let i = 0; i < len; i++) {
    const a = atr[i];
    if (a === null) continue;
    const [h, l] = hl(highs[i], lows[i], closes[i]);
    const mid = (h + l) / 2;
    let upper = mid + mult * a;
    let lower = mid - mult * a;
    if (Number.isFinite(upperPrev)) {
      // bands close in unless price broke them
      upper = closes[i - 1] > upperPrev ? upper : Math.min(upper, upperPrev);
      lower = closes[i - 1] < lowerPrev ? lower : Math.max(lower, lowerPrev);
    }
    if (!Number.isFinite(upperPrev)) {
      dir = closes[i] >= mid ? 1 : -1;
    } else if (dir === 1 && closes[i] < lower) dir = -1;
    else if (dir === -1 && closes[i] > upper) dir = 1;
    trend[i] = dir;
    line[i] = dir === 1 ? lower : upper;
    upperPrev = upper;
    lowerPrev = lower;
  }
  return { trend, line };
}

/** Donchian channel (n=20): upper / mid / lower of the high-low range. */
export function donchianSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[],
  n = 20
): { up: (number | null)[]; mid: (number | null)[]; lo: (number | null)[] } {
  const len = closes.length;
  const up: (number | null)[] = new Array(len).fill(null);
  const lo: (number | null)[] = new Array(len).fill(null);
  const mid: (number | null)[] = new Array(len).fill(null);
  for (let i = n - 1; i < len; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      const [h, l] = hl(highs[j], lows[j], closes[j]);
      if (h > hh) hh = h;
      if (l < ll) ll = l;
    }
    up[i] = hh;
    lo[i] = ll;
    mid[i] = (hh + ll) / 2;
  }
  return { up, mid, lo };
}

/** Keltner channel: EMA(20) ± mult × ATR(10). */
export function keltnerSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[],
  emaN = 20,
  atrN = 10,
  mult = 2
): { up: (number | null)[]; mid: (number | null)[]; lo: (number | null)[] } {
  const mid = emaFull(closes, emaN);
  const atr = atrSeries(highs, lows, closes, atrN);
  const up: (number | null)[] = new Array(closes.length).fill(null);
  const lo: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    const m = mid[i];
    const a = atr[i];
    if (m === null || a === null) continue;
    up[i] = m + mult * a;
    lo[i] = m - mult * a;
  }
  return { up, mid, lo };
}

/** Ichimoku Kinko Hyo (9, 26, 52, displacement 26).
 *
 *  Tenkan-sen  = (HH9 + LL9) / 2
 *  Kijun-sen   = (HH26 + LL26) / 2
 *  Senkou A    = (Tenkan + Kijun) / 2, plotted `disp` bars AHEAD
 *  Senkou B    = (HH52 + LL52) / 2, plotted `disp` bars AHEAD
 *  Chikou      = close, plotted `disp` bars BEHIND
 *
 *  Returned arrays are aligned to the DISPLAY axis: spanA[i] / spanB[i] hold
 *  the cloud value at bar i (value computed from bar i−disp; the last `disp`
 *  real values continue into the future via projA / projB so the chart can
 *  draw the classic forward-projected cloud), and chikou[i] = close[i+disp]
 *  (null for the final `disp` bars — the lagging line stops early). */
export function ichimokuSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[],
  tenkanN = 9,
  kijunN = 26,
  spanBN = 52,
  disp = 26
): {
  tenkan: (number | null)[];
  kijun: (number | null)[];
  spanA: (number | null)[];
  spanB: (number | null)[];
  chikou: (number | null)[];
  projA: (number | null)[];
  projB: (number | null)[];
} {
  const len = closes.length;
  const midOf = (n: number): (number | null)[] => {
    const out: (number | null)[] = new Array(len).fill(null);
    for (let i = n - 1; i < len; i++) {
      let hh = -Infinity;
      let ll = Infinity;
      for (let j = i - n + 1; j <= i; j++) {
        const [h, l] = hl(highs[j], lows[j], closes[j]);
        if (h > hh) hh = h;
        if (l < ll) ll = l;
      }
      out[i] = (hh + ll) / 2;
    }
    return out;
  };
  const tenkan = midOf(tenkanN);
  const kijun = midOf(kijunN);
  const spanBRaw = midOf(spanBN);

  const spanA: (number | null)[] = new Array(len).fill(null);
  const spanB: (number | null)[] = new Array(len).fill(null);
  const projA: (number | null)[] = new Array(disp).fill(null);
  const projB: (number | null)[] = new Array(disp).fill(null);
  // displaced spans: display slot i takes the value computed at i − disp
  for (let i = 0; i < len + disp; i++) {
    const src = i - disp;
    if (src < 0) continue;
    const t = tenkan[src];
    const k = kijun[src];
    const b = spanBRaw[src];
    const a = t !== null && k !== null ? (t + k) / 2 : null;
    if (i < len) {
      spanA[i] = a;
      spanB[i] = b;
    } else {
      projA[i - len] = a;
      projB[i - len] = b;
    }
  }
  const chikou: (number | null)[] = new Array(len).fill(null);
  for (let i = 0; i + disp < len; i++) chikou[i] = closes[i + disp];
  return { tenkan, kijun, spanA, spanB, chikou, projA, projB };
}

/** Awesome Oscillator: SMA5(median) − SMA34(median). */
export function awesomeSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[]
): (number | null)[] {
  const med = closes.map((c, i) => {
    const [h, l] = hl(highs[i], lows[i], c);
    return (h + l) / 2;
  });
  const s5 = smaSeries(med, 5);
  const s34 = smaSeries(med, 34);
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    const a = s5[i];
    const b = s34[i];
    out[i] = a !== null && b !== null ? a - b : null;
  }
  return out;
}

/** TRIX: triple-smoothed EMA rate of change, with a 9-signal. */
export function trixSeries(closes: number[], n = 15, sigN = 9): { trix: (number | null)[]; signal: (number | null)[] } {
  const e1 = emaFull(closes, n);
  const e2 = emaSparse(e1, n);
  const e3 = emaSparse(e2, n);
  const trix: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    const a = e3[i];
    const b = i > 0 ? e3[i - 1] : null;
    if (a !== null && b !== null && b !== 0) trix[i] = ((a - b) / b) * 100;
  }
  const signal = emaSparse(trix, sigN);
  return { trix, signal };
}

/** Chande Momentum Oscillator (n=14). */
export function cmoSeries(closes: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = n; i < closes.length; i++) {
    let up = 0;
    let dn = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const ch = closes[j] - closes[j - 1];
      if (ch > 0) up += ch;
      else dn -= ch;
    }
    const sum = up + dn;
    out[i] = sum > 0 ? ((up - dn) / sum) * 100 : 0;
  }
  return out;
}

/** Rate of Change (percent, n=12). */
export function rocSeries(closes: number[], n = 12): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = n; i < closes.length; i++) {
    if (closes[i - n] !== 0) out[i] = ((closes[i] - closes[i - n]) / closes[i - n]) * 100;
  }
  return out;
}

/** Ultimate Oscillator (7, 14, 28). */
export function ultimateOscSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[],
  p1 = 7,
  p2 = 14,
  p3 = 28
): (number | null)[] {
  const len = closes.length;
  const bp: number[] = new Array(len).fill(0); // buying pressure
  const tr: number[] = new Array(len).fill(0);
  for (let i = 1; i < len; i++) {
    const [h, l] = hl(highs[i], lows[i], closes[i]);
    const trueLow = Math.min(l, closes[i - 1]);
    bp[i] = closes[i] - trueLow;
    tr[i] = h - trueLow;
  }
  const out: (number | null)[] = new Array(len).fill(null);
  const sum = (arr: number[], from: number, to: number) => {
    let s = 0;
    for (let j = from; j <= to; j++) s += arr[j];
    return s;
  };
  for (let i = p3; i < len; i++) {
    const bp1 = sum(bp, i - p1 + 1, i);
    const tr1 = sum(tr, i - p1 + 1, i);
    const bp2 = sum(bp, i - p2 + 1, i);
    const tr2 = sum(tr, i - p2 + 1, i);
    const bp3 = sum(bp, i - p3 + 1, i);
    const tr3 = sum(tr, i - p3 + 1, i);
    if (tr1 > 0 && tr2 > 0 && tr3 > 0) {
      out[i] = 100 * (4 * (bp1 / tr1) + 2 * (bp2 / tr2) + bp3 / tr3) / 7;
    }
  }
  return out;
}

/** Aroon Up/Down (n=14): bars since rolling high/low, scaled 0-100. */
export function aroonSeries(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: number[],
  n = 14
): { up: (number | null)[]; down: (number | null)[] } {
  const len = closes.length;
  const up: (number | null)[] = new Array(len).fill(null);
  const down: (number | null)[] = new Array(len).fill(null);
  for (let i = n; i < len; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    let hiBar = i;
    let loBar = i;
    for (let j = i - n; j <= i; j++) {
      const [h, l] = hl(highs[j], lows[j], closes[j]);
      if (h >= hh) {
        hh = h;
        hiBar = j;
      }
      if (l <= ll) {
        ll = l;
        loBar = j;
      }
    }
    up[i] = ((n - (i - hiBar)) / n) * 100;
    down[i] = ((n - (i - loBar)) / n) * 100;
  }
  return { up, down };
}

// ── rating aggregation ──

export type Signal = "buy" | "neutral" | "sell";

/** Aggregate a list of signals into an investing.com-style rating:
 *  score = (buy − sell) / total, mapped to 5 buckets. */
export function aggregateSignals(signals: Signal[]): {
  rating: "strongBuy" | "buy" | "neutral" | "sell" | "strongSell";
  buy: number;
  neutral: number;
  sell: number;
  score: number;
} {
  const buy = signals.filter((s) => s === "buy").length;
  const sell = signals.filter((s) => s === "sell").length;
  const neutral = signals.length - buy - sell;
  const score = signals.length ? (buy - sell) / signals.length : 0;
  let rating: "strongBuy" | "buy" | "neutral" | "sell" | "strongSell";
  if (score > 0.5) rating = "strongBuy";
  else if (score > 0.1) rating = "buy";
  else if (score < -0.5) rating = "strongSell";
  else if (score < -0.1) rating = "sell";
  else rating = "neutral";
  return { rating, buy, neutral, sell, score };
}

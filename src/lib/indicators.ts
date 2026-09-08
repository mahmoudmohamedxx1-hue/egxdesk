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

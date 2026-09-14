/** T26 — sanity-check the new advanced indicator math against hand-computed
 *  reference values (bun test-style asserts, plain script). Run:
 *    bun scripts/test-indicators.ts */
import {
  atrSeries,
  adxSeries,
  obvSeries,
  vwapSeries,
  mfiSeries,
  stochRsiSeries,
  psarSeries,
  superTrendSeries,
  donchianSeries,
  keltnerSeries,
  ichimokuSeries,
  awesomeSeries,
  trixSeries,
  cmoSeries,
  rocSeries,
  ultimateOscSeries,
  aroonSeries,
  smaSeries,
} from "@/lib/indicators";

let failures = 0;
function eq(name: string, got: number | null | undefined, want: number | null, tol = 1e-9) {
  const ok =
    (got === null && want === null) ||
    (got !== null && got !== undefined && want !== null && Math.abs(got - want) <= tol);
  if (!ok) {
    failures++;
    console.error(`FAIL ${name}: got ${got} want ${want}`);
  } else {
    console.log(`ok   ${name} = ${got}`);
  }
}

// rising series 1..60 with h=i+0.5, l=i-0.5, vol=i*100
const closes: number[] = [];
const highs: (number | null)[] = [];
const lows: (number | null)[] = [];
const volumes: (number | null)[] = [];
for (let i = 1; i <= 60; i++) {
  closes.push(i);
  highs.push(i + 0.5);
  lows.push(i - 0.5);
  volumes.push(i * 100);
}
const last = closes.length - 1;

// ATR: TR = max(h−l=1, h−prevClose=1.5, ...) = 1.5 on this series
// (closes rise by 1, so the close gap inflates TR above the bar range)
eq("ATR(14)", atrSeries(highs, lows, closes, 14)[last], 1.5, 1e-9);

// OBV: strictly rising closes + positive volumes => sum of all volumes
{
  const obv = obvSeries(closes, volumes);
  let want = 0;
  for (let i = 1; i < 60; i++) want += (i + 1) * 100;
  eq("OBV rising", obv![last], want);
}

// VWAP: tp = i (since h+l+c = 3i), pv/vv = weighted mean of i by vol=100i => sum(i^2)/sum(i)
{
  const vw = vwapSeries(highs, lows, closes, volumes);
  let s2 = 0;
  let s1 = 0;
  for (let i = 1; i <= 60; i++) {
    s2 += i * i * 100;
    s1 += i * 100;
  }
  eq("VWAP weighted mean", vw[last], s2 / s1, 1e-9);
}

// Donchian(20) on rising: up = last high, lo = high 19 bars ago
{
  const dc = donchianSeries(highs, lows, closes, 20);
  eq("Donchian up", dc.up[last], 60.5);
  eq("Donchian lo", dc.lo[last], 40.5);
}

// Ichimoku on rising series: tenkan = (HH9+LL9)/2 = (60.5+51.5)/2 = 56
{
  const ich = ichimokuSeries(highs, lows, closes, 9, 26, 52, 26);
  eq("Ichimoku tenkan", ich.tenkan[last], 56);
  eq("Ichimoku kijun", ich.kijun[last], (60.5 + 34.5) / 2);
  // bars are 0-indexed with value i+1: at src=33 tenkan=(34.5+25.5)/2=30,
  // kijun=(34.5+8.5)/2=21.5 → spanA=(30+21.5)/2=25.75
  eq("Ichimoku spanA displaced", ich.spanA[last], 25.75);
  // projA[0] uses src = 60-26 = 34: tenkan=(35.5+26.5)/2=31, kijun=(35.5+9.5)/2=22.5
  // → spanA = (31+22.5)/2 = 26.75
  eq("Ichimoku projA[0]", ich.projA[0], 26.75);
  // chikou[i] = close[i+26]; at i = last-26 → close[last]
  eq("Ichimoku chikou lag", ich.chikou![last - 26], closes[last]);
}

// CMO on strictly rising = +100
eq("CMO rising", cmoSeries(closes, 14)[last], 100, 1e-9);

// ROC(12): (60-48)/48*100 = 25
eq("ROC(12)", rocSeries(closes, 12)[last], 25, 1e-9);

// StochRSI on strictly rising: RSI = 100 → raw span 0 → 50 fallback path
{
  const s = stochRsiSeries(closes);
  // RSI is 100 for a monotonic series; hh=ll=100 → span 0 → raw = 50
  eq("StochRSI K (flat RSI)", s.k[last], 50, 1e-9);
}

// Awesome Oscillator rising: SMA5(med)-SMA34(med), med = i
{
  const ao = awesomeSeries(highs, lows, closes);
  const med = closes.map((c, i) => (highs[i]! + lows[i]! + c) / 3);
  const s5 = smaSeries(med, 5);
  const s34 = smaSeries(med, 34);
  eq("AO", ao[last], (s5[last] as number) - (s34[last] as number), 1e-9);
}

// Aroon on strictly rising: up = 100, down = 0
{
  const ar = aroonSeries(highs, lows, closes, 14);
  eq("Aroon up", ar.up[last], 100);
  eq("Aroon down", ar.down[last], 0);
}

// ADX on strictly rising: +DI = 100, −DI = 0, DX = 100, ADX = 100
{
  const adx = adxSeries(highs, lows, closes, 14);
  eq("ADX pdi rising", adx.pdi[last], 200 / 3, 1e-6);
  eq("ADX mdi rising", adx.mdi[last], 0, 1e-6);
  eq("ADX rising", adx.adx[last], 100, 1e-6);
}

// PSAR on strictly rising: SAR trails below lows, never touched
{
  const ps = psarSeries(highs, lows, closes);
  const below = ps.every((v, i) => v === null || v < closes[i]);
  console.log(`${below ? "ok  " : "FAIL"} PSAR trails below price in uptrend (last=${ps[last]})`);
  if (!below) failures++;
}

// SuperTrend on strictly rising: trend = +1, line below price
{
  const st = superTrendSeries(highs, lows, closes, 10, 3);
  eq("SuperTrend trend", st.trend[last], 1);
  const below = st.line.every((v, i) => v === null || v <= closes[i]);
  console.log(`${below ? "ok  " : "FAIL"} SuperTrend line below price (last=${st.line[last]})`);
  if (!below) failures++;
}

// MFI on strictly rising typical price: all positive flow → 100
eq("MFI rising", mfiSeries(highs, lows, closes, volumes, 14)[last], 100, 1e-6);

// Ultimate Oscillator rising: bp = c - truelow = 1 per bar, tr = h - truelow = 1.5
// UO = 100*(4*(1/1.5) + 2*(1/1.5) + 1/1.5)/7 = 100*(7*(2/3))/7 = 66.67
eq("UO rising", ultimateOscSeries(highs, lows, closes)[last], (100 * (4 + 2 + 1) * (1 / 1.5)) / 7, 1e-6);

// TRIX on exponential-ish rising: just check finite & positive
{
  const tx = trixSeries(closes);
  const v = tx.trix[last];
  const okVal = v !== null && Number.isFinite(v) && v > 0;
  console.log(`${okVal ? "ok  " : "FAIL"} TRIX positive on uptrend (${v})`);
  if (!okVal) failures++;
}

// Keltner: mid = EMA20, up-lo = 2*mult*ATR
{
  const kt = keltnerSeries(highs, lows, closes, 20, 10, 2);
  const atr = atrSeries(highs, lows, closes, 10);
  eq("Keltner width", (kt.up[last] as number) - (kt.lo[last] as number), 2 * 2 * (atr[last] as number), 1e-9);
}

// falling series sanity: CMO = -100, SuperTrend flips to -1
{
  const fc: number[] = [];
  const fh: (number | null)[] = [];
  const fl: (number | null)[] = [];
  for (let i = 60; i >= 1; i--) {
    fc.push(i);
    fh.push(i + 0.5);
    fl.push(i - 0.5);
  }
  eq("CMO falling", cmoSeries(fc, 14)[fc.length - 1], -100, 1e-9);
  eq("SuperTrend trend falling", superTrendSeries(fh, fl, fc).trend[fc.length - 1], -1);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

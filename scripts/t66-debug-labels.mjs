// T66 debug: simulate the label layout at the user-reported zoom to see why 0 names.
const res = await fetch("http://localhost:3000/api/valuation-map");
const data = await res.json();
const rows = data.rows.filter((r) => r.pe > 0 && (r.de ?? 0) >= 0);
console.log("map-eligible rows:", rows.length);

const W = 960, H = 560, PX0 = 70, PX1 = W - 40, PY0 = 30, PY1 = H - 60;
const peSort = rows.map((r) => r.pe).filter((v) => v != null).sort((a, b) => a - b);
const p96 = peSort[Math.floor(peSort.length * 0.96)];
const xMax = Math.max(20, Math.ceil(p96));
console.log("xMax =", xMax, " p96 =", p96);

const cam = { k: 2.197, x: -592.515, y: -317.205 };
const xf = (pe) => PX0 + (Math.min(pe, xMax) / xMax) * (PX1 - PX0);
const maxCap = Math.max(...rows.map((r) => r.marketCap ?? 0), 1);
const rf = (cap) => 4.5 + Math.sqrt((cap ?? 1e8) / maxCap) * 21;

// what's actually visible in the plot at this cam?
const visPe = [((PX0 - cam.x) / cam.k - PX0) / (PX1 - PX0) * xMax, ((PX1 - cam.x) / cam.k - PX0) / (PX1 - PX0) * xMax];
console.log("visible pe range:", visPe.map((v) => v.toFixed(1)));

const inView = rows.filter((r) => {
  const sx = cam.x + xf(r.pe) * cam.k;
  return sx >= PX0 - 60 && sx <= PX1 + 60;
});
console.log("bubbles in view (x):", inView.length);
for (const r of inView) {
  const sx = cam.x + xf(r.pe) * cam.k;
  const sr = rf(r.marketCap) * cam.k;
  console.log(`  ${r.ticker} pe=${r.pe.toFixed(1)} sx=${sx.toFixed(0)} sr=${sr.toFixed(1)} cap=${((r.marketCap ?? 0) / 1e9).toFixed(1)}B`);
}

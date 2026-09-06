// Quick check: does bollingerSeries produce non-null values for FAIT 6M closes?
const closes = [];
(async () => {
  const res = await fetch("http://localhost:3000/api/chart?symbol=FAIT&range=6M");
  const d = await res.json();
  const v = d.points.map((p) => p.close);
  const n = 20;
  const mid = [], up = [], lo = [];
  for (let i = 0; i < v.length; i++) {
    if (i < n - 1) { mid.push(null); up.push(null); lo.push(null); continue; }
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += v[j];
    const m = sum / n;
    let sq = 0;
    for (let j = i - n + 1; j <= i; j++) sq += (v[j] - m) ** 2;
    const sd = Math.sqrt(sq / n);
    mid.push(m); up.push(m + 2 * sd); lo.push(m - 2 * sd);
  }
  const nonNull = up.filter((x) => x !== null).length;
  console.log("points:", v.length, "non-null bb:", nonNull, "sample up[25]:", up[25], "lo[25]:", lo[25]);
})();

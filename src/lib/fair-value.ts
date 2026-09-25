/** T64 — the FAIR VALUE ENGINE, shared by the server (valuation map, cheap
 *  screen) and the client (model lab workbench). Pure functions only — no
 *  fetches, no state — so the same math runs on both sides of the wire.
 *
 *  Five classic models, each computed ONLY from fields the TradingView
 *  scanner actually serves per stock (EPS, P/B → BVPS, dividend yield → DPS,
 *  payout, ROE, beta, revenue growth) plus per-sector medians derived from
 *  the same live universe:
 *
 *    1. Peer P/E        FV = EPS × sector-median P/E            (w .25)
 *    2. Peer P/B        FV = BVPS × sector-median P/B           (w .20)
 *    3. Graham number   FV = √(22.5 × EPS × BVPS)               (w .15)
 *    4. Gordon DDM      FV = DPS × (1+g) / (r − g)              (w .20)
 *    5. Justified P/B   FV = BVPS × (ROE − g) / (r − g)         (w .20)
 *
 *  The blend renormalizes the weights over the models whose inputs exist —
 *  a bank without a P/B never gets a phantom number, and coverage (models
 *  used ÷ 5) ships with every result so the reader can see the confidence.
 *
 *  Discount rate r is CAPM: r = rf + β × ERP, with rf anchored to the CBE
 *  policy rate (19–20% in 2026), ERP fixed at 8% and beta from the scanner
 *  (fallback 1.0). Sustainable growth g = ROE × (1 − payout) when both are
 *  published, else the quarterly revenue growth clamped, always capped at
 *  gCap (default 12%) and always at least spreadMin below r, or the
 *  dividend models gracefully drop out instead of exploding.
 *
 *  Verdict bands come from the MARGIN (fair value − price) ÷ fair value:
 *  a stock is "cheap" only when it trades at least the margin of safety
 *  (default 15%) below its blended fair value; "rich" when 10%+ above it.
 *  Every number is a model output, not advice. */

export type FvInputs = {
  price: number | null;
  eps: number | null; // EGP, TTM
  bvps: number | null; // EGP — derived: close / P/B
  dps: number | null; // EGP — derived: divYield% / 100 × close
  payout: number | null; // 0..1
  roe: number | null; // %
  beta: number | null;
  gRevQ: number | null; // % — quarterly YoY revenue growth
  sectorPe: number | null;
  sectorPb: number | null;
  /** sanity fields (never used as math inputs): the scanner's own P/E and
   *  P/B, so split/rights artifacts can be caught before they poison the
   *  models — a scanner P/E under 1 or over 500 is a data artifact, not a
   *  stock you can buy for one year of earnings. */
  pe: number | null;
  pb: number | null;
};

export type FvAssumptions = {
  rf: number; // % — risk-free (CBE policy anchored)
  erp: number; // % — equity risk premium
  beta: number; // beta used (prefilled from scanner, fallback 1)
  g: number | null; // % — null = auto (sustainable growth)
  gCap: number; // % — growth cap
  spreadMin: number; // pp — floor on (r − g)
  mos: number; // 0..1 — margin of safety
  rOverride: number | null; // % — when set, replaces the CAPM r
};

export const DEFAULT_FV_WEIGHTS = {
  multPe: 0.25,
  multPb: 0.2,
  graham: 0.15,
  ddm: 0.2,
  justifiedPb: 0.2,
} as const;

export type FvWeights = typeof DEFAULT_FV_WEIGHTS;

export const DEFAULT_FV_ASSUMPTIONS: FvAssumptions = {
  rf: 19.5,
  erp: 8,
  beta: 1,
  g: null,
  gCap: 12,
  spreadMin: 3,
  mos: 0.15,
  rOverride: null,
};

export type FvModelId = "multPe" | "multPb" | "graham" | "ddm" | "justifiedPb";

export type FvModelResult = {
  id: FvModelId;
  value: number | null;
  weight: number; // share of the blend actually used (renormalized)
  formulaEn: string;
  formulaAr: string;
  missingEn: string; // why the model dropped out, in words
  missingAr: string;
};

export type FvVerdict = "cheap" | "fair" | "rich" | null;

export type FvResult = {
  models: FvModelResult[];
  blend: number | null; // EGP
  upside: number | null; // % — blend / price − 1
  margin: number | null; // (blend − price) / blend
  r: number | null; // % discount rate used
  g: number | null; // % growth used
  coverage: number; // 0..1 — models available ÷ 5
  verdict: FvVerdict;
};

// ── helpers ──

const fin = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);
const r1 = (v: number) => Number(v.toFixed(1));
const r2 = (v: number) => Number(v.toFixed(2));

/** CAPM discount rate in %, with the override hook for the sensitivity grid.
 *  The beta comes from the scanner when published (inputs.beta), else the
 *  assumption's fallback beta — a lab user can override either. */
export function fvDiscountRate(a: FvAssumptions, betaOverride?: number | null): number {
  const beta = typeof betaOverride === "number" && Number.isFinite(betaOverride) && betaOverride > 0 ? betaOverride : a.beta;
  if (fin(a.rOverride) && a.rOverride > 0) return Math.min(45, Math.max(5, a.rOverride));
  return Math.min(45, Math.max(a.rf, a.rf + beta * a.erp));
}

/** Sustainable growth in %: ROE × retention when published, else the
 *  quarterly revenue growth clamped to [0, gCap]; null when neither exists. */
export function fvAutoG(inputs: FvInputs, a: FvAssumptions): number | null {
  if (fin(a.g)) return Math.min(a.gCap, Math.max(0, a.g));
  if (fin(inputs.roe) && fin(inputs.payout) && inputs.payout >= 0) {
    return Math.min(a.gCap, Math.max(0, (inputs.roe / 100) * (1 - inputs.payout) * 100));
  }
  if (fin(inputs.gRevQ)) return Math.min(a.gCap, Math.max(0, inputs.gRevQ));
  return null;
}

// ── the engine ──

export function computeFv(inputs: FvInputs, a: FvAssumptions, weights: FvWeights = DEFAULT_FV_WEIGHTS): FvResult {
  const beta = fin(inputs.beta) && inputs.beta > 0 ? inputs.beta : a.beta;
  const r = fvDiscountRate({ ...a, beta });
  const g = fvAutoG(inputs, a);
  const gd = g != null ? g / 100 : null;
  const rd = r / 100;
  const spreadOk = gd != null && r - gd * 100 >= a.spreadMin;

  const price = fin(inputs.price) && inputs.price > 0 ? inputs.price : null;

  // ── declared sanity gates ──
  // 1) scanner-multiple gates: a P/E under 1 or over 500 (or a P/B under
  //    0.05 / over 100) is almost always a split/rights artifact on the
  //    EGX — the fields that feed on it drop out instead of poisoning the
  //    blend, and the reason prints in words.
  const peSuspect = fin(inputs.pe) && (inputs.pe < 1 || inputs.pe > 500);
  const pbSuspect = fin(inputs.pb) && (inputs.pb < 0.05 || inputs.pb > 100);
  // 2) the outlier band: any model valuing the stock outside 0.1×–10× its
  //    market price is treated as a data artifact and excluded, declared.
  const band = (v: number): boolean => (price == null ? true : v >= price / 10 && v <= price * 10);

  const parts: { id: FvModelId; value: number | null; w: number; formulaEn: string; formulaAr: string; missingEn: string; missingAr: string }[] = [];

  // 1. peer P/E
  {
    const raw = fin(inputs.eps) && inputs.eps > 0 && fin(inputs.sectorPe) && inputs.sectorPe > 0 ? inputs.eps * inputs.sectorPe : null;
    if (raw != null && !peSuspect && band(raw)) {
      parts.push({
        id: "multPe",
        value: r2(raw),
        w: weights.multPe,
        formulaEn: `EPS ${r2(inputs.eps as number)} × sector median P/E ${r1(inputs.sectorPe as number)}`,
        formulaAr: `ربح السهم ${r2(inputs.eps as number)} × وسيط مكرر القطاع ${r1(inputs.sectorPe as number)}`,
        missingEn: "",
        missingAr: "",
      });
    } else {
      const why = raw == null
        ? { en: "needs a positive EPS and a sector median P/E", ar: "يحتاج ربح سهم موجبًا ووسيط مكرر للقطاع" }
        : peSuspect
          ? { en: `scanner P/E ${r1(inputs.pe as number)}x is implausible — suspected split/rights artifact`, ar: `مكرر الماسح ${r1(inputs.pe as number)}x غير معقول — أثر تجزئة/استحقاق محتمل` }
          : { en: `model value ${r1(raw)} is an outlier vs price — excluded as suspect data`, ar: `قيمة النموذج ${r1(raw)} شاذة مقابل السعر — مستبعدة كبيانات مشبوهة` };
      parts.push({ id: "multPe", value: null, w: weights.multPe, formulaEn: "", formulaAr: "", missingEn: why.en, missingAr: why.ar });
    }
  }

  // 2. peer P/B
  {
    const raw = fin(inputs.bvps) && inputs.bvps > 0 && fin(inputs.sectorPb) && inputs.sectorPb > 0 ? inputs.bvps * inputs.sectorPb : null;
    if (raw != null && !pbSuspect && band(raw)) {
      parts.push({
        id: "multPb",
        value: r2(raw),
        w: weights.multPb,
        formulaEn: `BVPS ${r2(inputs.bvps as number)} × sector median P/B ${r2(inputs.sectorPb as number)}`,
        formulaAr: `القيمة الدفترية ${r2(inputs.bvps as number)} × وسيط مضاعف القطاع ${r2(inputs.sectorPb as number)}`,
        missingEn: "",
        missingAr: "",
      });
    } else {
      const why = raw == null
        ? { en: "needs book value (from P/B) and a sector median P/B", ar: "يحتاج قيمة دفترية (من مضاعف القيمة الدفترية) ووسيط قطاع" }
        : pbSuspect
          ? { en: `scanner P/B ${r2(inputs.pb as number)}x is implausible — suspected artifact`, ar: `مضاعف الماسح ${r2(inputs.pb as number)}x غير معقول — أثر محتمل` }
          : { en: `model value ${r1(raw)} is an outlier vs price — excluded as suspect data`, ar: `قيمة النموذج ${r1(raw)} شاذة مقابل السعر — مستبعدة كبيانات مشبوهة` };
      parts.push({ id: "multPb", value: null, w: weights.multPb, formulaEn: "", formulaAr: "", missingEn: why.en, missingAr: why.ar });
    }
  }

  // 3. Graham number — Benjamin Graham's defensive floor
  {
    const raw =
      fin(inputs.eps) && inputs.eps > 0 && fin(inputs.bvps) && inputs.bvps > 0 && !peSuspect && !pbSuspect
        ? Math.sqrt(22.5 * inputs.eps * inputs.bvps)
        : null;
    if (raw != null && band(raw)) {
      parts.push({
        id: "graham",
        value: r2(raw),
        w: weights.graham,
        formulaEn: `√(22.5 × EPS ${r2(inputs.eps as number)} × BVPS ${r2(inputs.bvps as number)})`,
        formulaAr: `√(22.5 × ربح السهم ${r2(inputs.eps as number)} × القيمة الدفترية ${r2(inputs.bvps as number)})`,
        missingEn: "",
        missingAr: "",
      });
    } else {
      const why = peSuspect || pbSuspect
        ? { en: "scanner multiple implausible — suspected split/rights artifact", ar: "مضاعف الماسح غير معقول — أثر تجزئة/استحقاق محتمل" }
        : raw == null
          ? { en: "Graham's floor needs positive earnings AND a positive book value", ar: "أرضية جراهام تحتاج أرباحًا وقيمة دفترية موجبة" }
          : { en: `model value ${r1(raw)} is an outlier vs price — excluded as suspect data`, ar: `قيمة النموذج ${r1(raw)} شاذة مقابل السعر — مستبعدة كبيانات مشبوهة` };
      parts.push({ id: "graham", value: null, w: weights.graham, formulaEn: "", formulaAr: "", missingEn: why.en, missingAr: why.ar });
    }
  }

  // 4. Gordon growth DDM
  {
    const raw = fin(inputs.dps) && inputs.dps > 0 && gd != null && spreadOk ? (inputs.dps * (1 + gd)) / (rd - gd) : null;
    if (raw != null && band(raw)) {
      parts.push({
        id: "ddm",
        value: r2(raw),
        w: weights.ddm,
        formulaEn: `DPS ${r2(inputs.dps as number)} × (1+g ${r1(g ?? 0)}%) ÷ (r ${r1(r)}% − g ${r1(g ?? 0)}%)`,
        formulaAr: `توزيع السهم ${r2(inputs.dps as number)} × (1+نمو ${r1(g ?? 0)}%) ÷ (خصم ${r1(r)}% − نمو ${r1(g ?? 0)}%)`,
        missingEn: "",
        missingAr: "",
      });
    } else {
      const why = !fin(inputs.dps) || inputs.dps <= 0
        ? { en: "the company pays no dividend (or the yield is not published)", ar: "الشركة لا توزّع أرباحًا (أو العائد غير منشور)" }
        : gd == null
          ? { en: "no published basis for growth (ROE × retention or revenue growth)", ar: "لا أساس منشورًا للنمو (عائد الملكية × الاحتجاز أو نمو الإيرادات)" }
          : !spreadOk
            ? { en: `the gap r − g is below the ${a.spreadMin}pp floor — the model would explode`, ar: `الفارق بين الخصم والنمو أقل من حد ${a.spreadMin} نقطة — النموذج سينفجر` }
            : { en: `model value ${r1(raw as number)} is an outlier vs price — excluded as suspect data`, ar: `قيمة النموذج ${r1(raw as number)} شاذة مقابل السعر — مستبعدة كبيانات مشبوهة` };
      parts.push({ id: "ddm", value: null, w: weights.ddm, formulaEn: "", formulaAr: "", missingEn: why.en, missingAr: why.ar });
    }
  }

  // 5. justified P/B — residual-income flavor: what P/B the ROE justifies
  {
    const raw =
      fin(inputs.bvps) && inputs.bvps > 0 && !pbSuspect && fin(inputs.roe) && gd != null && spreadOk && inputs.roe > (g ?? 0)
        ? inputs.bvps * ((inputs.roe - (g ?? 0)) / (r - (g ?? 0)))
        : null;
    if (raw != null && band(raw)) {
      parts.push({
        id: "justifiedPb",
        value: r2(raw),
        w: weights.justifiedPb,
        formulaEn: `BVPS ${r2(inputs.bvps as number)} × (ROE ${r1(inputs.roe as number)}% − g) ÷ (r ${r1(r)}% − g)`,
        formulaAr: `القيمة الدفترية ${r2(inputs.bvps as number)} × (عائد الملكية ${r1(inputs.roe as number)}% − نمو) ÷ (خصم ${r1(r)}% − نمو)`,
        missingEn: "",
        missingAr: "",
      });
    } else {
      const why = !fin(inputs.roe)
        ? { en: "ROE not published", ar: "عائد حقوق الملكية غير منشور" }
        : gd == null
          ? { en: "no published basis for growth", ar: "لا أساس منشورًا للنمو" }
          : !spreadOk
            ? { en: `the gap r − g is below the ${a.spreadMin}pp floor`, ar: `الفارق بين الخصم والنمو أقل من الحد` }
            : pbSuspect
              ? { en: `scanner P/B ${r2(inputs.pb as number)}x is implausible — suspected artifact`, ar: `مضاعف الماسح ${r2(inputs.pb as number)}x غير معقول — أثر محتمل` }
              : fin(inputs.bvps) && inputs.bvps > 0 && inputs.roe <= (g ?? 0)
                ? { en: "ROE does not exceed g — the formula prices the stock below zero growth", ar: "عائد الملكية لا يفوق النمو — الصيغة تسعّر السهم دون نمو" }
                : { en: `model value ${r1(raw as number)} is an outlier vs price — excluded as suspect data`, ar: `قيمة النموذج ${r1(raw as number)} شاذة مقابل السعر — مستبعدة كبيانات مشبوهة` };
      parts.push({ id: "justifiedPb", value: null, w: weights.justifiedPb, formulaEn: "", formulaAr: "", missingEn: why.en, missingAr: why.ar });
    }
  }

  // blend — weights renormalized over the models that exist
  const live = parts.filter((p) => p.value != null);
  const wSum = live.reduce((acc, p) => acc + p.w, 0);
  const blend = live.length && wSum > 0 ? live.reduce((acc, p) => acc + (p.value as number) * p.w, 0) / wSum : null;
  const models: FvModelResult[] = parts.map((p) => ({
    id: p.id,
    value: p.value,
    weight: p.value != null && wSum > 0 ? Number((p.w / wSum).toFixed(3)) : 0,
    formulaEn: p.formulaEn,
    formulaAr: p.formulaAr,
    missingEn: p.missingEn,
    missingAr: p.missingAr,
  }));

  const upside = blend != null && price ? Number((((blend / price) - 1) * 100).toFixed(1)) : null;
  const margin = blend != null && price ? Number(((blend - price) / blend).toFixed(3)) : null;
  const verdict: FvVerdict = margin == null ? null : margin >= a.mos ? "cheap" : margin <= -0.1 ? "rich" : "fair";

  return {
    models,
    blend: blend != null ? r2(blend) : null,
    upside,
    margin,
    r: r1(r),
    g: g != null ? r1(g) : null,
    coverage: Number((live.length / 5).toFixed(2)),
    verdict,
  };
}

// ── sensitivity grid (the model lab's "what if" table) ──

export type FvSensitivity = {
  gSteps: number[]; // rows
  rSteps: number[]; // cols
  cells: (number | null)[][]; // upside % at each (g, r)
};

export function fvSensitivity(inputs: FvInputs, a: FvAssumptions, weights?: FvWeights): FvSensitivity {
  const beta = fin(inputs.beta) && inputs.beta > 0 ? inputs.beta : a.beta;
  const g0 = fvAutoG(inputs, a) ?? 8;
  const r0 = fvDiscountRate({ ...a, beta });
  // dedupe: clamping at the floors can collapse two steps into one value
  // (g floored at 0, r floored at 5) and duplicate keys/values are noise
  const steps = (base: number, floor: number) =>
    [...new Set([-4, -2, 0, 2, 4].map((d) => Math.max(floor, Number((base + d).toFixed(1)))))].sort((x, y) => x - y);
  const gSteps = steps(g0, 0);
  const rSteps = steps(r0, 5);
  const cells = gSteps.map((gi) =>
    rSteps.map((ri) => {
      const res = computeFv(inputs, { ...a, g: gi, rOverride: ri }, weights);
      return res.upside;
    })
  );
  return { gSteps, rSteps, cells };
}

// ── debt zones (the debt map's reading aid) ──

export type DebtZone = "netCash" | "safe" | "moderate" | "elevated" | "high";

export function debtZone(de: number | null, netDebt: number | null): DebtZone | null {
  if (fin(netDebt) && netDebt < 0) return "netCash";
  if (!fin(de) || de < 0) return null;
  if (de < 0.5) return "safe";
  if (de < 1) return "moderate";
  if (de < 1.5) return "elevated";
  return "high";
}

export const DEBT_ZONE_META: Record<DebtZone, { ar: string; en: string; hintAr: string; hintEn: string; color: string }> = {
  netCash: { ar: "صافي نقد", en: "Net cash", hintAr: "نقد يفوق الدين", hintEn: "cash exceeds debt", color: "#059669" },
  safe: { ar: "ديون آمنة", en: "Safe debt", hintAr: "D/E أقل من 0.5", hintEn: "D/E below 0.5", color: "#10b981" },
  moderate: { ar: "رفع متوسط", en: "Moderate leverage", hintAr: "D/E بين 0.5 و1", hintEn: "D/E between 0.5 and 1", color: "#84cc16" },
  elevated: { ar: "رفع مرتفع", en: "Elevated leverage", hintAr: "D/E بين 1 و1.5", hintEn: "D/E between 1 and 1.5", color: "#f59e0b" },
  high: { ar: "رفع مرتفع جدًا", en: "High leverage", hintAr: "D/E فوق 1.5", hintEn: "D/E above 1.5", color: "#ef4444" },
};

// ── verdict labels ──

export const FV_VERDICT_META: Record<Exclude<FvVerdict, null>, { ar: string; en: string; color: string }> = {
  cheap: { ar: "رخيصة مقابل قيمتها", en: "Cheap vs fair value", color: "#10b981" },
  fair: { ar: "حول القيمة العادلة", en: "Around fair value", color: "#64748b" },
  rich: { ar: "أغلى من قيمتها", en: "Rich vs fair value", color: "#ef4444" },
};

/** Upside → color for map bubbles and table chips (green→red spectrum). */
export function upsideColor(upside: number | null): string {
  if (upside == null || !Number.isFinite(upside)) return "#64748b";
  if (upside >= 40) return "#047857";
  if (upside >= 20) return "#10b981";
  if (upside >= 10) return "#34d399";
  if (upside > -10) return "#94a3b8";
  if (upside > -20) return "#f87171";
  if (upside > -40) return "#ef4444";
  return "#b91c1c";
}

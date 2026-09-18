#!/usr/bin/env python3
"""T42 — patch i18n.ts: update AI-signals texts for the 12-strategy ensemble
and add the new strategy UI keys. Line-anchored to avoid Unicode-matching issues."""
import re
import pathlib

p = pathlib.Path("/home/z/my-project/src/lib/i18n.ts")
src = p.read_text(encoding="utf-8")
lines = src.split("\n")

# 1. aiSignalsNote (ar + en) — find the block and replace the two value lines
def replace_value(key: str, field: str, new: str) -> None:
    """Replace the `field: "..."` line inside the `key: {` block (single-line or multi-line form)."""
    for i, ln in enumerate(lines):
        if re.match(rf'\s*{re.escape(key)}:\s*\{{', ln):
            j = i + 1
            while j < len(lines) and "}" not in lines[j]:
                m = re.match(rf"\s*{re.escape(field)}:\s*\"(.*)\",?\s*$", lines[j])
                if m:
                    lines[j] = f'    {field}: "{new}",'
                    return
                j += 1
            raise SystemExit(f"field {key}.{field} not found")

replace_value("aiSignalsNote", "ar",
    "منظومة من ١٢ استراتيجية مستقلة (ترند، زخم، ارتداد، حجم، جودة، صحافة) تصوّت على كل سهم من بيانات السوق الحية — والإجماع الموزون هو ما يُغذّي نموذج GLM مع أدلة كل استراتيجية، فيخرج بإشارات مدعومة بمستويات دخول ووقف وهدف وفق قواعد ATR ثابتة. المنظومة كلها مُختبرة تاريخيًا (اختبار متحرك بدون تسريب مستقبلي، النتائج أدناه) وتُحسب مرة واحدة لكل دورة وتُقدّم للجميع مجانًا.")
replace_value("aiSignalsNote", "en",
    "An ensemble of 12 independent strategies (trend, momentum, reversion, volume, quality, press) votes on every stock from live market data — the weighted consensus feeds the GLM model together with each strategy's evidence, producing signals with entry/stop/target levels from fixed ATR math. The whole ensemble is back-tested walk-forward with no lookahead (results below), computed once per cycle and served to everyone, free.")

# 2. single-line key updates (regex on the key, keep structure)
def replace_line(key: str, ar: str, en: str) -> None:
    for i, ln in enumerate(lines):
        if re.match(rf"\s*{re.escape(key)}:\s*\{{\s*ar:\s*\"", ln):
            lines[i] = f'  {key}: {{ ar: "{ar}", en: "{en}" }},'
            return
    raise SystemExit(f"key {key} not found")

replace_line("aiSignalsBiasTitle", "قراءة منظومة الاستراتيجيات للسوق", "The ensemble's market read")
replace_line("aiSignalsCharterScore", "إجماع المحرك", "Ensemble consensus")
replace_value("aiSignalsBacktestMethod", "ar",
    "طريقة الاختبار: إعادة تشغيل نفس دوال التقييم الحية على التاريخ دون تسريب مستقبلي — كل ١٠ جلسات تصوّت منظومة الاستراتيجيات على السوق، وأقوى ٥ أسهم بإجماع ≥ 0.35، حمل ١٠ جلسات، تكاليف ٠.٣٥٪ ذهابًا وإيابًا، والمقارنة بمحفظة متساوية الأوزان لكل السوق على ٣ سنوات. وكل استراتيجية تُختبر أيضًا منفردة بنفس المنهجية.")
replace_value("aiSignalsBacktestMethod", "en",
    "Method: the exact live scoring functions replayed over history with no lookahead — every 10 sessions the 12-strategy ensemble votes on the market, take the top 5 names with consensus \u2265 0.35, hold 10 sessions, 0.35% round-trip costs, benchmarked against an equal-weight whole-market portfolio over 3 years. Each strategy is ALSO backtested standalone with the same methodology.")

# 3. insert new keys after the aiSignalsCharterScore line
new_keys = """  aiSignalsEnsembleBadge: { ar: "محرك ١٢ استراتيجية", en: "12-strategy engine" },
  aiSignalsStrategiesFired: { ar: "الاستراتيجيات المؤيدة", en: "Supporting strategies" },
  aiSignalsAgreement: { ar: "توافق الاستراتيجيات", en: "Strategy agreement" },
  aiSignalsVotes: { ar: "أصوات", en: "votes" },
  aiSignalsPerStrategyTitle: { ar: "أداء كل استراتيجية على حدة (اختبار مستقل بنفس المنهجية)", en: "Per-strategy standalone backtest (same methodology, run independently)" },
  aiSignalsStrategiesTitle: { ar: "الاستراتيجيات الاثنتا عشرة", en: "The twelve strategies" },
  aiSignalsStrategyNotBacktested: { ar: "مباشر فقط — لا يوجد سجل تاريخي لاختباره", en: "Live-only — no historical series to backtest" },
  signalsLensStrategies: { ar: "إجماع الاستراتيجيات", en: "Strategy consensus" },
  signalsColStrategies: { ar: "الاستراتيجيات", en: "Strategies" },
  signalsStrategiesHint: { ar: "عدد الاستراتيجيات المؤيدة للشراء من إجمالي المصوّتة (من ١٢)", en: "How many of the counted strategies vote long (of 12)" },"""

for i, ln in enumerate(lines):
    if "aiSignalsCharterScore" in ln:
        lines.insert(i + 1, new_keys)
        break
else:
    raise SystemExit("anchor for insertion not found")

p.write_text("\n".join(lines), encoding="utf-8")
print("i18n.ts patched: note/bias/score/method updated, 10 new keys inserted")

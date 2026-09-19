/** T45 — HERMES: the AUTONOMOUS, SELF-LEARNING signal agent.
 *
 *  Runs on the EGX weekday schedule (Sun–Thu Cairo: pre-open 09:15, midday
 *  12:15, post-close 15:00 — see agent-scheduler.ts) plus guarded manual
 *  triggers, and authors signal sets through the SAME validated spine as the
 *  45-minute shared refresh:
 *
 *    SKILLS (tlc-hermes-skills inspiration) — a registry of what the agent
 *      can do; every skill maps to a REAL data layer that already ships:
 *      the 18-strategy ensemble, the technical charter features, the
 *      per-ticker ML forecast, the Arabic press lexicon, the whale radar
 *      (investor flows + insider filings), the learning memory, the vision
 *      pass, the risk guard and the portfolio optimizer.
 *
 *    VISION (glm-4.6v-flash) — the agent RENDERS the top candidates' real
 *      candlestick tapes as PNGs (lib/chart-png.ts, zero deps) and the free
 *      GLM vision-flash model reads them: pattern, verdict (confirm /
 *      neutral / warn) and a bilingual note. Vision is EVIDENCE — it never
 *      creates a pick, it informs the brain and ships with the payload.
 *
 *    BRAIN (glm-4.7-flash, thinking ON) — one reasoning call over the same
 *      evidence pack the shared refresh uses, PLUS the vision reads, the
 *      learning state and the latest journal lessons (its memory). The reply
 *      passes through the SAME assembleSet guardrails: picks ⊆ candidates,
 *      the 0.35 consensus gate, conviction caps, charter ATR math, language
 *      purity. The LLM narrates and weighs; it can never invent a number.
 *
 *    MEMORY / SELF-LEARNING (hermes-agent inspiration) — every run reads the
 *      latest lessons, and the learning layer (agent-learning.ts) bends each
 *      strategy's influence by its LIVE hit rate from the published track
 *      record (±25% max, n≥8 gate). Weight changes and the run's reflection
 *      are journaled as AgentLesson rows — the agent literally starts every
 *      session knowing what its own record taught it.
 *
 *  Honesty invariants:
 *   - a failed run is recorded as failed with the honest error — output is
 *     NEVER fabricated, the previous set keeps serving;
 *   - vision failures surface as honest "unreadable chart" notes, not silence;
 *   - the served gates (consensus, conviction, ATR, purity) are IDENTICAL to
 *     the shared pipeline — learning enriches reasoning, never loosens safety;
 *   - the user's Z.AI key powers THIS pipeline only (signals, as asked). */

import { db } from "@/lib/db";
import { marketStatus } from "@/lib/market-status";
import { STRATEGY_CHARTER, STRATEGY_REV } from "@/lib/strategy";
import { gatherEvidence, composeUserMsg, assembleSet, strayLatinInArabic, strayArabicInEnglish, type AiSetPayload, type AiPick } from "@/lib/ai-signals";
import { emitSetEvents } from "@/lib/signal-events";
import { renderCandleChartPng } from "@/lib/chart-png";
import { zaiChat, zaiChatJson, zaiVision, ZAI_SIGNAL_MODEL, ZAI_VISION_MODEL } from "@/lib/zai-client";
import { computeLearning, learnedConsensus, diffLearning, type LearningState } from "@/lib/agent-learning";
import { recallForRun, rememberMemory, memoryStats, type RecalledMemory } from "@/lib/supermemory";
import { archiveContext, appendSignalRun, appendWorklog, readWorklogTail, type ArchiveContext } from "@/lib/agent-archive";
import { mirrorAgentRun, mirrorStatus as supabaseMirrorStatus } from "@/lib/supabase-mirror";
import backtestJson from "@/data/backtest.json";

// ── the skills registry (what the agent can do — every skill is real) ──

export type AgentSkill = {
  id: string;
  nameAr: string;
  nameEn: string;
  oneLineAr: string;
  oneLineEn: string;
};

export const AGENT_SKILLS: AgentSkill[] = [
  {
    id: "ensemble",
    nameAr: "قراءة المحرك",
    nameEn: "Ensemble read",
    oneLineAr: "تصويت محرك الـ18 استراتيجية على كل مرشح مع الإجماع والأدلة",
    oneLineEn: "The 18-strategy engine's per-candidate vote, consensus and evidence",
  },
  {
    id: "technicals",
    nameAr: "التحليل الفني",
    nameEn: "Technical charter",
    oneLineAr: "ميزات الميثاق: الترند والزخم والحجم والموضع ومسار ATR للمخاطر",
    oneLineEn: "Charter features: trend, momentum, volume, 52w position, ATR risk spine",
  },
  {
    id: "ml-forecast",
    nameAr: "توقع تعلم الآلة",
    nameEn: "ML forecast",
    oneLineAr: "نموذج لوجستي لكل سهم باحتمال صعود مع دقة عينة احتجاز مقاسة",
    oneLineEn: "Per-ticker logistic model, P(up) with a measured holdout hit rate",
  },
  {
    id: "news-tone",
    nameAr: "نبرة الصحافة",
    nameEn: "Press tone",
    oneLineAr: "معجم عربي يقيس انحياز تغطية 14 يومًا لكل شركة",
    oneLineEn: "Arabic lexicon scoring each company's 14-day press coverage",
  },
  {
    id: "whale-radar",
    nameAr: "رادار الحيتان",
    nameEn: "Whale radar",
    oneLineAr: "تدفقات المؤسسات الأجنبية الحقيقية من سجل البورصة الرسمي",
    oneLineEn: "Real foreign-institution flows from the exchange's own record",
  },
  {
    id: "insider-filings",
    nameAr: "إفصاحات المطلعين",
    nameEn: "Insider filings",
    oneLineAr: "نماذج تداول المتصلين وأسهم الخزينة المودعة رسميًا",
    oneLineEn: "Officially filed insider / treasury-share dealings",
  },
  {
    id: "vision",
    nameAr: "قراءة الشارت بالرؤية",
    nameEn: "Vision chart read",
    oneLineAr: "نموذج رؤية مجاني يقرأ شارت الشموع الحقيقي لكل مرشح رئيسي",
    oneLineEn: "A free vision model reads each top candidate's real candlestick chart",
  },
  {
    id: "learning-memory",
    nameAr: "ذاكرة التعلّم",
    nameEn: "Learning memory",
    oneLineAr: "سجل النتائج المنشور يعدّل وزن كل استراتيجية (±25٪) ويغذّي اليوميات",
    oneLineEn: "The published record bends each strategy's weight (±25%) and feeds the journal",
  },
  {
    id: "risk-guard",
    nameAr: "حارس المخاطر",
    nameEn: "Risk guard",
    oneLineAr: "بوابات الإجماع والقناعة وحاجز ATR ومخاطر الإفصاح المالي داخل الأفق",
    oneLineEn: "Consensus gate, conviction caps, ATR guard, earnings-inside-horizon flags",
  },
  {
    id: "portfolio",
    nameAr: "توزيع المحفظة",
    nameEn: "Portfolio allocation",
    oneLineAr: "محسّن الحد الأقصى لشارب على الأفكار الفائزة بتغاير حقيقي",
    oneLineEn: "Max-Sharpe optimizer over the winning ideas on real covariance",
  },
];

// ── run kinds + payload extras ──

export type AgentRunKind = "pre-open" | "midday" | "post-close" | "manual";

export const RUN_KIND_AR: Record<AgentRunKind, string> = {
  "pre-open": "تعقيب ما قبل الافتتاح",
  midday: "مسح منتصف الجلسة",
  "post-close": "مراجعة ما بعد الإغلاق",
  manual: "تشغيل يدوي",
};
export const RUN_KIND_EN: Record<AgentRunKind, string> = {
  "pre-open": "pre-open brief",
  midday: "midday scan",
  "post-close": "post-close review",
  manual: "manual run",
};

export type VisionRead = {
  ticker: string;
  pattern: "uptrend" | "downtrend" | "range" | "breakout" | "reversal" | "unclear";
  verdict: "confirm" | "neutral" | "warn";
  noteAr: string;
  noteEn: string;
  ms: number;
};

export type AgentExtras = {
  runKind: AgentRunKind;
  model: string; // the model the API ACTUALLY served
  visionModel: string | null;
  startedAt: string;
  skills: string[];
  vision: VisionRead[];
  journalAr: string;
  journalEn: string;
  /** T46 — the brain's THINKING stream (glm-4.7-flash reasoning_content),
   *  captured verbatim (trimmed) so the agent's reasoning is VISIBLE, not
   *  just claimed. Null when the model thought silently that run. */
  thinking: string | null;
  /** T46 — the supermemory entries the agent RECALLED for this run (what its
   *  own past taught it about THIS situation) — with the match score. */
  memoryRecall: { kind: string; text: string; score: number }[];
  /** T46 — how many memories exist and how many this run stored. */
  memory: { totalBefore: number; stored: number };
  /** T46 — the durable file ledger (signals.jsonl + worklog.md) state. */
  archive: { ledgerRuns: number };
  learning: {
    episodesClosed: number;
    minN: number;
    since: string | null;
    weights: { id: string; nameAr: string; nameEn: string; multiplier: number; decided: number; hitRate: number | null }[];
    noteAr: string;
    noteEn: string;
  };
  memoryLessons: number;
};

export type AgentPayload = AiSetPayload & { agent: AgentExtras };

// ── the vision pass ──

const VISION_TOP_N = 3;
const VISION_MIN_POINTS = 40;
const VISION_MIN_CONSENSUS = 0.25;

const VISION_PROMPT = `You are reading the candlestick chart of an Egyptian Exchange stock (dates at the bottom are sessions; the price panel shows candles with SMA20 in gray and SMA50 in amber; volume strip at the bottom; the ticker, last close and range are printed at the top).
Assess the TECHNICAL picture honestly. Reply with EXACTLY ONE JSON object, no fences:
{
  "ticker": "<the ticker printed on the image>",
  "pattern": "uptrend" | "downtrend" | "range" | "breakout" | "reversal" | "unclear",
  "verdict": "confirm" | "neutral" | "warn",
  "noteAr": "1-2 sentences, pure Modern Standard Arabic (Latin allowed ONLY for tickers/technical acronyms like RSI, SMA, MACD)",
  "noteEn": "1-2 sentences, pure English, concrete (name the levels/trend you see)"
}
"verdict": "confirm" = the chart pattern supports a LONG thesis for this stock; "warn" = the chart contradicts one (breakdown, distribution, parabolic blowoff); "neutral" = mixed or unclear. Never invent numbers that are not readable in the image.`;

function sanitizeVision(
  ticker: string,
  parsed: Record<string, unknown> | null,
  ms: number,
  err?: string
): VisionRead {
  if (!parsed) {
    return {
      ticker,
      pattern: "unclear",
      verdict: "neutral",
      noteAr: err
        ? "تعذّر تحليل الشارت بواسطة نموذج الرؤية هذه المرة — تُحسب الاستراتيجيات العددية فقط."
        : "لم يعد نموذج الرؤية بقراءة قابلة للتحليل.",
      noteEn: err ? "The vision model could not read this chart this run — numeric strategies only." : "The vision model returned no parseable read.",
      ms,
    };
  }
  const patterns = ["uptrend", "downtrend", "range", "breakout", "reversal", "unclear"] as const;
  const verdicts = ["confirm", "neutral", "warn"] as const;
  const pattern = patterns.includes(parsed.pattern as never) ? (parsed.pattern as VisionRead["pattern"]) : "unclear";
  const verdict = verdicts.includes(parsed.verdict as never) ? (parsed.verdict as VisionRead["verdict"]) : "neutral";
  // purity + length guards with deterministic fallbacks
  let noteAr = typeof parsed.noteAr === "string" ? parsed.noteAr.trim().slice(0, 260) : "";
  if (!noteAr || strayLatinInArabic(noteAr).length) {
    noteAr = `نمط الشارت: ${pattern === "uptrend" ? "ترند صاعد" : pattern === "downtrend" ? "ترند هابط" : pattern === "breakout" ? "اختراق" : pattern === "reversal" ? "انعكاس" : pattern === "range" ? "نطاق عرضي" : "غير واضح"}.`;
  }
  let noteEn = typeof parsed.noteEn === "string" ? parsed.noteEn.trim().slice(0, 260) : "";
  if (!noteEn || strayArabicInEnglish(noteEn)) {
    noteEn = `Chart pattern: ${pattern}; verdict ${verdict} for a long thesis.`;
  }
  return { ticker, pattern, verdict, noteAr, noteEn, ms };
}

/** Render the top candidates' tapes and have the vision model read them.
 *  Failures are honest per-chart notes — never silence, never a fake read.
 *  CIRCUIT BREAKER: if two consecutive charts fail (the free vision tier is
 *  overloaded), the remaining charts get honest "unreadable" notes without
 *  burning another ~60s retry chain each — the run proceeds on the numeric
 *  strategies. */
async function visionPass(
  ev: Awaited<ReturnType<typeof gatherEvidence>>,
  learning: LearningState
): Promise<{ reads: VisionRead[]; ms: number; model: string | null }> {
  const ranked = [...ev.candidates]
    .map((c) => ({
      c,
      score: learnedConsensus(c.ens, c.f ? c.f.atrPct : null, learning) ?? c.ens?.consensus ?? 0,
    }))
    .filter(({ c, score }) => c.points.length >= VISION_MIN_POINTS && score >= VISION_MIN_CONSENSUS)
    .sort((a, b) => b.score - a.score)
    .slice(0, VISION_TOP_N);

  const reads: VisionRead[] = [];
  let totalMs = 0;
  let served: string | null = null;
  let consecutiveFailures = 0;
  for (const { c } of ranked) {
    if (consecutiveFailures >= 2) {
      // tier is down for this run — honest note, no more retry chains
      reads.push(sanitizeVision(c.row.ticker, null, 0, "vision tier unavailable"));
      continue;
    }
    const png = renderCandleChartPng(c.points, { ticker: c.row.ticker });
    const t0 = Date.now();
    try {
      const v = await zaiVision({ imageBase64Png: png.toString("base64"), prompt: VISION_PROMPT });
      totalMs += Date.now() - t0;
      served = v.servedModel;
      consecutiveFailures = 0;
      // the reply must identify the SAME ticker the image printed
      const raw = v.content;
      let parsed: Record<string, unknown> | null = null;
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        parsed = m ? (JSON.parse(m[0]) as Record<string, unknown>) : null;
      } catch {
        parsed = null;
      }
      const saidTicker = typeof parsed?.ticker === "string" ? parsed.ticker.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
      if (saidTicker && saidTicker !== c.row.ticker) {
        reads.push(sanitizeVision(c.row.ticker, null, Date.now() - t0, "ticker-mismatch"));
      } else {
        reads.push(sanitizeVision(c.row.ticker, parsed, Date.now() - t0));
      }
    } catch (err) {
      totalMs += Date.now() - t0;
      consecutiveFailures++;
      reads.push(sanitizeVision(c.row.ticker, null, Date.now() - t0, err instanceof Error ? err.message : String(err)));
    }
  }
  return { reads, ms: totalMs, model: served };
}

// ── the brain ──

/** The agent's output contract: the shared pick schema PLUS the journal
 *  reflection. Same language-purity rule (machine-checked post-hoc). */
const AGENT_SCHEMA = `{
  "marketBias": { "direction": "bullish" | "bearish" | "neutral", "conviction": 1-5, "summaryAr": "...", "summaryEn": "..." },
  "picks": [
    {
      "ticker": "COMI", "stance": "long" | "avoid", "conviction": 1-5,
      "horizonSessions": 10,
      "evidence": ["the exact evidence lines from the pack that drove this call"],
      "thesisAr": "2-4 sentences, Egyptian-friendly MSA, concrete numbers",
      "thesisEn": "2-4 sentences, concrete numbers"
    }
  ],
  "notesAr": "one short note for users (regime/caveat), or null",
  "journalAr": "2-4 sentences of the agent's own reflection in pure Arabic: what the skills showed today, what the learning memory says, what you will watch next",
  "journalEn": "the same reflection in pure English"
}

LANGUAGE PURITY (machine-checked before serving): thesisAr/summaryAr/notesAr/journalAr must be PURE Arabic — Latin script is allowed ONLY for tickers and technical acronyms (RSI, MACD, SMA, ATR, P/E, P/B, ROE, EPS, EGP, EGX); never English words like "combination" or "volume". thesisEn/summaryEn/journalEn must be pure English — never Arabic script.`;

function buildAgentUserMsg(
  ev: Awaited<ReturnType<typeof gatherEvidence>>,
  vision: VisionRead[],
  learning: LearningState,
  lessons: { kind: string; textEn: string }[],
  runKind: AgentRunKind,
  memoryRecall: RecalledMemory[],
  archive: ArchiveContext
): string {
  const moved = learning.strategies.filter((s) => s.multiplier !== 1);
  const learningSection = {
    episodesClosed: learning.episodesClosed,
    since: learning.since,
    minNGate: learning.minN,
    movedWeights: moved.map((s) => ({ id: s.id, multiplier: s.multiplier, decided: s.decided, hitRate: s.hitRate })),
    allStrategies: learning.strategies.map((s) => ({ id: s.id, multiplier: s.multiplier, decided: s.decided })),
  };
  const visionSection = vision.map((v) => ({ ticker: v.ticker, pattern: v.pattern, verdict: v.verdict, note: v.noteEn }));
  const memorySection = lessons.map((l) => ({ kind: l.kind, lesson: l.textEn.slice(0, 220) }));
  const learnedPerCandidate = ev.candidates
    .map((c) => ({
      ticker: c.row.ticker,
      base: c.ens?.consensus ?? null,
      learned: learnedConsensus(c.ens, c.f ? c.f.atrPct : null, learning),
    }))
    .filter((x) => x.base !== null);
  // T46 — the supermemory recall: past runs' experience relevant to TODAY's
  // situation (same tickers, same regime). Marked as EXPERIENCE, not evidence.
  const recallSection = memoryRecall.map((m) => ({
    kind: m.kind,
    when: m.createdAt.slice(0, 10),
    score: Number(m.score.toFixed(3)),
    memory: m.text.slice(0, 240),
  }));

  return (
    composeUserMsg(ev) +
    "\n\n" +
    `VISION READS (glm-4.6v-flash read the REAL candlestick PNG of the top candidates — treat as evidence, not orders):\n${JSON.stringify(visionSection)}\n\n` +
    `LEARNING STATE (from the published track record — strategies that earned trust carry more weight in YOUR reasoning; the deterministic gates below never move):\n${JSON.stringify(learningSection)}\n\n` +
    `LEARNED CONSENSUS PER CANDIDATE (base = engine consensus, learned = after the live-record weights):\n${JSON.stringify(learnedPerCandidate)}\n\n` +
    `MEMORY (the latest lessons from your own journal):\n${JSON.stringify(memorySection)}\n\n` +
    `SUPERMEMORY RECALL (your own past memories most relevant to TODAY's situation — same tickers, same regime; treat as EXPERIENCE from your track record, never as new evidence):\n${JSON.stringify(recallSection)}\n\n` +
    `FILE ARCHIVE (your durable signals.jsonl + worklog.md ledger — the last runs exactly as recorded in the files that never get lost):\n${JSON.stringify(archive)}\n\n` +
    `RUN CONTEXT: this is the ${RUN_KIND_EN[runKind]} on the EGX weekday schedule (Sun-Thu, Cairo). Pre-open runs should weigh yesterday's close and overnight context; midday runs the live tape; post-close runs the completed session.\n\n` +
    `Apply the charter. Prefer candidates where the ensemble, the vision read and the learning memory agree; downgrade or avoid where they conflict. Use your recalled experience to sharpen timing and conviction, but the charter's numeric gates decide. Also write your journal reflection.\n` +
    `Reply with EXACTLY ONE JSON object matching this schema:\n` +
    AGENT_SCHEMA
  );
}

// ── memory helpers ──

async function latestLessons(n: number): Promise<{ id: string; kind: string; textAr: string; textEn: string; createdAt: Date }[]> {
  try {
    return await db.agentLesson.findMany({ orderBy: { createdAt: "desc" }, take: n });
  } catch {
    return [];
  }
}

async function lastOkRun(): Promise<{ id: string; startedAt: Date; kind: string; outputJson: string | null } | null> {
  try {
    return await db.agentRun.findFirst({ where: { status: "ok" }, orderBy: { startedAt: "desc" } });
  } catch {
    return null;
  }
}

function learningFromRun(outputJson: string | null): LearningState | null {
  if (!outputJson) return null;
  try {
    const parsed = JSON.parse(outputJson) as { agent?: { learning?: { episodesClosed: number; since: string | null; minN: number; weights?: { id: string; multiplier: number }[] } } };
    const l = parsed.agent?.learning;
    if (!l) return null;
    // a minimal prev-state good enough for diffing (multipliers only)
    return {
      computedAt: "",
      since: l.since ?? null,
      episodesClosed: l.episodesClosed ?? 0,
      minN: l.minN ?? 8,
      strategies: (l.weights ?? []).map((w) => ({
        id: w.id,
        nameAr: "",
        nameEn: "",
        family: "",
        baseWeight: 1,
        multiplier: w.multiplier,
        adaptedWeight: w.multiplier,
        closed: 0,
        hits: 0,
        stopped: 0,
        expired: 0,
        decided: 0,
        hitRate: null,
        avgRetPct: null,
      })),
      noteAr: "",
      noteEn: "",
    };
  } catch {
    return null;
  }
}

// ── the run itself ──

const g = globalThis as unknown as { __egxHermesInflight?: Promise<AgentRunOutcome> };

export type AgentRunOutcome = {
  runId: string;
  ok: boolean;
  kind: AgentRunKind;
  error?: string;
};

/** One autonomous run. Single-flight (a manual trigger and the scheduler can
 *  never race). Persists: AgentRun row + (on success) an AiSignalSet through
 *  the shared spine, live events, and the journal lessons.
 *  T47 — `user` (optional): when a Supabase-authed account triggered the run
 *  (manual trigger while signed in), the mirrored rows are attributed to it. */
export function runHermesAgent(kind: AgentRunKind, user?: { id: string; email: string | null } | null): Promise<AgentRunOutcome> {
  if (g.__egxHermesInflight) return g.__egxHermesInflight;
  const p = (async () => {
    const startedAt = new Date();
    const session = marketStatus().cairoDate;
    let runId = "";
    try {
      // 1. memory + learning (before anything else — even a failed run journals)
      const learning = await computeLearning();
      const lessons = await latestLessons(6);
      const prevRun = await lastOkRun();
      const prevLearning = learningFromRun(prevRun?.outputJson ?? null);
      const memoryBefore = await memoryStats();

      // 2. the evidence pack (same gather as the shared refresh)
      const ev = await gatherEvidence();

      // T46 — SUPERMEMORY recall + the durable FILE archive: what the agent's
      // own past says about THIS situation, read before the brain runs.
      const memoryRecall = await recallForRun(ev, learning, kind);
      const archive = await archiveContext(3);

      // 3. the vision pass
      const vision = await visionPass(ev, learning);

      // 4. the brain — glm-4.7-flash with thinking ON, and the THINKING
      //    STREAM ITSELF is captured (reasoning_content) and ships with the run
      const tBrain = Date.now();
      const brain = await zaiChatJson({
        messages: [
          { role: "assistant", content: STRATEGY_CHARTER },
          {
            role: "assistant",
            content:
              "You are HERMES — the autonomous, self-learning signal agent of EGX Desk. You run on the exchange's weekday schedule, read the skills' evidence (ensemble, technicals, ML, press tone, whale radar, insider filings, vision), remember your own journal and your supermemory recall, and apply the charter with full honesty. You never invent numbers; the charter's ATR math is authoritative. Your conviction must reflect the ensemble agreement and your learning memory.",
          },
          { role: "user", content: buildAgentUserMsg(ev, vision.reads, learning, lessons, kind, memoryRecall, archive) },
        ],
        model: ZAI_SIGNAL_MODEL,
        thinking: true,
        maxTokens: 6000,
      });
      const llmMs = Date.now() - tBrain;
      const thinking = brain.reasoning ? brain.reasoning.trim().slice(0, 2600) : null;

      // 5. the SAME validation spine as the shared refresh + purity via the key
      const chat = async (messages: { role: "user" | "assistant"; content: string }[]) =>
        (await zaiChat({ messages, thinking: false, maxTokens: 1200 })).content;
      const payload = await assembleSet(brain.parsed, ev, chat);

      // 6. agent extras + journal sanitization
      const journalArRaw = typeof brain.parsed.journalAr === "string" ? brain.parsed.journalAr.trim().slice(0, 700) : "";
      const journalEnRaw = typeof brain.parsed.journalEn === "string" ? brain.parsed.journalEn.trim().slice(0, 700) : "";
      const fallbackJournalAr = `راجعت ${ev.candidates.length} مرشحًا عبر ${AGENT_SKILLS.length} مهارات: الإجماع ${payload.marketBias.direction} (قناعة ${payload.marketBias.conviction}/5)، و${payload.picks.length} فكرة بعد بوابات الميثاق. سأراقب ${payload.picks[0]?.ticker ?? "المرشحين"} في التشغيل القادم.`;
      const fallbackJournalEn = `Reviewed ${ev.candidates.length} candidates across ${AGENT_SKILLS.length} skills: consensus ${payload.marketBias.direction} (conviction ${payload.marketBias.conviction}/5), ${payload.picks.length} idea(s) cleared the charter gates. Watching ${payload.picks[0]?.ticker ?? "the candidates"} next run.`;
      const journalAr = journalArRaw && strayLatinInArabic(journalArRaw).length === 0 ? journalArRaw : fallbackJournalAr;
      const journalEn = journalEnRaw && !strayArabicInEnglish(journalEnRaw) ? journalEnRaw : fallbackJournalEn;

      const extras: AgentExtras = {
        runKind: kind,
        model: brain.servedModel,
        visionModel: vision.model,
        startedAt: startedAt.toISOString(),
        skills: AGENT_SKILLS.map((s) => s.id),
        vision: vision.reads,
        journalAr,
        journalEn,
        thinking,
        memoryRecall: memoryRecall.map((m) => ({ kind: m.kind, text: m.text.slice(0, 300), score: Number(m.score.toFixed(3)) })),
        memory: { totalBefore: memoryBefore.total, stored: 0 },
        archive: { ledgerRuns: archive.ledgerRuns.length },
        learning: {
          episodesClosed: learning.episodesClosed,
          minN: learning.minN,
          since: learning.since,
          weights: learning.strategies.map((s) => ({
            id: s.id,
            nameAr: s.nameAr,
            nameEn: s.nameEn,
            multiplier: s.multiplier,
            decided: s.decided,
            hitRate: s.hitRate,
          })),
          noteAr: learning.noteAr,
          noteEn: learning.noteEn,
        },
        memoryLessons: lessons.length,
      };

      const agentPayload: AgentPayload = { ...payload, agent: extras };

      // 7. persist through the SHARED spine: a normal AiSignalSet the whole
      //    app already knows how to serve, track and notify — plus the run row
      const created = await db.aiSignalSet.create({
        data: {
          model: `${brain.servedModel} (hermes)`,
          strategyRev: STRATEGY_REV,
          llmMs,
          data: JSON.stringify(agentPayload),
          backtestRev: backtestJson.strategyRev,
        },
      });
      const emitted = await emitSetEvents(created.id, agentPayload);
      const { emitAgentEvent } = await import("@/lib/signal-events");
      const agentEvent = await emitAgentEvent(created.id, agentPayload);

      // 8. the run row (ok)
      const run = await db.agentRun.create({
        data: {
          startedAt,
          kind,
          session,
          model: brain.servedModel,
          visionModel: vision.model ?? ZAI_VISION_MODEL,
          status: "ok",
          llmMs,
          visionMs: vision.ms,
          setRef: created.id,
          outputJson: JSON.stringify(agentPayload),
        },
      });
      runId = run.id;

      // 9. the journal: reflection + weight changes + first-run milestone
      await db.agentLesson
        .create({
          data: {
            runId: run.id,
            kind: "reflection",
            textAr: journalAr,
            textEn: journalEn,
            dataJson: JSON.stringify({ runKind: kind, picks: payload.picks.map((p: AiPick) => ({ ticker: p.ticker, stance: p.stance, conviction: p.conviction })) }),
          },
        })
        .catch(() => {});
      for (const w of diffLearning(prevLearning, learning)) {
        const dir = w.to > w.from ? "up" : "down";
        const dirAr = dir === "up" ? "أعلى" : "أدنى";
        const hitAr = w.hitRate !== null ? ` (معدل إصابة ${(w.hitRate * 100).toFixed(0)}٪)` : "";
        const hitEn = w.hitRate !== null ? ` (hit rate ${(w.hitRate * 100).toFixed(0)}%)` : "";
        const nameAr = w.nameAr && w.nameAr.length > 0 ? w.nameAr : w.id;
        const nameEn = w.nameEn && w.nameEn.length > 0 ? w.nameEn : w.id;
        await db.agentLesson
          .create({
            data: {
              runId: run.id,
              kind: "weight-change",
              textAr: "وزن «" + nameAr + "» تحرك " + dirAr + ": ×" + w.from.toFixed(2) + " ← ×" + w.to.toFixed(2) + " بعد " + w.decided + " قرارًا" + hitAr + ".",
              textEn: 'Weight of "' + nameEn + '" moved ' + dir + ": ×" + w.from.toFixed(2) + " → ×" + w.to.toFixed(2) + " after " + w.decided + " decided episode(s)" + hitEn + ".",
              dataJson: JSON.stringify(w),
            },
          })
          .catch(() => {});
      }
      if (!prevRun) {
        await db.agentLesson
          .create({
            data: {
              runId: run.id,
              kind: "milestone",
              textAr: "أول تشغيل للوكيل المستقل — بدأ سجل التعلّم، ويزداد ذكاءً مع كل نتيجة تُقاس.",
              textEn: "First autonomous run — the learning record begins; the agent gets smarter with every measured outcome.",
            },
          })
          .catch(() => {});
      }

      // 9b. T46 — SUPERMEMORY: store this run into the unlimited memory so
      //     every FUTURE run can recall it (reflection, each pick + thesis,
      //     the market read, the vision verdicts, the weight-move lessons).
      const storedMemories: { localId: string; kind: string; text: string; createdAt: string }[] = [];
      const mem = async (input: Parameters<typeof rememberMemory>[0]) => {
        const id = await rememberMemory({ ...input, sourceRun: run.id });
        if (id) storedMemories.push({ localId: id, kind: input.kind, text: input.text.slice(0, 700), createdAt: new Date().toISOString() });
      };
      await mem({
        kind: "reflection",
        text: `[${kind} ${session}] ${journalEn}`,
        textAr: journalAr,
        tags: [kind, "reflection", payload.marketBias.direction],
        meta: { runKind: kind, bias: payload.marketBias.direction, conviction: payload.marketBias.conviction, picks: payload.picks.length },
      });
      for (const p of payload.picks) {
        const plan = p.plan;
        await mem({
          kind: "pick",
          text: `[${kind} ${session}] Pick ${p.ticker} ${p.stance} conviction ${p.conviction}/5 — ${p.thesisEn ?? ""}${plan ? ` Plan: entry zone ${plan.zoneLo}-${plan.zoneHi}, stop ${p.stop} (risk ${plan.riskPct}%), targets ${plan.t1}/${plan.t2}/${plan.t3}.` : ""}`,
          textAr: p.thesisAr ?? null,
          tags: [p.ticker, kind, "pick", p.stance],
          meta: { ticker: p.ticker, stance: p.stance, conviction: p.conviction, horizon: p.horizonSessions },
        });
      }
      await mem({
        kind: "bias",
        text: `[${kind} ${session}] Market read: ${payload.marketBias.direction} (conviction ${payload.marketBias.conviction}/5) — ${payload.marketBias.summaryEn ?? ""}`,
        textAr: payload.marketBias.summaryAr ?? null,
        tags: [kind, "bias", payload.marketBias.direction],
      });
      for (const v of vision.reads) {
        await mem({
          kind: "vision",
          text: `[${kind} ${session}] Vision read ${v.ticker}: pattern ${v.pattern}, verdict ${v.verdict} — ${v.noteEn}`,
          tags: [v.ticker, kind, "vision", v.verdict],
          meta: { ticker: v.ticker, pattern: v.pattern, verdict: v.verdict },
        });
      }
      for (const w of diffLearning(prevLearning, learning)) {
        await mem({
          kind: "lesson",
          text: `[${kind} ${session}] Lesson: weight of "${w.nameEn || w.id}" moved ${w.to > w.from ? "up" : "down"} ×${w.from.toFixed(2)} → ×${w.to.toFixed(2)} after ${w.decided} decided episode(s)${w.hitRate !== null ? ` (hit rate ${(w.hitRate * 100).toFixed(0)}%)` : ""}.`,
          tags: [w.id, kind, "weight-change"],
          meta: { strategy: w.id, from: w.from, to: w.to },
        });
      }
      if (!prevRun) {
        await mem({
          kind: "milestone",
          text: `First autonomous run (${session}) — the supermemory and the learning record begin together; recall grows with every measured outcome.`,
          tags: ["milestone", "first-run"],
        });
      }
      extras.memory.stored = storedMemories.length;
      // keep both persisted copies (the AiSignalSet + the AgentRun row) in
      // sync with the FINAL memory count — the served payload is the truth
      await db.aiSignalSet.update({ where: { id: created.id }, data: { data: JSON.stringify(agentPayload) } }).catch(() => {});
      await db.agentRun.update({ where: { id: run.id }, data: { outputJson: JSON.stringify(agentPayload) } }).catch(() => {});

      // 9c. T46 — the SIGNALS FILE + WORKLOG FILE: the durable ledger the
      //     agent reads back next run — context that survives anything.
      await appendSignalRun({
        at: startedAt.toISOString(),
        kind,
        runId: run.id,
        setRef: created.id,
        model: brain.servedModel,
        visionModel: vision.model,
        bias: { direction: payload.marketBias.direction, conviction: payload.marketBias.conviction },
        picks: payload.picks.map((p: AiPick) => ({
          ticker: p.ticker,
          stance: p.stance,
          conviction: p.conviction,
          horizonSessions: p.horizonSessions ?? null,
          entryZone: p.plan ? [p.plan.zoneLo, p.plan.zoneHi] : null,
          targets: p.plan ? [p.plan.t1, p.plan.t2, p.plan.t3] : null,
          stop: p.stop ?? null,
          riskPct: p.plan?.riskPct ?? null,
        })),
      });
      await appendWorklog({
        at: startedAt.toISOString(),
        kind,
        ok: true,
        picks: payload.picks.map((p: AiPick) => ({ ticker: p.ticker, stance: p.stance, conviction: p.conviction })),
        bias: { direction: payload.marketBias.direction, conviction: payload.marketBias.conviction },
        journalEn,
        model: brain.servedModel,
        visionModel: vision.model,
      });

      // 9d. T46 — the SUPABASE mirror (no-op until the user's project keys
      //     are set; honest status either way — see docs/SUPABASE-SETUP.md).
      //     T47: signed-in Supabase users get their runs attributed.
      await mirrorAgentRun({
        user: user ?? null,
        run: {
          runId: run.id,
          startedAt: startedAt.toISOString(),
          kind,
          session,
          model: brain.servedModel,
          visionModel: vision.model,
          llmMs,
          visionMs: vision.ms,
          setRef: created.id,
        },
        bias: { direction: payload.marketBias.direction, conviction: payload.marketBias.conviction },
        picks: payload.picks.map((p: AiPick) => ({
          ticker: p.ticker,
          stance: p.stance,
          conviction: p.conviction,
          horizonSessions: p.horizonSessions ?? null,
          entryZone: p.plan ? [p.plan.zoneLo, p.plan.zoneHi] : null,
          targets: p.plan ? [p.plan.t1, p.plan.t2, p.plan.t3] : null,
          stop: p.stop ?? null,
          riskPct: p.plan?.riskPct ?? null,
        })),
        memories: storedMemories,
        worklogMarkdown: await readWorklogTail(400_000),
      });

      // 10. usage metering (visible in /api/usage; signals-only key usage)
      await db.usageEvent
        .create({
          data: {
            ip: "system",
            route: "hermes-agent",
            llmCalls: 1 + vision.reads.length,
            toolCalls: 0,
            webSearches: 0,
            ok: true,
            ms: Date.now() - startedAt.getTime(),
          },
        })
        .catch(() => {});

      console.log(
        `[hermes] ${kind} run ok: ${payload.picks.length} picks, bias ${payload.marketBias.direction}, vision ${vision.reads.length} chart(s) (${vision.ms}ms), brain ${llmMs}ms, events ${emitted + agentEvent}`
      );
      return { runId, ok: true, kind };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[hermes] ${kind} run FAILED:`, message);
      // a failed run is journaled into the WORKLOG FILE too — the honest
      // ledger records failures, never hides them
      void appendWorklog({ at: startedAt.toISOString(), kind, ok: false, picks: [], journalEn: "", error: message.slice(0, 400) });
      try {
        const run = await db.agentRun.create({
          data: {
            startedAt,
            kind,
            session,
            model: ZAI_SIGNAL_MODEL,
            visionModel: ZAI_VISION_MODEL,
            status: "failed",
            error: message.slice(0, 900),
          },
        });
        runId = run.id;
        await db.usageEvent
          .create({ data: { ip: "system", route: "hermes-agent", llmCalls: 1, ok: false, ms: Date.now() - startedAt.getTime() } })
          .catch(() => {});
      } catch {
        /* db unreachable — nothing more to do honestly */
      }
      return { runId, ok: false, kind, error: message };
    }
  })().finally(() => {
    setTimeout(() => {
      if (g.__egxHermesInflight === p) g.__egxHermesInflight = undefined;
    }, 1000);
  });
  g.__egxHermesInflight = p;
  return p;
}

// ── the served state (GET /api/agent-signals) ──

export type AgentRunMeta = {
  id: string;
  kind: string;
  session: string;
  startedAt: string;
  status: string;
  model: string;
  visionModel: string | null;
  llmMs: number;
  visionMs: number;
  setRef: string | null;
  error: string | null;
};

export type AgentLessonRow = {
  id: string;
  kind: string;
  textAr: string;
  textEn: string;
  createdAt: string;
};

export type AgentState = {
  ok: true;
  models: { brain: string; vision: string };
  latest: { run: AgentRunMeta; payload: AgentPayload } | null;
  learning: LearningState;
  lessons: AgentLessonRow[];
  runs: AgentRunMeta[];
  /** T46 — the supermemory state: total memories, kind breakdown, cloud mode. */
  memory: Awaited<ReturnType<typeof memoryStats>>;
  /** T46 — the durable file ledger state (signals.jsonl + worklog.md). */
  archive: Awaited<ReturnType<typeof import("@/lib/agent-archive").archiveStatus>>;
  /** T46 — the Supabase mirror state (off until the user's keys are set). */
  supabase: ReturnType<typeof supabaseMirrorStatus>;
};

export async function getAgentState(): Promise<AgentState> {
  const learning = await computeLearning();
  let runs: AgentRunMeta[] = [];
  let lessons: AgentLessonRow[] = [];
  try {
    const rows = await db.agentRun.findMany({ orderBy: { startedAt: "desc" }, take: 12 });
    runs = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      session: r.session,
      startedAt: r.startedAt.toISOString(),
      status: r.status,
      model: r.model,
      visionModel: r.visionModel,
      llmMs: r.llmMs,
      visionMs: r.visionMs,
      setRef: r.setRef,
      error: r.error,
    }));
    const lrows = await db.agentLesson.findMany({ orderBy: { createdAt: "desc" }, take: 14 });
    lessons = lrows.map((l) => ({
      id: l.id,
      kind: l.kind,
      textAr: l.textAr,
      textEn: l.textEn,
      createdAt: l.createdAt.toISOString(),
    }));
  } catch {
    /* db hiccup — empty lists, learning still serves */
  }
  const { archiveStatus } = await import("@/lib/agent-archive");

  const latestOk = runs.find((r) => r.status === "ok");
  let latest: AgentState["latest"] = null;
  if (latestOk) {
    try {
      const row = await db.agentRun.findUnique({ where: { id: latestOk.id } });
      if (row?.outputJson) {
        const payload = JSON.parse(row.outputJson) as AgentPayload;
        // the panel needs the agent extras — a malformed/extras-less row is
        // skipped honestly rather than half-rendered
        if (payload && payload.agent && Array.isArray(payload.picks)) {
          latest = { run: latestOk, payload };
        }
      }
    } catch {
      latest = null;
    }
  }

  return {
    ok: true,
    models: { brain: ZAI_SIGNAL_MODEL, vision: ZAI_VISION_MODEL },
    latest,
    learning,
    lessons,
    runs,
    memory: await memoryStats(),
    archive: await archiveStatus(),
    supabase: supabaseMirrorStatus(),
  };
}

/** Manual trigger guard: at most one run of ANY kind per 10 minutes. */
export async function canTriggerManual(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const last = await db.agentRun.findFirst({ orderBy: { startedAt: "desc" } });
    if (last && Date.now() - last.startedAt.getTime() < 10 * 60_000) {
      return { ok: false, reason: "cooling" };
    }
  } catch {
    /* db hiccup — allow the attempt; the run itself records honestly */
  }
  return { ok: true };
}

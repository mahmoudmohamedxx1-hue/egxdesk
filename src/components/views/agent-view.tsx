"use client";

/** AI Agent — now a FULL-PAGE chat (Task 23): clicking the AI Agent nav item
 *  takes over the whole viewport (the app shell's header/nav/footer are not
 *  rendered for this view), exactly like a standalone Claude-style page:
 *
 *  - h-dvh canvas in the warm cream/charcoal chat palette, own slim top bar
 *    (back-to-desk + logo + title, history, new chat, theme & language — the
 *    controls the hidden main header would normally carry).
 *  - The CHAT HISTORY lives in a real SIDEBAR (Task 24): a drawer that pushes
 *    the chat aside on desktop and overlays it (with a dim backdrop) on
 *    phones — opened/closed from the top bar, its header X, backdrop tap or
 *    Escape, and the open/closed choice is remembered in localStorage.
 *  - The message column fills ALL remaining height (flex-1, own scroll) and
 *    the composer pins to the bottom of the viewport.
 *  - USER messages are soft rounded bubbles on the end side; ASSISTANT
 *    messages have NO bubble — plain generous text in a serif voice (Lora
 *    for Latin / Amiri for Arabic) under a terracotta asterisk mark.
 *  - The composer is the Claude-style input: auto-growing canvas with its
 *    own focus ring, a round "+" context button, tools/model chips, an
 *    "extended thinking" toggle (a REAL flag the backend honors), and the
 *    filled circular send button that becomes stop while streaming.
 *  - The model chip states the FULL served model name (GLM-4-Plus by Z.ai),
 *    verified against the gateway's own response payload.
 *
 *  Everything else from Task 20/21/22 is preserved: SSE streaming with live
 *  tool chips, stop/copy controls, server-side chat history + usage strip,
 *  bilingual rendering, ?q= deep-link prefill (never auto-sent). */

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/market/app-context";
import { T, tt } from "@/lib/i18n";
import { AgentMarkdown } from "@/components/market/agent-markdown";
import { ClaudeInput } from "@/components/market/claude-input";
import { ModelSwitcher, useAiModel } from "@/components/market/model-switcher";
import { bootParam } from "@/lib/url-state";
import { copyText } from "@/lib/url-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ArrowLeft, Check, Copy, Eraser, History, Languages, Moon, Sparkles, Sun, Trash2, Wrench, X,
} from "lucide-react";
import { getDeviceId } from "@/lib/push-client";
import { useTheme } from "next-themes";
import { puterChat, puterSignedIn, puterSignIn, PuterAuthRequiredError } from "@/lib/assistant-models";
import { findAiModel, aiModelLabel, aiModelIdentity } from "@/lib/ai-models";
import { buildAgentSystemPrompt, extractJson, makeFinalPreviewer } from "@/lib/agent-protocol";

type AgentStep = {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
};

type AgentMsg = {
  role: "user" | "assistant";
  content: string;
  steps?: AgentStep[];
  error?: boolean;
  ts: number;
  /** T37 — the model that ACTUALLY served this answer (done event); when a
   *  keyless model auto-fell back to GLM-4-Plus, this records it honestly. */
  servedModel?: string;
};

const CHAT_KEY = "egx-agent-chat";
const CHAT_ID_KEY = "egx-agent-chat-id";
const THINK_KEY = "egx-agent-deep";
const SIDEBAR_KEY = "egx-agent-sidebar"; // "1"/"0" — remembered open/closed choice
const MAX_STORED = 80;

type HistoryRow = { id: string; title: string; updatedAt: string; count: number };
type UsageSummary = { today: { questions: number; llmCalls: number }; limits?: { agentQuestionsPerHourPerUser?: number } };

function newChatId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {}
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const TOOL_LABELS: Record<string, { ar: string; en: string }> = {
  market_overview: { ar: "نظرة السوق", en: "Market overview" },
  top_movers: { ar: "الأكثر حركة", en: "Top movers" },
  quote: { ar: "سعر سهم", en: "Stock quote" },
  screen: { ar: "فرز السوق", en: "Screening" },
  technicals: { ar: "تحليل فني", en: "Technicals" },
  best_signals: { ar: "أفضل الإشارات", en: "Best signals" },
  statements: { ar: "القوائم المالية", en: "Statements" },
  dividends: { ar: "التوزيعات", en: "Dividends" },
  news: { ar: "الأخبار", en: "News" },
  calendar: { ar: "التقويم", en: "Calendar" },
  rates: { ar: "أسعار الفائدة", en: "Interest rates" },
  insiders: { ar: "تعاملات الداخليين", en: "Insider deals" },
  compare: { ar: "مقارنة", en: "Compare" },
  web_search: { ar: "بحث الويب", en: "Web search" },
  ai_signals: { ar: "إشارات AI", en: "AI signals" },
  desk_reports: { ar: "تقارير المكتب", en: "Desk reports" },
};

const SUGGESTIONS = [T.agentSuggest1, T.agentSuggest2, T.agentSuggest3, T.agentSuggest4, T.agentSuggest5, T.agentSuggest6];

/** The terracotta asterisk mark — an original 12-ray sunburst that plays the
 *  role of the assistant's avatar (inspired by reference AI chats, not a
 *  copy of any logo). */
function ClaudeMark({ className }: { className?: string }) {
  const rays = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      {rays.map((a) => {
        const rad = (a * Math.PI) / 180;
        const x1 = 12 + Math.sin(rad) * 3.4;
        const y1 = 12 - Math.cos(rad) * 3.4;
        const x2 = 12 + Math.sin(rad) * 10.2;
        const y2 = 12 - Math.cos(rad) * 10.2;
        return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />;
      })}
    </svg>
  );
}

function StepChips({ steps, lang }: { steps: AgentStep[]; lang: "ar" | "en" }) {
  if (!steps.length) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-2" aria-label={tt(T.agentStepsUsed, lang)}>
      <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: "var(--chat-muted)" }}>
        <Wrench className="h-3 w-3" aria-hidden />
        {tt(T.agentStepsUsed, lang)}:
      </span>
      {steps.map((s, i) => (
        <span
          key={i}
          className={`num inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            s.ok ? "bg-secondary/70 text-muted-foreground" : "bg-down-soft text-down"
          }`}
          title={`${s.tool} ${JSON.stringify(s.args).slice(0, 120)}`}
        >
          {tt(TOOL_LABELS[s.tool] ?? { ar: s.tool, en: s.tool }, lang)}
          {s.ok ? "✓" : "✕"}
        </span>
      ))}
    </div>
  );
}

function CopyAnswer({ text, lang }: { text: string; lang: "ar" | "en" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void copyText(text).then((ok) => {
          if (ok) {
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          }
        });
      }}
      aria-label={tt(T.agentCopy, lang)}
      title={tt(T.agentCopy, lang)}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] transition-colors hover:bg-accent"
      style={{ color: "var(--chat-muted)" }}
    >
      {done ? <Check className="h-3 w-3 text-up" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      {done ? tt(T.agentCopied, lang) : tt(T.agentCopy, lang)}
    </button>
  );
}

/** One exchange: user bubble (end side) / assistant serif answer under the
 *  sunburst mark (no bubble — the reference chat grammar). */
function Exchange({ m, lang }: { m: AgentMsg; lang: "ar" | "en" }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap"
          style={{ backgroundColor: "var(--chat-bubble)", color: "var(--chat-ink)" }}
        >
          {m.content}
        </div>
      </div>
    );
  }
  return (
    <div className="group space-y-2">
      <div className="flex items-center gap-2">
        <ClaudeMark className="h-5 w-5 shrink-0" />
        <span className="text-[11px] font-medium" style={{ color: "var(--chat-muted)" }}>
          EGX Desk
        </span>
        {m.servedModel && (
          <span
            className="num rounded-full border px-1.5 py-0 text-[9.5px] leading-4"
            style={{ color: "var(--chat-muted)" }}
            title={lang === "ar" ? "النموذج الذي أجاب فعليًا" : "The model that actually served this answer"}
          >
            {m.servedModel}
          </span>
        )}
      </div>
      {m.steps && !m.error && <StepChips steps={m.steps} lang={lang} />}
      {m.error ? (
        <p className="text-sm leading-relaxed text-down">{m.content}</p>
      ) : (
        <div className="claude-serif text-[15px] leading-[1.85]" style={{ color: "var(--chat-ink)" }}>
          <AgentMarkdown text={m.content} />
        </div>
      )}
      {!m.error && (
        <div className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-60">
          <CopyAnswer text={m.content} lang={lang} />
        </div>
      )}
    </div>
  );
}

export function AgentView() {
  const { lang, setLang, navigate, toast } = useApp();
  const { theme, setTheme } = useTheme();
  const [messages, setMessages] = useState<AgentMsg[]>([]);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [modelId, setModelId] = useAiModel(); // T30 — free cloud model switcher
  const [elapsed, setElapsed] = useState(0);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false); // chat-history sidebar (Task 24)
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryRow[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const chatIdRef = useRef<string>("");
  const lastQueryRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const puterStopRef = useRef(false); // T33 — stop flag for the client-side Puter loop

  // restore the chat from the device (SSR-safe mount read); a shared
  // ?q=… link prefills the composer (never auto-sends — it would burn the
  // recipient's AI quota without their consent)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          setMessages(
            arr
              .filter((m): m is AgentMsg => m && typeof m === "object" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
              .slice(-MAX_STORED)
          );
        }
      }
      let id = localStorage.getItem(CHAT_ID_KEY);
      if (!id) {
        id = newChatId();
        localStorage.setItem(CHAT_ID_KEY, id);
      }
      chatIdRef.current = id;
      setDeep(localStorage.getItem(THINK_KEY) === "1");
      // remembered sidebar choice; first visit defaults to OPEN on desktop
      // (Claude-like) and closed on phones, where it is an overlay
      try {
        const pref = localStorage.getItem(SIDEBAR_KEY);
        setHistoryOpen(pref === null ? window.matchMedia("(min-width: 640px)").matches : pref === "1");
      } catch {}
    } catch {}
    const q = bootParam("q");
    if (q) setInput(q.slice(0, 2000));
    setReady(true);
  }, []);

  const persist = (next: AgentMsg[]) => {
    setMessages(next);
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(next.slice(-MAX_STORED)));
    } catch {}
  };

  const toggleDeep = () => {
    setDeep((d) => {
      const next = !d;
      try {
        localStorage.setItem(THINK_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  /** open/close the chat-history sidebar — the choice is remembered */
  const setSidebar = (open: boolean) => {
    setHistoryOpen(open);
    try {
      localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0");
    } catch {}
  };

  const toggleSidebar = () => setSidebar(!historyOpen);

  /** on phones the sidebar is an overlay — dismiss it after picking a chat;
   *  on desktop it stays put (Claude-like behavior) */
  const closeSidebarOnMobile = () => {
    if (typeof window !== "undefined" && window.innerWidth < 640) setSidebar(false);
  };

  // elapsed-seconds timer while the agent works
  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // keep the newest message in view (also while the answer streams in)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, liveSteps, streamText]);

  // Escape closes the history sidebar (it behaves like a drawer)
  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebar(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyOpen]);

  // ── T33: the CLIENT-side agent loop for free Puter cloud models ──
  // Same protocol as the server loop: plan (strict JSON) → execute tool
  // server-side via POST /api/agent/tools → answer. The LLM rounds run in
  // the browser through puter.js; the tools still return only real data.
  const askViaPuter = async (history: AgentMsg[], q: string, modelIdStr: string) => {
    const m = findAiModel(modelIdStr);
    const label = aiModelLabel(modelIdStr);
    const identity = m ? aiModelIdentity(m) : `a REAL large language model (${label} — served via the free Puter cloud)`;

    // sign-in gate — one free Puter account unlocks the whole cloud ladder
    if (!(await puterSignedIn().catch(() => false))) {
      persist([
        ...history,
        {
          role: "assistant",
          content: `**${tt(T.aiPuterSigninCardTitle, lang)}**\n\n${tt(T.aiPuterSigninCardBody, lang)}`,
          error: true,
          ts: Date.now(),
        },
      ]);
      // surface the Puter sign-in popup right away — the user asked a question
      void puterSignIn().catch(() => {});
      return;
    }

    puterStopRef.current = false;
    const stepsAcc: AgentStep[] = [];
    let streamSoFar = "";
    setLiveNote(`${label} — thinking`);

    const msgs: { role: "user" | "assistant"; content: string }[] = [
      { role: "assistant", content: buildAgentSystemPrompt(lang, identity) },
      ...history
        .filter((x) => !x.error)
        .slice(-24)
        .map((x) => ({ role: x.role, content: x.content.slice(0, 8000) })),
    ];

    try {
      let corrections = 0;
      let answered = false;
      const seenCalls = new Set<string>(); // T36 — duplicate-tool-call guard
      for (let round = 0; round < 11 && stepsAcc.length < 10; round++) {
        if (puterStopRef.current) break;
        // live preview: decode the {"final": "… body as it streams
        let prevLen = 0;
        const preview = makeFinalPreviewer((text) => {
          streamSoFar += text;
          setStreamText(streamSoFar);
        });
        const out = await puterChat(modelIdStr, msgs, {
          onDelta: (full) => {
            preview(full.slice(prevLen));
            prevLen = full.length;
          },
          stopped: () => puterStopRef.current,
          timeoutMs: 240_000,
        });
        if (puterStopRef.current) break;

        const parsed = extractJson(out);
        if (!parsed || (!("tool" in parsed) && !("final" in parsed))) {
          corrections++;
          if (corrections > 2) break;
          msgs.push({
            role: "user",
            content:
              'Format error. Reply with exactly ONE JSON object, no fences: {"tool": "<name>", "args": {...}} to call a tool, or {"final": "<markdown answer>"} to answer.',
          });
          continue;
        }

        if (typeof parsed.final === "string" && parsed.final.trim().length > 0) {
          const finalSteps = [...stepsAcc];
          const answerMsg: AgentMsg = { role: "assistant", content: parsed.final.trim(), steps: finalSteps, ts: Date.now() };
          persist([...history, answerMsg]);
          saveChat([...history, answerMsg]); // server-side history (fire-and-forget)
          answered = true;
          break;
        }

        const toolName = typeof parsed.tool === "string" ? parsed.tool : "";
        const args = (parsed.args && typeof parsed.args === "object" ? parsed.args : {}) as Record<string, unknown>;
        if (!toolName) {
          corrections++;
          if (corrections > 2) break;
          continue;
        }

        // T36 — duplicate-call guard: identical tool+args is a loop, not
        // progress — nudge the model to synthesize from what it already has
        const callKey = `${toolName}:${JSON.stringify(args)}`;
        if (seenCalls.has(callKey)) {
          msgs.push({
            role: "user",
            content:
              'You already called this tool with these EXACT arguments and its result is above in the conversation. Do NOT call it again. Reply NOW with your final answer in the format {"final": "<markdown answer>"} using the data you already have.',
          });
          continue;
        }
        seenCalls.add(callKey);

        // tool execution stays SERVER-side — real data, real rate limits
        setLiveNote(`${label} · ${tt(TOOL_LABELS[toolName] ?? { ar: toolName, en: toolName }, lang)}`);
        let result: unknown;
        let ok = false;
        try {
          const res = await fetch("/api/agent/tools", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tool: toolName, args, lang, deviceId: getDeviceId() }),
          });
          const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown };
          result = json.result ?? { error: "tool call failed" };
          ok = res.ok && json.ok !== false;
        } catch {
          result = { error: "tool call failed" };
        }
        stepsAcc.push({ tool: toolName, args, ok });
        setLiveSteps([...stepsAcc]);
        msgs.push({ role: "user", content: JSON.stringify(result).slice(0, 9000) });
      }

      if (!answered && !puterStopRef.current && stepsAcc.length > 0) {
        // loop exhausted — force one synthesis round from the collected data
        msgs.push({
          role: "user",
          content:
            'Tool budget exhausted. Reply NOW with your final answer using ONLY the tool data collected above — do not request more tools. Format: {"final": "<markdown answer>"}',
        });
        let prevLen = 0;
        const preview = makeFinalPreviewer((text) => {
          streamSoFar += text;
          setStreamText(streamSoFar);
        });
        try {
          const out = await puterChat(modelIdStr, msgs, {
            onDelta: (full) => {
              preview(full.slice(prevLen));
              prevLen = full.length;
            },
            stopped: () => puterStopRef.current,
            timeoutMs: 240_000,
          });
          const parsed = extractJson(out);
          if (parsed && typeof parsed.final === "string" && parsed.final.trim().length > 0) {
            persist([...history, { role: "assistant", content: parsed.final.trim(), steps: [...stepsAcc], ts: Date.now() }]);
            answered = true;
          }
        } catch {
          /* fall through to the honest fallback */
        }
      }

      if (!answered) {
        if (puterStopRef.current) {
          persist([
            ...history,
            streamSoFar.trim()
              ? { role: "assistant", content: streamSoFar, ts: Date.now() }
              : { role: "assistant", content: tt(T.agentStopped, lang), error: true, ts: Date.now() },
          ]);
        } else {
          persist([
            ...history,
            {
              role: "assistant",
              content:
                lang === "ar"
                  ? "وصلتُ لحد الأدوات المتاحة دون إجابة كاملة. جرّب إعادة السؤال بصيغة أبسط (مثال: «ما حالة السوق الآن؟» أو «quote لسهم COMI»)."
                  : "I ran out of tool budget without a complete answer. Try rephrasing (e.g. \"market overview\" or \"quote for COMI\").",
              ts: Date.now(),
            },
          ]);
        }
      }
    } catch (err) {
      if (err instanceof PuterAuthRequiredError) {
        persist([
          ...history,
          {
            role: "assistant",
            content: `**${tt(T.aiPuterSigninCardTitle, lang)}**\n\n${tt(T.aiPuterSigninCardBody, lang)}`,
            error: true,
            ts: Date.now(),
          },
        ]);
        return;
      }
      persist([
        ...history,
        {
          role: "assistant",
          content: `${tt(T.agentError, lang)}${err instanceof Error ? ` (${err.message})` : ""}`,
          error: true,
          ts: Date.now(),
        },
      ]);
    } finally {
      puterStopRef.current = false;
    }
  };

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    lastQueryRef.current = q;
    const userMsg: AgentMsg = { role: "user", content: q, ts: Date.now() };
    const history = [...messages, userMsg];
    persist(history);
    setInput("");
    setBusy(true);
    setLiveSteps([]);
    setLiveNote(null);
    setStreamText("");
    const ac = new AbortController();
    abortRef.current = ac;
    let streamSoFar = "";

    // T33 — free Puter cloud models run the loop CLIENT-side; the app's own
    // server model keeps the SSE path
    if (modelId.startsWith("puter:")) {
      try {
        await askViaPuter(history, q, modelId);
      } finally {
        abortRef.current = null;
        setBusy(false);
        setLiveSteps([]);
        setLiveNote(null);
        setStreamText("");
      }
      return;
    }

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          messages: history.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })),
          lang,
          deviceId: getDeviceId(), // usage metering + per-user hourly limit
          deep, // the composer's extended-thinking toggle (Task 22-b)
          model: modelId, // T30 — free cloud model chosen in the composer
        }),
      });
      const ct = res.headers.get("content-type") ?? "";
      // plain-JSON error path (429 rate limit / 400 validation / gateway html)
      if (!res.ok || !ct.includes("text/event-stream")) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        persist([
          ...history,
          {
            role: "assistant",
            content: json.error ? `${tt(T.agentError, lang)} (${json.error})` : tt(T.agentError, lang),
            error: true,
            ts: Date.now(),
          },
        ]);
        return;
      }
      // SSE stream: tool steps arrive as they run, the answer previews live
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no stream body");
      const dec = new TextDecoder();
      let buf = "";
      let gotTerminal = false;
      const stepsAcc: AgentStep[] = [];
      const handleEvent = (evt: Record<string, unknown>) => {
        if (evt.type === "step") {
          stepsAcc.push({ tool: String(evt.tool ?? ""), args: (evt.args as Record<string, unknown>) ?? {}, ok: evt.ok !== false });
          setLiveSteps([...stepsAcc]);
        } else if (evt.type === "status") {
          setLiveNote(typeof evt.note === "string" ? evt.note : null);
        } else if (evt.type === "delta" && typeof evt.text === "string") {
          streamSoFar += evt.text;
          setStreamText(streamSoFar);
        } else if (evt.type === "done" && typeof evt.answer === "string") {
          gotTerminal = true;
          const finalSteps = Array.isArray(evt.steps) ? (evt.steps as AgentStep[]) : stepsAcc;
          const next: AgentMsg[] = [
            ...history,
            {
              role: "assistant",
              content: evt.answer,
              steps: finalSteps,
              ts: Date.now(),
              ...(typeof evt.model === "string" && evt.model ? { servedModel: evt.model } : {}),
            },
          ];
          persist(next);
          saveChat(next); // server-side history (fire-and-forget)
        } else if (evt.type === "error") {
          gotTerminal = true;
          persist([
            ...history,
            {
              role: "assistant",
              content: evt.message ? `${tt(T.agentError, lang)} (${evt.message})` : tt(T.agentError, lang),
              error: true,
              ts: Date.now(),
            },
          ]);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const rawEvt = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          for (const line of rawEvt.split("\n")) {
            if (!line.startsWith("data:")) continue;
            try {
              handleEvent(JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
            } catch {
              /* partial line — the next chunk completes it */
            }
          }
        }
      }
      if (!gotTerminal) throw new Error("stream ended without a terminal event");
    } catch (err) {
      // user pressed stop — keep whatever streamed as the (partial) answer
      if (err instanceof DOMException && err.name === "AbortError") {
        if (streamSoFar.trim()) {
          persist([...history, { role: "assistant", content: streamSoFar, ts: Date.now() }]);
        } else {
          persist([...history, { role: "assistant", content: tt(T.agentStopped, lang), error: true, ts: Date.now() }]);
        }
      } else {
        persist([...history, { role: "assistant", content: tt(T.agentError, lang), error: true, ts: Date.now() }]);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setLiveSteps([]);
      setLiveNote(null);
      setStreamText("");
    }
  };

  const stop = () => {
    puterStopRef.current = true; // T33 — stops the client-side Puter loop
    abortRef.current?.abort();
  };

  const retry = () => {
    if (lastQueryRef.current && !busy) void ask(lastQueryRef.current);
  };

  // ── server-side chat history (auto-saved after every exchange) ──

  const saveChat = (msgs: AgentMsg[]) => {
    const id = chatIdRef.current;
    if (!id || msgs.length === 0) return;
    const title = (msgs.find((m) => m.role === "user")?.content ?? "").slice(0, 80);
    void fetch("/api/agent/chats", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: getDeviceId(),
        id,
        title,
        messages: msgs.filter((m) => !m.error).slice(-80),
      }),
    }).catch(() => {}); // best-effort — the next exchange retries
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/agent/chats?deviceId=${encodeURIComponent(getDeviceId())}`);
      const json = (await res.json()) as { chats?: HistoryRow[] };
      setHistoryList(json.chats ?? []);
    } catch {}
    setHistoryLoading(false);
    // usage metering strip (best-effort, never blocks the panel)
    try {
      const res = await fetch("/api/usage");
      if (res.ok) setUsage((await res.json()) as UsageSummary);
    } catch {}
  };

  // refresh the saved-conversations list every time the sidebar opens
  useEffect(() => {
    if (historyOpen) void loadHistory();
  }, [historyOpen]);

  const loadChat = async (id: string) => {
    if (busy) return;
    try {
      const res = await fetch(`/api/agent/chats?deviceId=${encodeURIComponent(getDeviceId())}&id=${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const json = (await res.json()) as { messages?: AgentMsg[] };
      const msgs = (json.messages ?? [])
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-MAX_STORED);
      persist(msgs);
      chatIdRef.current = id;
      try {
        localStorage.setItem(CHAT_ID_KEY, id);
      } catch {}
      closeSidebarOnMobile();
    } catch {}
  };

  const deleteChat = async (id: string) => {
    try {
      await fetch(`/api/agent/chats?deviceId=${encodeURIComponent(getDeviceId())}&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setHistoryList((h) => h.filter((c) => c.id !== id));
      if (chatIdRef.current === id) {
        startNewChat();
        toast(tt(T.agentChatDeleted, lang));
      }
    } catch {}
  };

  const startNewChat = () => {
    const id = newChatId();
    chatIdRef.current = id;
    try {
      localStorage.setItem(CHAT_ID_KEY, id);
    } catch {}
    persist([]);
    closeSidebarOnMobile();
  };

  const newChat = () => {
    startNewChat();
    toast(tt(T.agentClear, lang));
  };

  const suggestions = SUGGESTIONS.slice(0, 6);

  /** the composer's bottom-left chips: tools · extended thinking · model */
  const toolbar = (
    <>
      {/* tools chip */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={tt(T.agentAttachTitle, lang)}
            title={tt(T.agentAttachTitle, lang)}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors hover:opacity-80"
            style={{ color: "var(--chat-muted)" }}
          >
            <Wrench className="h-3 w-3" aria-hidden />
            <span className="hidden sm:inline">{tt(T.agentToolsInfo, lang)}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3 space-y-1.5">
          <p className="text-[11px] font-semibold">{tt(T.agentToolsInfo, lang)}</p>
          <p className="text-[10px] leading-relaxed text-muted-foreground">{tt(T.agentToolsHint, lang)}</p>
          <ul className="max-h-52 overflow-y-auto thin-scroll pt-1">
            {Object.entries(TOOL_LABELS).map(([key, label]) => (
              <li key={key} className="flex items-center gap-1.5 py-0.5 text-[11px]">
                <Check className="h-3 w-3 text-up shrink-0" aria-hidden />
                {tt(label, lang)}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>

      {/* extended thinking toggle — a REAL flag honored by /api/agent */}
      <button
        type="button"
        onClick={toggleDeep}
        aria-pressed={deep}
        aria-label={tt(T.agentThinkingToggle, lang)}
        title={tt(T.agentThinkingHint, lang)}
        className="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-all"
        style={
          deep
            ? { backgroundColor: "var(--chat-accent-soft)", borderColor: "var(--chat-accent)", color: "var(--chat-accent)" }
            : { color: "var(--chat-muted)" }
        }
      >
        <Sparkles className="h-3 w-3" aria-hidden />
        <span className="hidden sm:inline">{tt(T.agentThinkingToggle, lang)}</span>
      </button>

      {/* T30 — model switcher: the free-cloud model dropdown (the done event
          reports the model the provider actually served) */}
      <ModelSwitcher lang={lang} modelId={modelId} onModelChange={setModelId} />
    </>
  );

  /** the "+" context popover: quick prompts about the desk's data */
  const plusMenu = (
    <>
      <p className="text-[11px] font-semibold">{tt(T.agentQuickPrompts, lang)}</p>
      <p className="text-[10px] leading-relaxed text-muted-foreground">{tt(T.agentToolsHint, lang)}</p>
      <ul className="max-h-56 overflow-y-auto thin-scroll pt-1">
        {suggestions.map((s, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => {
                setInput(tt(s, lang));
                closeSidebarOnMobile();
              }}
              className="w-full text-start rounded-md px-2 py-1.5 text-[11px] hover:bg-accent/60 transition-colors"
            >
              {tt(s, lang)}
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <section
      className="relative flex h-dvh w-full overflow-hidden"
      style={{ backgroundColor: "var(--chat-bg)" }}
      aria-label={tt(T.agentTitle, lang)}
    >
      {/* ── chat-history sidebar — Task 24: a real drawer instead of the old
          popover. Desktop (sm+): in-flow, PUSHES the chat aside. Mobile: an
          overlay with a dim backdrop, dismissed by backdrop tap or Escape.
          The width animates (w-72 ⇄ w-0); in RTL the drawer sits on the
          inline-start edge (right) automatically. ── */}
      <div
        className={`absolute inset-0 z-30 bg-black/40 transition-opacity duration-300 sm:hidden ${
          historyOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setSidebar(false)}
        aria-hidden="true"
      />
      <aside
        id="agent-history-sidebar"
        aria-label={tt(T.agentHistory, lang)}
        aria-hidden={!historyOpen}
        className={`absolute inset-y-0 start-0 z-40 flex h-full shrink-0 flex-col overflow-hidden border-e shadow-2xl transition-all duration-300 ease-in-out sm:relative sm:z-auto sm:shadow-none ${
          historyOpen ? "w-72 opacity-100" : "pointer-events-none w-0 opacity-0"
        }`}
        style={{ borderColor: "var(--chat-border)", backgroundColor: "var(--chat-bg)" }}
      >
        {/* inner rail keeps its fixed width so the drawer content never
            squishes while the outer width animates */}
        <div className="flex h-full w-72 flex-col">
          {/* sidebar header: title + close */}
          <div
            className="flex items-center justify-between gap-2 border-b px-3 py-2.5"
            style={{ borderColor: "var(--chat-border)" }}
          >
            <h2 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--chat-ink)" }}>
              <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{tt(T.agentHistory, lang)}</span>
              <span className="num shrink-0 text-[10px] font-normal text-muted-foreground">{historyList.length}</span>
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 shrink-0 p-0"
              onClick={toggleSidebar}
              aria-label={tt(T.agentCloseSidebar, lang)}
              title={tt(T.agentCloseSidebar, lang)}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>

          {/* new chat — the sidebar's primary action (Claude-like) */}
          <div className="px-2.5 pt-2.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-full justify-start gap-1.5 px-2.5 text-[11px]"
              onClick={newChat}
              disabled={busy}
            >
              <Eraser className="h-3.5 w-3.5" aria-hidden />
              {tt(T.agentClear, lang)}
            </Button>
          </div>

          {/* the saved conversations */}
          <div className="thin-scroll flex-1 overflow-y-auto px-2.5 py-2">
            {historyLoading ? (
              <div className="space-y-2 pt-1">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            ) : historyList.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs" style={{ color: "var(--chat-muted)" }}>
                {tt(T.agentHistoryEmpty, lang)}
              </p>
            ) : (
              <ul className="space-y-1">
                {historyList.map((c) => {
                  const active = c.id === chatIdRef.current;
                  return (
                    <li key={c.id}>
                      <div
                        className="group flex items-center gap-1 rounded-lg border px-1.5 py-1.5 transition-colors"
                        style={
                          active
                            ? { borderColor: "var(--chat-accent)", backgroundColor: "var(--chat-accent-soft)" }
                            : { borderColor: "transparent" }
                        }
                      >
                        <button
                          onClick={() => void loadChat(c.id)}
                          disabled={busy}
                          className="min-w-0 flex-1 text-start disabled:opacity-50"
                        >
                          <span
                            className="block truncate text-xs transition-colors"
                            style={{ color: active ? "var(--chat-accent)" : "var(--chat-ink)" }}
                          >
                            {c.title || tt(T.agentUntitledChat, lang)}
                          </span>
                          <span className="num block text-[10px] text-muted-foreground">
                            {new Date(c.updatedAt).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB")} · {c.count}{" "}
                            {tt(T.agentMsgsUnit, lang)}
                          </span>
                        </button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 shrink-0 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-down focus-visible:opacity-100 group-hover:opacity-100"
                          onClick={() => void deleteChat(c.id)}
                          aria-label={tt(T.agentDeleteChat, lang)}
                          title={tt(T.agentDeleteChat, lang)}
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* usage metering strip (from the old popover footer) */}
          {usage && (
            <p
              className="num border-t px-3 py-2 text-[10px] leading-relaxed text-muted-foreground"
              style={{ borderColor: "var(--chat-border)" }}
            >
              {tt(T.agentUsageToday, lang)}: {usage.today.questions} {tt(T.agentUsageQUnit, lang)} ·{" "}
              {usage.today.llmCalls} {tt(T.agentUsageAiCalls, lang)} · {tt(T.agentUsageLimit, lang)}
            </p>
          )}
        </div>
      </aside>

      {/* ── the chat column: top bar · messages · composer ── */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* ── slim top bar: back-to-desk · logo · title · history · new chat · theme · lang ── */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-2.5 border-b sm:px-4"
        style={{ borderColor: "var(--chat-border)", backgroundColor: "var(--chat-bg)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* back to the desk — the chat takes over the whole page, so this is
              the way out (arrow auto-flips in RTL via the rtl: variant) */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate("home")}
            className="h-8 shrink-0 gap-1.5 px-2.5 text-[11px]"
            aria-label={tt(T.agentBackToDesk, lang)}
            title={tt(T.agentBackToDesk, lang)}
          >
            <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            <span className="hidden sm:inline">{tt(T.agentBackToDesk, lang)}</span>
          </Button>
          {/* the official EGXDesk mark+wordmark (logo for this theme) */}
          <img
            src="/logo.png?v=224"
            alt="EGX Desk"
            width={35}
            height={28}
            className="h-6 w-auto sm:h-[28px] dark:hidden"
          />
          <img
            src="/logo-dark.png?v=224"
            alt="EGX Desk"
            width={35}
            height={28}
            className="hidden h-6 w-auto sm:h-[28px] dark:block"
          />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold" style={{ color: "var(--chat-ink)" }}>
              {tt(T.agentTitle, lang)}
            </h1>
            <p className="num truncate text-[10px]" style={{ color: "var(--chat-muted)" }}>
              GLM-4-Plus · {tt(T.delayed, lang)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* history — toggles the conversations sidebar (drawer) */}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-2.5 text-[11px]"
            onClick={toggleSidebar}
            aria-expanded={historyOpen}
            aria-controls="agent-history-sidebar"
            aria-label={tt(T.agentHistory, lang)}
            title={tt(T.agentHistory, lang)}
          >
            <History className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">{tt(T.agentHistory, lang)}</span>
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2.5 text-[11px]" onClick={newChat} disabled={busy}>
            <Eraser className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{tt(T.agentClear, lang)}</span>
          </Button>

          {/* the controls the hidden main header would normally carry — the
              theme toggle renders BOTH icons and switches them with the
              html.dark CSS class so SSR and client markup match exactly */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            suppressHydrationWarning
            aria-label={tt((theme ?? "dark") === "dark" ? T.switchToLight : T.switchToDark, lang)}
            title={tt((theme ?? "dark") === "dark" ? T.switchToLight : T.switchToDark, lang)}
            onClick={() => {
              try {
                localStorage.setItem("egx-theme-chosen", "1");
              } catch {}
              setTheme((theme ?? "dark") === "dark" ? "light" : "dark");
            }}
          >
            <Sun className="hidden h-4 w-4 dark:block" aria-hidden />
            <Moon className="block h-4 w-4 dark:hidden" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2"
            aria-label={tt(T.langAppearance, lang)}
            title={tt(T.langAppearance, lang)}
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
          >
            <Languages className="h-4 w-4" aria-hidden />
            <span className="num text-[11px]">{lang === "ar" ? "EN" : "ع"}</span>
          </Button>
        </div>
      </div>

      {/* ── the message column — fills ALL remaining height (own scroll) ── */}
      <div className="thin-scroll flex-1 overflow-y-auto px-4">
        <div className="mx-auto max-w-3xl space-y-6 py-6">
          {!ready ? (
            <Skeleton className="h-24 w-full" />
          ) : messages.length === 0 && !busy ? (
            /* first visit — the Claude-style greeting + suggestion pills */
            <div className="py-8 text-center space-y-5">
              <ClaudeMark className="mx-auto h-9 w-9" />
              <h2 className="claude-serif text-xl sm:text-2xl font-semibold" style={{ color: "var(--chat-ink)" }}>
                {tt(T.agentGreeting, lang)}
              </h2>
              <p className="mx-auto max-w-xl text-xs leading-relaxed" style={{ color: "var(--chat-muted)" }}>
                {tt(T.agentNote, lang)}
              </p>
              <div className="flex flex-wrap justify-center gap-2 max-w-xl mx-auto">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => void ask(tt(s, lang))}
                    disabled={busy}
                    className="rounded-full border px-3.5 py-2 text-xs transition-all hover:-translate-y-0.5 hover:shadow-sm disabled:opacity-50"
                    style={{ color: "var(--chat-muted)" }}
                  >
                    {tt(s, lang)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => <Exchange key={i} m={m} lang={lang} />)
          )}

          {/* the live exchange while the agent works */}
          {busy && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ClaudeMark className="h-5 w-5 shrink-0 animate-pulse" />
                <span className="text-[11px] font-medium" style={{ color: "var(--chat-muted)" }}>
                  EGX Desk
                  {elapsed > 2 && <span className="num"> · {elapsed}s</span>}
                </span>
              </div>
              {liveSteps.length > 0 && <StepChips steps={liveSteps} lang={lang} />}
              {liveNote && (
                <p className="text-[10px]" style={{ color: "var(--chat-muted)" }}>
                  {liveNote}
                </p>
              )}
              {streamText ? (
                <div className="claude-serif text-[15px] leading-[1.85]" style={{ color: "var(--chat-ink)" }}>
                  <AgentMarkdown text={streamText} streaming />
                </div>
              ) : (
                <div className="flex items-center gap-2.5 py-1">
                  <span className="flex gap-1" aria-hidden>
                    <span className="h-1.5 w-1.5 rounded-full animate-bounce [animation-delay:0ms]" style={{ backgroundColor: "var(--chat-accent)" }} />
                    <span className="h-1.5 w-1.5 rounded-full animate-bounce [animation-delay:150ms]" style={{ backgroundColor: "var(--chat-accent)" }} />
                    <span className="h-1.5 w-1.5 rounded-full animate-bounce [animation-delay:300ms]" style={{ backgroundColor: "var(--chat-accent)" }} />
                  </span>
                  <span className="text-xs" style={{ color: "var(--chat-muted)" }}>
                    {tt(T.agentThinking, lang)}
                  </span>
                </div>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── the composer, pinned to the bottom of the viewport ── */}
      <div className="px-4 pb-4 pt-2" style={{ backgroundColor: "var(--chat-bg)" }}>
        <div className="mx-auto max-w-3xl">
          {/* error retry */}
          {messages.length > 0 && messages[messages.length - 1].error && !busy && (
            <div className="mb-2 flex justify-center">
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11px]" onClick={retry}>
                {tt(T.agentRetry, lang)}
              </Button>
            </div>
          )}
          <ClaudeInput
            value={input}
            onChange={setInput}
            onSubmit={() => void ask(input)}
            onStop={stop}
            busy={busy}
            placeholder={tt(T.agentPlaceholder, lang)}
            ariaLabel={tt(T.agentPlaceholder, lang)}
            hint={tt(T.agentSendHint, lang)}
            toolbar={toolbar}
            plusMenu={plusMenu}
            plusLabel={tt(T.agentQuickPrompts, lang)}
          />
          <p className="mt-2 text-center text-[10px] leading-relaxed" style={{ color: "var(--chat-muted)" }}>
            {tt(T.agentDisclaimer, lang)}
          </p>
        </div>
      </div>
      </div>
    </section>
  );
}

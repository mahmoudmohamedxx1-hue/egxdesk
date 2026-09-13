"use client";

/** AI Agent tab — the in-app EGX analyst, redesigned (Task 22-b) to LOOK and
 *  FEEL like a modern AI chat (the Claude reference the user pointed at):
 *
 *  - ONE warm cream/charcoal chat canvas (not cards-in-cards): a slim top bar
 *    (title + history + new chat), a scrolling message column centered at
 *    reading width, and the composer pinned at the bottom of the canvas.
 *  - USER messages are soft rounded bubbles on the end side; ASSISTANT
 *    messages have NO bubble — plain generous text in a serif voice (Lora
 *    for Latin / Amiri for Arabic) under a terracotta asterisk mark, the
 *    way reference AI chats set their answers.
 *  - The composer is the Claude-style input: auto-growing canvas with its
 *    own focus ring, a round "+" context button, tools/model chips, an
 *    "extended thinking" toggle (a REAL flag the backend honors), and the
 *    filled circular send button that becomes stop while streaming.
 *
 *  Everything else from Task 20/21 is preserved: SSE streaming with live
 *  tool chips, stop/copy controls, server-side chat history + usage strip,
 *  bilingual rendering, ?q= deep-link prefill (never auto-sent). */

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/market/app-context";
import { T, tt } from "@/lib/i18n";
import { AgentMarkdown } from "@/components/market/agent-markdown";
import { ClaudeInput } from "@/components/market/claude-input";
import { bootParam } from "@/lib/url-state";
import { copyText } from "@/lib/url-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Check, Copy, Cpu, Eraser, History, Sparkles, Trash2, Wrench,
} from "lucide-react";
import { getDeviceId } from "@/lib/push-client";

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
};

const CHAT_KEY = "egx-agent-chat";
const CHAT_ID_KEY = "egx-agent-chat-id";
const THINK_KEY = "egx-agent-deep";
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
  const { lang, toast } = useApp();
  const [messages, setMessages] = useState<AgentMsg[]>([]);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryRow[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const chatIdRef = useRef<string>("");
  const lastQueryRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
          const next: AgentMsg[] = [...history, { role: "assistant", content: evt.answer, steps: finalSteps, ts: Date.now() }];
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
      setHistoryOpen(false);
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
    setHistoryOpen(false);
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

      {/* model chip */}
      <span
        className="num inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium"
        style={{ color: "var(--chat-muted)" }}
      >
        <Cpu className="h-3 w-3" aria-hidden />
        GLM
      </span>
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
                setHistoryOpen(false);
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
      className="overflow-hidden rounded-2xl border shadow-sm flex flex-col"
      style={{ backgroundColor: "var(--chat-bg)", borderColor: "var(--chat-border)" }}
      aria-label={tt(T.agentTitle, lang)}
    >
      {/* ── slim top bar: identity · history · new chat ── */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--chat-border)" }}>
        <div className="flex items-center gap-2 min-w-0">
          <ClaudeMark className="h-6 w-6 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm font-bold truncate" style={{ color: "var(--chat-ink)" }}>
              {tt(T.agentTitle, lang)}
            </h1>
            <p className="num text-[10px] truncate" style={{ color: "var(--chat-muted)" }}>
              GLM · {tt(T.delayed, lang)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* server-side chat history — popover panel */}
          <Popover open={historyOpen} onOpenChange={(o) => { setHistoryOpen(o); if (o) void loadHistory(); }}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 px-2.5 text-[11px]"
                aria-expanded={historyOpen}
              >
                <History className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{tt(T.agentHistory, lang)}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold">{tt(T.agentHistory, lang)}</h2>
                <span className="num text-[10px] text-muted-foreground">{historyList.length}</span>
              </div>
              {historyLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : historyList.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center">{tt(T.agentHistoryEmpty, lang)}</p>
              ) : (
                <ul className="max-h-64 overflow-y-auto thin-scroll">
                  {historyList.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 border-b border-border/60 last:border-0 py-1.5">
                      <button
                        onClick={() => void loadChat(c.id)}
                        disabled={busy}
                        className="min-w-0 flex-1 text-start group disabled:opacity-50"
                      >
                        <span className="block truncate text-xs group-hover:text-primary transition-colors">
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
                        className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-down"
                        onClick={() => void deleteChat(c.id)}
                        aria-label={tt(T.agentDeleteChat, lang)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {usage && (
                <p className="num border-t border-border/60 pt-2 text-[10px] leading-relaxed text-muted-foreground">
                  {tt(T.agentUsageToday, lang)}: {usage.today.questions} {tt(T.agentUsageQUnit, lang)} ·{" "}
                  {usage.today.llmCalls} {tt(T.agentUsageAiCalls, lang)} · {tt(T.agentUsageLimit, lang)}
                </p>
              )}
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2.5 text-[11px]" onClick={newChat} disabled={busy}>
            <Eraser className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{tt(T.agentClear, lang)}</span>
          </Button>
        </div>
      </div>

      {/* ── the message column (reading width, scrolls above the composer) ── */}
      <div className="thin-scroll max-h-[62vh] min-h-[320px] overflow-y-auto px-4">
        <div className="mx-auto max-w-3xl space-y-6 py-5">
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

      {/* ── the composer, pinned to the bottom of the canvas ── */}
      <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: "var(--chat-border)" }}>
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
    </section>
  );
}

"use client";

/** AI Agent tab — the in-app EGX analyst. The chat UI posts the conversation
 *  to /api/agent, where a tool-calling LLM loop (z-ai-web-dev-sdk, server
 *  side only) pulls REAL market data through our own data layer and writes
 *  the final markdown answer. The UI shows every tool call the agent made
 *  (the open-source agent-repo pattern: visible steps, then the answer),
 *  persists the chat on the device, and always renders the disclaimer. */

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/market/app-context";
import { T, tt } from "@/lib/i18n";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Cpu, Eraser, History, Send, Sparkles, Trash2, Wrench, User as UserIcon } from "lucide-react";
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
};

const SUGGESTIONS = [T.agentSuggest1, T.agentSuggest2, T.agentSuggest3, T.agentSuggest4, T.agentSuggest5, T.agentSuggest6];

function StepChips({ steps, lang }: { steps: AgentStep[]; lang: "ar" | "en" }) {
  if (!steps.length) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-2" aria-label={tt(T.agentStepsUsed, lang)}>
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <Wrench className="h-3 w-3" aria-hidden />
        {tt(T.agentStepsUsed, lang)}:
      </span>
      {steps.map((s, i) => (
        <span
          key={i}
          className={`num inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
            s.ok ? "bg-secondary text-muted-foreground" : "bg-down-soft text-down"
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

function Bubble({ m, lang }: { m: AgentMsg; lang: "ar" | "en" }) {
  const isUser = m.role === "user";
  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-secondary text-muted-foreground" : "bg-primary text-primary-foreground"
        }`}
        aria-hidden
      >
        {isUser ? <UserIcon className="h-3.5 w-3.5" /> : <Bot className="h-4 w-4" />}
      </span>
      <div
        className={`max-w-[85%] rounded-lg border px-3.5 py-2.5 ${
          isUser
            ? "bg-secondary/50"
            : m.error
              ? "bg-down-soft/40 border-down/30"
              : "bg-card"
        }`}
      >
        {!isUser && !m.error && m.steps && <StepChips steps={m.steps} lang={lang} />}
        {isUser ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
        ) : m.error ? (
          <p className="text-sm leading-relaxed">{m.content}</p>
        ) : (
          <div className="agent-md text-sm leading-relaxed [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_strong]:font-semibold [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:bg-secondary [&_code]:px-1 [&_code]:rounded [&_a]:text-primary [&_a]:underline">
            <ReactMarkdown>{m.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

export function AgentView() {
  const { lang, toast } = useApp();
  const [messages, setMessages] = useState<AgentMsg[]>([]);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryRow[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const chatIdRef = useRef<string>("");
  const lastQueryRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // restore the chat from the device (SSR-safe mount read)
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
    } catch {}
    setReady(true);
  }, []);

  const persist = (next: AgentMsg[]) => {
    setMessages(next);
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(next.slice(-MAX_STORED)));
    } catch {}
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

  // keep the newest message in view
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    lastQueryRef.current = q;
    const userMsg: AgentMsg = { role: "user", content: q, ts: Date.now() };
    const history = [...messages, userMsg];
    persist(history);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })),
          lang,
          deviceId: getDeviceId(), // usage metering + per-user hourly limit
        }),
      });
      const json = (await res.json()) as { answer?: string; steps?: AgentStep[]; error?: string };
      if (!res.ok || !json.answer) {
        persist([
          ...history,
          {
            role: "assistant",
            content: json.error ? `${tt(T.agentError, lang)} (${json.error})` : tt(T.agentError, lang),
            error: true,
            ts: Date.now(),
          },
        ]);
      } else {
        const next: AgentMsg[] = [...history, { role: "assistant", content: json.answer, steps: json.steps ?? [], ts: Date.now() }];
        persist(next);
        saveChat(next); // server-side history (fire-and-forget)
      }
    } catch {
      persist([...history, { role: "assistant", content: tt(T.agentError, lang), error: true, ts: Date.now() }]);
    } finally {
      setBusy(false);
    }
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

  return (
    <div className="space-y-4">
      {/* header */}
      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-1.5 flex-wrap mb-1">
          <h1 className="text-lg font-bold flex items-center gap-2 me-auto">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            {tt(T.agentTitle, lang)}
          </h1>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px] gap-1"
            onClick={() => {
              setHistoryOpen((o) => !o);
              if (!historyOpen) void loadHistory();
            }}
            aria-expanded={historyOpen}
          >
            <History className="h-3 w-3" />
            {tt(T.agentHistory, lang)}
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] gap-1" onClick={newChat} disabled={busy}>
            <Eraser className="h-3 w-3" />
            {tt(T.agentClear, lang)}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">{tt(T.agentNote, lang)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            <Cpu className="h-3 w-3" aria-hidden />
            {tt(T.agentModelBadge, lang)}
          </span>
        </div>
      </section>

      {/* server-side chat history */}
      {historyOpen && (
        <section className="rounded-lg border bg-card p-3 space-y-2" aria-label={tt(T.agentHistory, lang)}>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground">{tt(T.agentHistory, lang)}</h2>
            <span className="num text-[10px] text-muted-foreground">{historyList.length}</span>
          </div>
          {historyLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : historyList.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">{tt(T.agentHistoryEmpty, lang)}</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
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
        </section>
      )}

      {/* chat */}
      <section className="rounded-lg border bg-card p-4 min-h-64 flex flex-col" aria-label={tt(T.agentTitle, lang)}>
        <div className="flex-1 space-y-4">
          {!ready ? (
            <Skeleton className="h-24 w-full" />
          ) : messages.length === 0 ? (
            <div className="py-8 text-center space-y-4">
              <p className="text-sm text-muted-foreground">{tt(T.agentEmptyChat, lang)}</p>
              <div className="flex flex-wrap justify-center gap-2 max-w-lg mx-auto">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => void ask(tt(s, lang))}
                    disabled={busy}
                    className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
                  >
                    {tt(s, lang)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => <Bubble key={i} m={m} lang={lang} />)
          )}

          {busy && (
            <div className="flex gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden>
                <Bot className="h-4 w-4" />
              </span>
              <div className="rounded-lg border bg-card px-3.5 py-2.5 flex items-center gap-2">
                <span className="flex gap-1" aria-hidden>
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
                </span>
                <span className="text-xs text-muted-foreground">
                  {tt(T.agentThinking, lang)}
                  {elapsed > 2 && <span className="num"> — {elapsed}s</span>}
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* error retry */}
        {messages.length > 0 && messages[messages.length - 1].error && !busy && (
          <div className="mt-3">
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11px]" onClick={retry}>
              {tt(T.agentRetry, lang)}
            </Button>
          </div>
        )}

        {/* input */}
        <form
          className="mt-4 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={tt(T.agentPlaceholder, lang)}
            disabled={busy}
            maxLength={4000}
            aria-label={tt(T.agentPlaceholder, lang)}
            className="h-10 min-w-0 flex-1 rounded-md border bg-card px-3 text-sm"
          />
          <Button type="submit" size="sm" className="h-10 px-3 gap-1.5" disabled={busy || !input.trim()}>
            <Send className="h-3.5 w-3.5" />
            {tt(T.agentSend, lang)}
          </Button>
        </form>

        <p className="mt-3 text-[10px] text-muted-foreground leading-relaxed">{tt(T.agentDisclaimer, lang)}</p>
      </section>
    </div>
  );
}
